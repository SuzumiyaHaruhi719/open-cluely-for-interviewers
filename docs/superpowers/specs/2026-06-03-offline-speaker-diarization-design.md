# Offline Speaker Diarization — Design

**Status:** Draft for review
**Date:** 2026-06-03
**Scope:** Web app (`web-app/`). Desktop port is a follow-up.

## Goal

In **offline (in-person) interview mode** the app captures a **single room microphone** that
picks up both the interviewer and the candidate. Today the copilot cannot tell the two voices
apart, so (a) the live transcript is an undifferentiated stream, and (b) the interviewer's own
speech is mistaken for a candidate answer and spuriously triggers Generate-Q — a documented
limitation (`online-offline-interview-modes` Gotchas: "the room mic captures both sides … it
means the interviewer's own speech can trigger analysis too").

This feature adds **speaker diarization** to offline mode: each spoken segment is labelled
**interviewer** or **candidate**, only candidate speech feeds the follow-up generator, and the
transcript renders as speaker-coloured bubbles — using a self-hosted **FunASR** as a new ASR
provider that transcribes *and* labels speakers in one streaming pass.

## Context / current state

- Web ASR is a **pluggable per-connection relay** (`web-app/server/src/asr-relay.ts`) with two
  providers: `paraformer` (DashScope realtime) and `volc` (Doubao), chosen via `configure`.
- The DashScope key is licensed for `paraformer-realtime-8k-v2` only (8 kHz, Chinese-leaning,
  weak English) — a separate pain that a self-hosted FunASR also relieves.
- Offline mode on **web** currently only persists `interviewType` on the session record
  (`web/src/desktop/Shell.tsx:410`); the single-mic routing + analysis gating that the desktop
  has (`online-offline-interview-modes`) is **not yet wired on web**. So this feature also lands
  the web offline routing.
- Diarization is a different task from ASR: it needs a speaker-embedding model (FunASR's
  **CAM++**) + clustering. DashScope's realtime service returns no speaker labels; FunASR does.

## Key findings (verified against the FunASR repo, pushed 2026-05-30)

1. **Code MIT; model license permissive-with-attribution.** `MODEL_LICENSE` §2.1 grants
   use/copy/modify/share; §2.2 only requires retaining **source/author attribution + model
   names**; §3 is a no-warranty disclaimer. **Commercial delivery to a company is permitted**
   provided the FunASR attribution + model-name notices are kept. (Action: add a credit line in
   the product About/credits + `DEPLOY.md`.)
2. **FunASR has a streaming service with LIVE speaker assignment** — `serve_realtime_ws.py`
   (docs/vllm_guide.md §6): WebSocket PCM16 @16 kHz in; emits
   `{"sentences":[{"text","start","end","spk"}], "partial":"…", "is_final":false}`; documented as
   "streaming SPK assignment + global re-clustering on STOP"; first-word latency ~480 ms. So
   **live per-sentence speaker labels are feasible** (not offline-only).
   - The classic `funasr-runtime-sdk-online` 2pass image does **not** carry `spk` in its streaming
     results — there diarization is the offline `/ws` path (cluster-on-STOP). We therefore target
     the **streaming-SPK service**, not the classic 2pass image.
   - Trade-off: the streaming-SPK service is the newer vLLM-based path → **GPU recommended** for
     low latency. CPU-only deployments fall back to per-turn / offline-cluster diarization (labels
     finalise when a turn ends or on STOP, higher latency).

## Approach (chosen)

**FunASR all-in-one as a 3rd ASR provider** (`funasr`), targeting the streaming-SPK service. One
self-hosted service both transcribes and labels speakers; the relay maps `spk` cluster ids to
interviewer/candidate roles and gates Generate-Q to candidate speech.

**Rejected:**
- *Diarize-only → DashScope Paraformer ASR (the original "split" idea):* two systems + a network
  round-trip per segment, and DashScope stays on 8 kHz. More complexity, no upside once FunASR is
  self-hosted anyway.
- *Status quo (no diarization):* offline keeps mislabelling the interviewer's speech as candidate
  answers.

## Architecture

```
room mic ─ getUserMedia ─ 16kHz PCM worklet ─ WS{audio} ─▶ asr-relay (provider=funasr)
                                                               │
                                                               ▼
                                          FunASR streaming-SPK WS (serve_realtime_ws.py)
                                                               │  {sentences:[{text,spk}], partial, is_final}
                                                               ▼
                                       SpeakerRoleMap (spk id → interviewer | candidate)
                                                               │
                         ┌─────────────────────────────────────┼───────────────────────────┐
                         ▼                                       ▼                           ▼
              transcript{text, speaker, isFinal}     candidate finals → Generate-Q   interviewer finals → question history
                         │
                         ▼
              web offline lane: speaker-coloured bubbles + per-speaker role toggle
```

### New: `funasr` ASR provider
- `web-app/server/src/funasr-client.ts` — connects to the FunASR streaming-SPK WS
  (`FUNASR_WS_URL`); sends a JSON start frame, binary PCM16 @16 kHz, then `STOP`; parses
  `{sentences:[{text,start,end,spk}], partial, is_final}`. Same `sendAudio/stop/isReady` surface
  + an injectable WebSocket for tests (mirrors `paraformer-client.ts` / `volc-client.ts`).
- `asr-relay.ts` gains `funasr` alongside `paraformer|volc`; routes the provider; propagates `spk`
  into the transcript emit.

### Contract changes (`web-app/packages/contract`)
- `transcript` (S2C) gains optional `speaker?: 'interviewer' | 'candidate' | 'unknown'` and
  `speakerId?: number` (raw cluster id).
- `configure` (C2S) gains `asrProvider: 'funasr'`, `funasrUrl?: string`,
  `diarization?: { speakerNum?: number }`.
- New C2S `set-speaker-role: { speakerId: number, role: 'interviewer' | 'candidate' }`.

### Role mapping (cluster id → role) — server, per session
- A `SpeakerRoleMap` per session: cluster id → `'interviewer' | 'candidate'`.
- **Default:** the first cluster id observed = `interviewer` (the interviewer opens); the next
  distinct id = `candidate`; further ids (panel) default to `candidate`.
- **One-tap correction:** `set-speaker-role` flips a cluster's role; the server re-labels current
  + past segments for that cluster and re-emits.
- The streaming service keeps cluster ids stable within a session (global re-cluster on STOP), so
  the mapping stays consistent through the interview.

### Offline routing + Generate-Q gating
- When `interviewType === 'offline'`: a single mic lane; the server tags each transcript with the
  mapped role.
- **Only `candidate` finals** feed the follow-up generator (fixes the spurious-trigger bug);
  `interviewer` finals go to question-history (parity with online, where mic = interviewer
  questions).
- Land the web offline single-mic routing here (currently unwired on web): hide the
  candidate/display channel, relabel the mic as "Room mic", route candidate-labelled finals to
  analysis. Mirror the desktop semantics in `online-offline-interview-modes`.

### UI (web)
- The single offline lane renders **speaker-coloured bubbles** reusing the existing lane styles
  (teal candidate / amber interviewer), driven by `speaker`.
- Each cluster's first bubble shows a small **"候选人 / 面试官" toggle**; tapping sends
  `set-speaker-role` and recolours that speaker's bubbles (including history).

## Error handling / degradation
- FunASR unreachable / blank URL → emit a clear `error` and **pause offline transcription** (the
  relay starts no session). We deliberately do **not** silently fall back to the cloud Paraformer
  relay: offline mode's value is that candidate audio stays on-prem, and a silent cloud fallback
  would betray that privacy guarantee without the interviewer knowing. The error message tells them
  to fix the FunASR service. An *explicit, opt-in* cloud fallback is possible future work.
  (Implementation: `asr-relay.ts startFunasr` emits a friendly error + starts no session; runtime
  WS errors route through `onError` → error transcript + `stopSource`.)
- Low-confidence / cross-speaker segment → `speaker: 'unknown'`, defaulted to candidate for gating
  (prefer over-triggering to dropping a candidate answer).
- Missing `FUNASR_WS_URL` when provider=funasr → config-validation error surfaced in Settings.

## Deployment
- Add a `funasr` service to `web-app/docker-compose.yml` running the FunASR streaming-SPK service;
  the Node server reaches it over the internal network via `FUNASR_WS_URL`.
- **GPU recommended** for the streaming-SPK (vLLM) path; document the CPU fallback (per-turn /
  offline-cluster diarization, higher label latency) in `DEPLOY.md`.
- Online mode keeps using the DashScope key unchanged; FunASR is offline-mode (and an opt-in
  provider) only.
- **Attribution:** add the FunASR attribution + model names to credits + `DEPLOY.md` per
  `MODEL_LICENSE` §2.2.

## Testing
- `funasr-client` (stubbed WS): start-frame build, PCM passthrough, parse of
  `sentences[{text,start,end,spk}]` + `partial` + `is_final`, STOP handling.
- `asr-relay`: `provider=funasr` routing; `spk`→transcript propagation; degradation path when the
  client errors.
- Role-map pure logic: first-seen=interviewer default; `set-speaker-role` flip re-labels history;
  Generate-Q gate passes only candidate finals.
- Mirrors the existing `paraformer-client` / `volc-client` / `asr-relay` test patterns.

## Out of scope (v1)
- Desktop port (desktop offline routing already exists; wiring the `funasr` provider there is a
  follow-up).
- Panels >2 speakers (design allows N; UX tuned for 2).
- Voiceprint enrollment / cross-session interviewer identity (per-session streaming clustering +
  one-tap is enough for v1).

## Open questions / spikes (resolve in the plan)
- Confirm the exact `serve_realtime_ws.py` start-frame JSON + STOP semantics from `runtime/docs`
  (the result shape is confirmed; the start frame is not yet pinned).
- Validate streaming-SPK latency + accuracy on the target hardware (GPU vs CPU); decide the CPU
  fallback's UX (per-turn labels).
- Pick the FunASR model for the streaming-SPK service (SenseVoice multilingual vs
  Paraformer-zh-streaming vs Fun-ASR-Nano).
