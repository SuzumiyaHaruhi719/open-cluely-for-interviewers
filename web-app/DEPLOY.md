# Deploying Open-Cluely Web

One Node process serves everything: the JSON API, the WebSocket copilot stream, and
the React SPA. Target is a single Docker image you can hand to a company.

## What's in the image

- `src/` — the interviewer brain (pipeline, prompts, runtime), re-exported by `@open-cluely/copilot-core`.
- `web-app/` — the monorepo: built SPA (`web/dist`), bundled server (`server/dist`), `node_modules`, and the committed question-bank corpus (`packages/question-bank/data/`).
- The server listens on `PORT` (default **8787**) and serves the SPA at `/`, the API at `/api/*`, and the copilot WebSocket at `/ws`.

The DashScope key is **never** baked in — supply it at runtime.

## Build & run (plain Docker)

Build from the **repo root** (the Dockerfile needs both `src/` and `web-app/`):

```bash
docker build -f web-app/Dockerfile -t open-cluely-web:latest .
docker run --rm -p 8787:8787 -e DASHSCOPE_API_KEY=sk-xxxx open-cluely-web:latest
# open http://localhost:8787
```

## Build & run (compose)

```bash
cd web-app
# DASHSCOPE_API_KEY is read from web-app/.env or the shell environment
docker compose up --build
```

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | **yes** | — | DashScope key. `x-api-key` for chat (Anthropic-shape) + `Authorization: Bearer` for `text-embedding-v4` (native). |
| `PORT` | no | `8787` | HTTP/WS port. |
| `CAMPP_URL` | no | `http://localhost:10097` | HTTP URL of the local CAM++ diarizer sidecar. Offline interview mode only. Via compose it's wired to `http://campp-sidecar:10097`. |

## Offline speaker diarization (CAM++ sidecar)

Offline interview mode (single room microphone) keeps **transcription on cloud Paraformer**
(same `DASHSCOPE_API_KEY` as online) and adds speaker labels via a small **local CAM++
sidecar**. For each finalized utterance the server posts the audio to the sidecar, which
computes a CAM++ speaker embedding and assigns a speaker id by online clustering: the first
voice heard becomes the interviewer (cluster 0), the next distinct voice the candidate.
Generate-Q is gated to candidate-labelled speech. Online mode is unaffected.

**Starting the service:** the `docker-compose.yml` includes a `campp-sidecar` service that
the server `depends_on`. Run `docker compose up --build` from `web-app/` and both containers
start together; `CAMPP_URL` is wired to `http://campp-sidecar:10097` inside the server
container. The sidecar image bakes in the CAM++ model, so it starts ready.

For plain-Docker / dev (server running outside Docker), start the sidecar container and pass
`CAMPP_URL=http://localhost:10097` to the server. If the sidecar is unreachable, offline
transcription still works — segments are just left unlabelled (role `unknown`, never gated),
so a momentarily-down sidecar never blocks the interview.

**CPU is fine:** per-utterance CAM++ embeddings are light; no GPU required.

> Speaker diarization in offline mode is powered by **FunASR / CAM++** (`speech_campplus_sv_zh-cn_16k-common`), © Alibaba Group, used under the FunASR Model License (attribution + model name retained per the license).

## Health check

```bash
curl http://localhost:8787/api/health
# {"ok":true,"version":"0.1.0","questionBankReady":true,"hasKey":true}
```

## Verify the copilot (no browser)

The server is verified end-to-end: an Expert-mode analysis over the WebSocket returns a
real follow-up question (~25s, ~10k tokens) and the question-bank semantic search returns
relevant questions. See `GET /api/question-bank/search?q=...` and the `/ws` protocol in
`packages/contract`.

## Notes

- **Live audio (interviewee capture) is not wired yet.** The text-driven copilot (paste the
  candidate's answer) and the question bank are fully functional. Live audio needs browser
  `getDisplayMedia`/`getUserMedia` → WS → an ASR provider, and ASR provider credentials
  (Xfyun / Volcengine / Paraformer) which are separate from the DashScope key.
- **Rebuild the question bank** (optional) after a re-scrape: `npm run scrape && DASHSCOPE_API_KEY=... npm run build-embeddings` in `packages/question-bank`, then rebuild the image.
- The desktop Electron app is unaffected by this deployment; it lives in `src/` and ships separately.
