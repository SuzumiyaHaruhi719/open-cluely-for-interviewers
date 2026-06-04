#!/usr/bin/env python3
"""
Local CAM++ speaker-diarization sidecar (transcription stays on cloud Paraformer).

This process does ONE job: given a finalized utterance's raw audio, return an
integer speaker id, using FunASR's CAM++ speaker-embedding model + in-memory
online clustering. No enrollment, no ASR here.

HTTP API (stdlib http.server, threaded):
  POST /diarize?session=<id>   body = raw PCM16 mono 16 kHz bytes
       -> 200 {"spk": <int>, "score": <float>, "n": <num_clusters>}
       -> 422 {"error": "too_short"}  when the clip is below MIN_SAMPLES
  POST /reset?session=<id>     -> 200 {"ok": true}      (clears that session)
  GET  /health                 -> 200 {"ok": true, "device": "...", "threshold": ...}

Clustering: the first utterance of a session creates cluster 0 (the interviewer,
since they open the interview). Each later utterance is assigned to the nearest
existing centroid by cosine similarity if that similarity >= THRESHOLD, else it
starts a new cluster. Centroids are updated as a running mean. State is per
session id and lives only in memory (reset on /reset or process restart).
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import numpy as np

# Below this cosine (to the NEAREST existing centroid) a segment is treated as a
# NEW speaker — but only while under MAX_SPEAKERS. Once the cap is reached, every
# segment is assigned to the nearest centroid (relative comparison, robust to the
# noisy absolute cosines you get from live room-mic audio).
THRESHOLD = float(os.environ.get("CAMPP_THRESHOLD", "0.4"))
MAX_SPEAKERS = int(os.environ.get("CAMPP_MAX_SPEAKERS", "2"))
PORT = int(os.environ.get("CAMPP_PORT", "10097"))
MODEL = os.environ.get("CAMPP_MODEL", "iic/speech_campplus_sv_zh-cn_16k-common")
SAMPLE_RATE = 16000
MIN_SAMPLES = int(0.20 * SAMPLE_RATE)  # ignore clips shorter than 200 ms

print(f"[campp] loading model: {MODEL}", flush=True)
from funasr import AutoModel  # noqa: E402

_model = AutoModel(model=MODEL, disable_pbar=True, disable_log=True)
import torch  # noqa: E402

_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[campp] model loaded; device={_DEVICE}; threshold={THRESHOLD}", flush=True)

# Serialize model.generate (single GPU model is not thread-safe) and guard state.
_model_lock = threading.Lock()
_state_lock = threading.Lock()
# session id -> list of {"centroid": np.ndarray, "count": int}
_sessions: dict[str, list[dict]] = {}


def _embed(pcm: bytes) -> np.ndarray:
    """PCM16 mono 16k bytes -> L2-normalizable float32 speaker embedding."""
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    with _model_lock:
        out = _model.generate(input=audio, embedding=True)[0]
    emb = out["spk_embedding"]
    if isinstance(emb, (list, tuple)):  # some funasr versions wrap as [vec]
        emb = emb[0]
    if hasattr(emb, "detach"):
        emb = emb.detach()
    if hasattr(emb, "cpu"):  # torch.Tensor -> numpy
        emb = emb.cpu().numpy()
    emb = np.asarray(emb, dtype=np.float32).reshape(-1)
    return emb


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _assign(session: str, emb: np.ndarray) -> tuple[int, float, int]:
    """Online speaker assignment, capped at MAX_SPEAKERS (default 2 for an
    interview). First voice -> cluster 0. A NEW cluster is created only when the
    segment is clearly different from every existing centroid (nearest cosine <
    THRESHOLD) AND we are under the cap; otherwise the segment goes to the NEAREST
    centroid (relative — robust to noisy absolute cosines). Returns (spk, score, n)."""
    with _state_lock:
        clusters = _sessions.setdefault(session, [])
        if not clusters:
            clusters.append({"centroid": emb.copy(), "count": 1})
            return 0, -1.0, 1
        sims = [_cosine(emb, c["centroid"]) for c in clusters]
        best_i = max(range(len(sims)), key=lambda i: sims[i])
        best_s = sims[best_i]
        if best_s < THRESHOLD and len(clusters) < MAX_SPEAKERS:
            clusters.append({"centroid": emb.copy(), "count": 1})
            spk = len(clusters) - 1
            return spk, best_s, len(clusters)
        c = clusters[best_i]
        n = c["count"]
        c["centroid"] = (c["centroid"] * n + emb) / (n + 1)
        c["count"] = n + 1
        return best_i, best_s, len(clusters)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet default access log
        pass

    def _json(self, code: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _session(self) -> str:
        q = parse_qs(urlparse(self.path).query)
        return (q.get("session", ["default"]) or ["default"])[0]

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._json(200, {"ok": True, "device": _DEVICE, "threshold": THRESHOLD})
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        session = self._session()
        if path == "/reset":
            with _state_lock:
                _sessions.pop(session, None)
            return self._json(200, {"ok": True})
        if path != "/diarize":
            return self._json(404, {"error": "not_found"})

        length = int(self.headers.get("Content-Length", "0") or "0")
        pcm = self.rfile.read(length) if length > 0 else b""
        if len(pcm) < MIN_SAMPLES * 2:  # 2 bytes/sample
            return self._json(422, {"error": "too_short"})
        try:
            emb = _embed(pcm)
            spk, score, n = _assign(session, emb)
            self._json(200, {"spk": spk, "score": round(score, 4), "n": n})
        except Exception as e:  # noqa: BLE001 - surface to caller, keep server up
            self._json(500, {"error": str(e)})


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[campp] sidecar listening on :{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
