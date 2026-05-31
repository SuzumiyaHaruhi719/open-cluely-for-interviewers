# Design: "Generate Q" visual progress bar

**Date:** 2026-06-01
**Status:** Approved (brainstorming) → ready for implementation plan

## Purpose

When the interviewer clicks **Generate Q** (or the candidate-final auto-trigger
fires), the app runs the interviewer follow-up pipeline. In **Expert mode** this
is a 7-block LLM chain (A→B→C→D→E→F→G) that can take tens of seconds — Block E
runs on the Pro model and is by far the slowest. Today the only feedback is the
button flipping to "Generating…". This feature adds a **real, step-based progress
card** in the chat stream so the interviewer can see which stage the pipeline is
on and that it is still working.

## Scope

- **Expert mode:** real per-block progress, 6 user-visible phases, weighted by
  expected duration, with Chinese step labels.
- **Fast mode:** an **indeterminate** variant of the same card (pulse/scroll
  animation + "生成追问中…"), since Fast has no block-level events.
- Out of scope: a user-facing cancel/abort control; reworking the existing
  "Generating…" button state (it stays, complementary to the card).

## Phases & weights (Expert)

Block A and Block C run in parallel (`A∥C → B → D → E → F → G`), so they collapse
into a single visible phase. Six phases total:

| # | phase id | label (zh) | block(s) | weight |
|---|----------|------------|----------|--------|
| 1 | `answer` | 拆解回答、梳理上下文… | A ∥ C | 0.15 |
| 2 | `gaps`   | 查找证据缺口…        | B       | 0.12 |
| 3 | `pool`   | 生成候选问题…        | D       | 0.18 |
| 4 | `rank`   | 排序打分（深度推理）… | E       | 0.35 |
| 5 | `safety` | 安全审查…            | F       | 0.10 |
| 6 | `render` | 整理成稿…            | G       | 0.10 |

Weights sum to 1.0 and are tunable constants. The `rank` phase (Block E) carries
the largest weight because it is the slowest leg; this keeps the bar moving
proportionally rather than stalling on an equal-1/6 segment.

A phase is "done" whether its block **succeeds or falls back** — a transport
failure that triggers the orchestrator's fallback synthesizer still advances the
bar (the chain continues regardless, so the UI must too).

## Architecture (4 layers)

### 1. Orchestrator — `src/main-process/features/interviewer/expert-orchestrator.js`

`runExpertChain({ ..., onProgress = null })` gains an optional callback. At each
phase boundary it invokes:

```
onProgress({ phase, index, total: 6, status })   // status: 'start' | 'done'
```

- `answer`: emit `start` before `Promise.all([aPromise, cPromise])`, `done` after
  both resolve.
- `gaps`/`pool`/`rank`/`safety`/`render`: `start` before the block's `callBlock`,
  `done` after it returns (ok or fallback).
- The callback is wrapped in try/catch at every call site — **it must never throw
  into the chain**. A throwing/absent callback degrades to no progress, never a
  failed generation.
- `onProgress` is independent of the existing `onSessionState` (Block H) callback.

### 2. Runtime — `src/main-process/features/interviewer/interviewer-runtime.js`

`analyzeCandidateAnswerExpert({ candidateAnswer, questionHistory, emotion, requestId })`
passes an `onProgress` into `runExpertChain` that forwards to the renderer via the
already-wired `sendToRenderer`:

```
sendToRenderer('interviewer-progress', { requestId, phase, index, total, status })
```

`requestId` is threaded from the IPC payload (below). `sendToRenderer` is the same
optional collaborator already used for `session-context-updated`; if absent, the
runtime simply emits nothing (no behavior change).

The phase **label** text is owned by the renderer (keeps prompt/block files free
of UI copy); main emits only `phase` id + `index`/`total`.

### 3. IPC + preload

- **Renderer** generates a monotonic `requestId` (simple incrementing counter)
  per analyze call and includes it in the `interviewerAnalyzeAnswer` payload.
- **`src/main-process/features/interviewer/ipc.js`**: the
  `interviewer-analyze-answer` handler reads `requestId` and passes it through to
  `analyzeCandidateAnswer` → `analyzeCandidateAnswerExpert`, which stamps it onto
  every progress event. The final invoke result also echoes `requestId`.
- New one-way channel **`interviewer-progress`** (main → renderer).
- **`src/windows/assistant/preload/listeners.js`**: expose
  `onInterviewerProgress(cb)`, mirroring the `session-context-updated` listener
  registration at `listeners.js:110`.
- **`src/windows/assistant/preload/actions.js`**: `interviewerAnalyzeAnswer`
  already exists (line 225) — the only change is the renderer adding `requestId`
  to the payload it passes.

`requestId` guards against stale events: analysis is coalesced (one in flight at a
time, see `interviewerAnalysisInFlight`), but a late event from a previous run
must not move a freshly-started card. The renderer ignores progress whose
`requestId` ≠ the active card's.

### 4. Renderer

New module **`src/windows/assistant/renderer/features/chat/progress-card.js`**:

```
createProgressCard({ chatMessagesElement, isAutoScrollEnabled })
  → { start({ requestId, mode }), advance(evt), finish(requestId), fail(requestId) }
```

- `start({ requestId })` inserts a chat-stream DOM node (`.chat-progress-card`,
  reusing the `lane-ai` indigo styling) with a `.chat-progress__bar >
  .chat-progress__fill` and a `.chat-progress__label`. Stores the active
  `requestId`. **The card always starts indeterminate** (CSS pulse/scroll
  animation, label "生成追问中…", no step text) — the renderer does NOT need to
  know the mode up front. This is the final state for Fast mode.
- `advance({ requestId, phase, index, total, status })`: ignore if `requestId` ≠
  active. The **first** advance event upgrades the card from indeterminate to
  determinate (Fast mode never sends progress, so it stays indeterminate). Maps
  `phase` → `{ label, weightCeiling }` from a local table that mirrors the
  orchestrator phase ids. On `start`, set the fill target to the segment start and
  begin a `requestAnimationFrame` **creep** toward `segmentEnd − ε` (so a slow
  Block E keeps inching forward). On `done`, snap to `segmentEnd` and update the
  label to the next phase.
- `finish(requestId)`: snap to 100%, then remove the card. The caller then renders
  the real question via existing `renderQuestionCard` / `renderInterviewerCoachMessage`.
- `fail(requestId)`: remove the bar; optionally leave a brief "未能生成追问" note
  that auto-dismisses.

**Wiring in `src/windows/assistant/renderer.js`** (`triggerInterviewerAnalysis`,
~line 189):
- Before the invoke: `progressCard.start({ requestId })` (always indeterminate).
  Expert's first `interviewer-progress` event upgrades it to determinate; Fast
  sends no progress and stays indeterminate. No mode lookup needed in the renderer.
- Register `window.electronAPI.onInterviewerProgress(evt => progressCard.advance(evt))`
  once at init.
- On `response`: `progressCard.finish(requestId)` then existing render path.
- On `skipped`/error/`success === false`: `progressCard.fail(requestId)`.

### 5. CSS — `src/windows/assistant/renderer/features/chat/chat.css`

Add `.chat-progress-card`, `.chat-progress__bar`, `.chat-progress__fill`,
`.chat-progress__label`, and an indeterminate modifier (e.g.
`.chat-progress-card.is-indeterminate .chat-progress__fill`). Colours pull from the
existing `--ai` / interviewer-lane CSS variables — **no hard-coded colours**. The
determinate fill animates via a `width` transition; creep is driven by JS rAF
setting the width.

## Phase metadata: single source of truth

Phase **ids + order + total** are defined in the orchestrator (the emitter).
Phase **labels (zh) + weights + animation** live in a renderer-side table keyed by
the same ids. The only thing duplicated across the process boundary is the set of
phase id strings; weights/labels are UI concerns and stay in the renderer.

## Error handling & edge cases

- **Block fallback (transport error/timeout):** orchestrator still emits the
  phase's `done` — the bar advances. The chain never aborts mid-way for this.
- **Chain throws / `skipped`:** runtime catches and returns a skipped/error
  result; renderer calls `progressCard.fail`. No orphaned bar.
- **Safety verdict `block` → G fallback:** still produces output and emits
  `render` done; normal finish.
- **Coalesced / pending answer:** each analyze call gets a fresh `requestId`;
  the in-flight card is finished/failed before the next `start`. Stale events are
  dropped by the `requestId` check.
- **`sendToRenderer` not wired:** no progress events; card (if started) stays at
  its initial state until `finish`/`fail` — harmless. (In practice it IS wired,
  see `start-application.js:241`.)
- **Fast mode:** no progress events arrive; the indeterminate card animates until
  `finish`/`fail`.

## Testing

- **Orchestrator unit test** (node-level, the testable layer): assert
  `runExpertChain` invokes `onProgress` with the 6 phases in order, each with a
  `start` then `done`, correct `index`/`total`; assert a throwing `onProgress`
  does not break the returned result; assert a forced block fallback still emits
  that phase's `done`. Use the existing fixture/mocked-transport approach
  (`DASHSCOPE_TRANSPORT` / stubbed `dashscopeChat`) so no live API calls.
- **Progress-model unit** (if a renderer test harness is available): cumulative
  segment boundaries from the weight table sum to 100%; `advance` with a stale
  `requestId` is a no-op.
- **Manual / E2E:** launch the app, Expert mode, click **Generate Q**; observe the
  bar stepping through the 6 labels and creeping during `rank`; confirm it is
  replaced by the real question card. Repeat in Fast mode for the indeterminate
  variant. (Realistically the renderer DOM/animation is verified manually here,
  not by automated coverage.)

## Files touched

- `src/main-process/features/interviewer/expert-orchestrator.js` — `onProgress` param + phase emissions
- `src/main-process/features/interviewer/interviewer-runtime.js` — forward `onProgress` → `sendToRenderer('interviewer-progress', …)`, thread `requestId`
- `src/main-process/features/interviewer/ipc.js` — read/forward `requestId`, echo in result
- `src/windows/assistant/preload/listeners.js` — `onInterviewerProgress(cb)` on `interviewer-progress`
- `src/windows/assistant/renderer/features/chat/progress-card.js` — **new** card module
- `src/windows/assistant/renderer.js` — generate `requestId`, start/advance/finish/fail wiring
- `src/windows/assistant/renderer/features/chat/chat.css` — card styles

## Obsidian note (post-implementation)

Per CLAUDE.md, after landing this create/update an Implementation note at
`C:\Users\Thomas\Documents\Obsidian\WTATC\Interview Copilot\Implementation\`
covering the `interviewer-progress` channel, the phase table, and the
weighted-creep progress model.
