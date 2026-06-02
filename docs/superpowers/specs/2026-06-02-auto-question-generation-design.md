# Autonomous context-driven question generation — Design

**Date:** 2026-06-02
**Status:** Approved (design)
**Scope:** `web-app/server/`, `web-app/packages/contract/`, `web-app/web/`. The desktop Electron app and `src/` interviewer brain are NOT modified.

## Problem

Today the web copilot only generates follow-ups when the interviewer clicks **Generate Q**. The Expert pipeline already builds a candidate **pool** (Block D) and **scores + ranks** it (Block E), but the server discards that and sends only Block G's single question. We want the copilot to (1) **autonomously decide when** to generate from the live conversation, and (2) **surface the scored/ranked questions**, reusing the existing pipeline rather than rebuilding generation or scoring.

## Decisions (from brainstorming)

- **Trigger:** a thinking-off Flash "trigger monitor" gated by cheap local heuristics. Flash decides *when*; the **Expert 7-block chain** generates + scores + ranks (deepest quality; ~25–30s per fire accepted).
- **Autonomy:** auto-on by default, with a UI toggle + cooldown + no double-fire while a generation is in flight. Manual Generate Q always remains.
- **Ranked UI:** keep the best follow-up prominent (with its score) + an expandable ranked list of the other scored candidates (score + one-line rubric reason); the interviewer can pick any.

## Architecture

The only new moving part is a **server-side trigger monitor**, per WebSocket session. The server already relays the candidate transcript and already runs generation via `@open-cluely/copilot-core`. The monitor watches the candidate (display) lane, decides when to fire, runs the existing Expert pipeline, and surfaces the already-computed ranked pool. No desktop-brain change.

## Components

### 1. Trigger monitor (`server/src/auto-trigger.ts`)
Per-session state: `{ autoGenerate, lastGenAt, charsAtLastGen, isGenerating }`.
On each candidate **final** transcript segment:
1. **Local gates (no LLM):** `autoGenerate` on; not `isGenerating`; `Date.now() - lastGenAt >= COOLDOWN_MS` (default 20000); `newChars >= MIN_NEW_CHARS` (default 120); a short debounce (~1200ms after the final, to act on a pause, coalescing rapid finals).
2. **Flash gate (LLM):** if gates pass, one **thinking-off** `deepseek-v4-flash` call (via the existing `server/src/dashscope.ts` chat helper) with a focused prompt over the recent transcript → strict JSON `{ shouldGenerate: boolean, reason: string, focusHint: string, urgency: 'low'|'med'|'high' }`. Parse defensively; any failure → treat as `shouldGenerate:false` (never throws, never blocks).
3. **Fire:** if `shouldGenerate`, set `isGenerating`, run the existing analyze path (Expert), emit progress + a `result` with `trigger:'auto'`. On completion (or error) set `lastGenAt`, `charsAtLastGen`, clear `isGenerating`.

The monitor is wired in `server/src/ws.ts` where transcripts already arrive, alongside the existing `analyze`/`audio` handling. Manual `analyze` shares the `isGenerating`/`lastGenAt` bookkeeping so auto + manual never overlap.

### 2. Ranked-pool surfacing (`server/src/ws.ts` result builder)
`copilot-core`'s analyze result already carries `result.blocks.D.candidates` (the pool) and `result.blocks.E.ranked` (`{id, total, rubric, reasoning}`) + `top_2_ids`. Map these into a `ranked: RankedQuestion[]` on the `result` message: join D.candidates ↔ E.ranked by id, sort by `total` desc, each `{ question, score, maxScore, rubricReason, rank }`. If blocks are absent (fast mode / fallback), `ranked` is `[]` and the client falls back to the single `output` question.

### 3. Contract (`packages/contract`)
Additive: `configure.autoGenerate?: boolean`; `RankedQuestion` type; `result.ranked?: RankedQuestion[]`; `result.trigger?: 'auto'|'manual'`.

### 4. Client (`web/`)
- **Auto toggle** in the topbar (`useAppSettings` persists it; `Shell` sends `configure({ autoGenerate })` on change AND includes it in the full-config re-push on every new sessionId). Default ON.
- **QuestionCard**: best follow-up stays prominent with a score badge; add an expandable **"更多排序候选"** section listing `ranked[1..]` (score + rubric reason); clicking one promotes it (copies to the answer/notes or marks it selected). When `trigger==='auto'`, render a subtle **"自动"** badge on the card.
- `useCopilotSocket` already routes `result`; extend the typed `result` to carry `ranked`/`trigger`.

## Data flow

candidate final transcript → server monitor local-gates → (pass) Flash trigger call → (shouldGenerate) Expert analyze → progress + `result{ output, ranked, trigger:'auto' }` over WS → client renders the auto card with the prominent pick + expandable ranked list.

## Config / state

- Server constants (env-overridable): `AUTO_COOLDOWN_MS=20000`, `AUTO_MIN_NEW_CHARS=120`, `AUTO_DEBOUNCE_MS=1200`, monitor model = `deepseek-v4-flash` (thinking off).
- Per-session: `autoGenerate` (from configure, default true), `lastGenAt`, `charsAtLastGen`, `isGenerating`.

## Error handling / safety

- Monitor LLM failure/timeout → `shouldGenerate:false`; never throws into the socket.
- Cooldown + `isGenerating` guard prevent spam and overlapping Expert runs.
- Auto and manual share bookkeeping; a manual fire resets the cooldown so auto won't immediately re-fire.
- Toggling Auto off stops all monitor calls (cheap local check before any LLM call).

## Testing

- **server/auto-trigger.test.ts** (deterministic, fake clock, stubbed monitor + analyze): fires only when all local gates pass; respects cooldown; never double-fires while `isGenerating`; monitor `shouldGenerate:false` → no fire; monitor throw → no fire.
- **server ranked-surfacing test**: a stubbed analyze result with blocks D+E → `result.ranked` sorted by score, joined by id; missing blocks → `[]`.
- **web QuestionCard.test**: renders prominent pick + score; expandable ranked list shows `ranked[1..]` with scores; `trigger:'auto'` shows the 自动 badge.
- **web Auto-toggle test**: toggling sends `configure({ autoGenerate })`; persisted.
- Guardrails: desktop `node --test test/*.test.js` stays 30; `web-app` `npm test` stays green + new tests.

## Gotchas

- The monitor is server-side because the transcript + the brain + the key all live there; the client only toggles it.
- Reuse, don't rebuild: generation = Expert Block D, scoring/ranking = Block E. The work is the trigger + exposing what already exists.
- An LLM is request/response: "real-time" = the polling cadence (the local gates), not a persistent stream.
- A fast monitor does not make generation fast — Expert is still ~25–30s once fired; that's the accepted trade for depth.
