// ============================================================================
// CAM++ diarization sidecar client (offline single-room-mic mode).
// ----------------------------------------------------------------------------
// Offline mode keeps transcription on cloud Paraformer and asks a LOCAL CAM++
// sidecar (deploy/campp_sidecar.py) for a speaker id per finalized utterance.
// The sidecar runs online centroid clustering over CAM++ embeddings: the first
// voice it hears becomes cluster 0 (the interviewer, who opens the interview),
// the next distinct voice becomes 1 (the candidate), nearest-centroid after.
//
//   POST {url}/diarize?session={id}  body = raw PCM16 mono 16k -> { spk, score, n }
//   POST {url}/reset?session={id}    -> clears this session's clusters
//
// Failure is deliberately NON-FATAL: any error / non-OK (422 too_short, sidecar
// down, bad JSON) resolves to `null`, so the relay still emits the transcript
// text — just without a speaker label (role resolves to 'unknown', never gated).
// ============================================================================

export interface Diarizer {
  /**
   * Diarize one finalized-utterance PCM segment (s16le mono 16 kHz).
   * Resolves to the integer speaker id, or null when unknown / unavailable.
   */
  diarize(pcm: Buffer): Promise<number | null>;
  /** Best-effort: clear this session's clusters on the sidecar (fire-and-forget). */
  reset(): void;
}

export interface CamppDiarizerDeps {
  /** Sidecar base URL, e.g. http://localhost:10097 */
  url: string;
  /** Per-connection session id — keeps each interview's speaker clusters separate. */
  session: string;
  /** Injectable fetch implementation (tests). Defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

export function createCamppDiarizer(deps: CamppDiarizerDeps): Diarizer {
  const base = deps.url.replace(/\/+$/, '');
  const fetchFn = deps.fetchFn ?? fetch;
  const session = encodeURIComponent(deps.session);

  return {
    async diarize(pcm: Buffer): Promise<number | null> {
      try {
        const res = await fetchFn(`${base}/diarize?session=${session}`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: pcm
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { spk?: unknown };
        return typeof body.spk === 'number' ? body.spk : null;
      } catch {
        return null; // sidecar down / network error — degrade to no speaker label
      }
    },
    reset(): void {
      void (async () => {
        try {
          await fetchFn(`${base}/reset?session=${session}`, { method: 'POST' });
        } catch {
          /* ignore — reset is best-effort */
        }
      })();
    }
  };
}
