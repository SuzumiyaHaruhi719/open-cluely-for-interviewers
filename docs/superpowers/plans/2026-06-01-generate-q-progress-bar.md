# Generate-Q Expert Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a real, step-based progress card in the chat stream while the Expert follow-up chain runs (6 weighted phases with Chinese labels), and an indeterminate variant for Fast mode.

**Architecture:** The orchestrator emits phase `start`/`done` events through an `onProgress` callback; the runtime forwards them to the renderer over a new `interviewer-progress` IPC channel (correlated by `requestId`); a new renderer module draws a weighted progress card in the chat stream that creeps within a phase and snaps on completion.

**Tech Stack:** Electron (main + preload + renderer), vanilla JS, Node 22 built-in `node:test` runner, CSS custom properties.

---

## File Structure

- `src/main-process/features/interviewer/expert-orchestrator.js` — add `onProgress` param + 6-phase emissions (emitter, owns phase ids + order).
- `src/main-process/features/interviewer/interviewer-runtime.js` — forward `onProgress` → `sendToRenderer('interviewer-progress', …)`; thread `requestId`.
- `src/main-process/features/interviewer/ipc.js` — read `requestId` from payload, pass through, echo in result.
- `src/windows/assistant/preload/listeners.js` — expose `onInterviewerProgress(cb)` on `interviewer-progress`.
- `src/windows/assistant/renderer/features/chat/progress-card.js` — **new** card module (owns labels + weights + animation).
- `src/windows/assistant/renderer.js` — generate `requestId`, start/advance/finish/fail wiring, register listener; sample-interview seed.
- `src/windows/assistant/renderer/features/chat/chat.css` — card styles.
- `test/expert-progress.test.js` — **new** orchestrator progress-contract test.

Phase ids (emitter, in order): `answer`, `gaps`, `pool`, `rank`, `safety`, `render` (total 6). Labels + weights live in the renderer.

---

## Task 1: Orchestrator emits 6-phase progress

**Files:**
- Modify: `src/main-process/features/interviewer/expert-orchestrator.js`
- Test: `test/expert-progress.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/expert-progress.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');

// Stub global.fetch BEFORE requiring the orchestrator so dashscopeChat uses it.
// Returning `{}` makes every block fail schema validation → repair → fallback.
// Progress must still advance through all 6 phases regardless of block success.
function stubFetchAlways(text) {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }], usage: null, model: 'stub' })
  });
}

const { runExpertChain } = require('../src/main-process/features/interviewer/expert-orchestrator');

const EXPECTED_PHASES = ['answer', 'gaps', 'pool', 'rank', 'safety', 'render'];

test('emits start+done for all 6 phases in order, even when blocks fall back', async () => {
  stubFetchAlways('{}');
  const events = [];
  await runExpertChain({
    apiKey: 'test-key',
    candidateAnswer: 'I led the migration and cut latency a lot.',
    onProgress: (e) => events.push(e)
  });

  // Each phase fires exactly one 'start' then one 'done', in declared order.
  const starts = events.filter((e) => e.status === 'start').map((e) => e.phase);
  const dones = events.filter((e) => e.status === 'done').map((e) => e.phase);
  assert.deepStrictEqual(starts, EXPECTED_PHASES);
  assert.deepStrictEqual(dones, EXPECTED_PHASES);

  // index/total are consistent.
  for (const e of events) {
    assert.strictEqual(e.total, 6);
    assert.strictEqual(e.index, EXPECTED_PHASES.indexOf(e.phase) + 1);
  }

  // 'start' of phase N precedes 'done' of phase N precedes 'start' of phase N+1.
  const seq = events.map((e) => `${e.phase}:${e.status}`);
  assert.deepStrictEqual(seq, EXPECTED_PHASES.flatMap((p) => [`${p}:start`, `${p}:done`]));
});

test('a throwing onProgress never breaks the chain', async () => {
  stubFetchAlways('{}');
  const result = await runExpertChain({
    apiKey: 'test-key',
    candidateAnswer: 'I led the migration and cut latency a lot.',
    onProgress: () => { throw new Error('boom'); }
  });
  assert.ok(result && result.output, 'chain still resolves with an output');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/expert-progress.test.js`
Expected: FAIL — `onProgress` is never called, so `starts`/`dones` are `[]` and the deepStrictEqual assertions fail.

- [ ] **Step 3: Add the `onProgress` param and emitter helper**

In `src/main-process/features/interviewer/expert-orchestrator.js`, add `onProgress = null` to the `runExpertChain({...})` destructured params (alongside `onSessionState = null`). Immediately after `const startedAt = Date.now();` add:

```javascript
  const TOTAL_PHASES = 6;
  const PHASE_INDEX = { answer: 1, gaps: 2, pool: 3, rank: 4, safety: 5, render: 6 };
  // Progress callback must NEVER throw into the chain — a broken UI callback
  // can't be allowed to fail a generation. Wrapped here once.
  function emitProgress(phase, status) {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ phase, index: PHASE_INDEX[phase], total: TOTAL_PHASES, status });
    } catch (_) { /* progress is best-effort; swallow */ }
  }
```

- [ ] **Step 4: Wrap each phase with start/done emissions**

`answer` (A∥C) — wrap the parallel section:

```javascript
  // A ∥ C — parallel
  emitProgress('answer', 'start');
  const aPromise = callBlock({
```
…and after `traces.push(...aResult.trace, ...cResult.trace);` add:
```javascript
  emitProgress('answer', 'done');
```

`gaps` (B) — before `const bResult = await callBlock({ blockId: 'B', …` add `emitProgress('gaps', 'start');`; after `if (!bResult.ok) fallbackTriggered.push('B');` add `emitProgress('gaps', 'done');`.

`pool` (D) — before `const dResult = await callBlock({ blockId: 'D', …` add `emitProgress('pool', 'start');`; after `if (!dResult.ok) fallbackTriggered.push('D');` add `emitProgress('pool', 'done');`.

`rank` (E) — before `const eResult = await callBlock({ blockId: 'E', …` add `emitProgress('rank', 'start');`; after `if (!eResult.ok) fallbackTriggered.push('E');` add `emitProgress('rank', 'done');`.

`safety` (F) — before `const fResult = await callBlock({ blockId: 'F', …` add `emitProgress('safety', 'start');`; after `if (!fResult.ok) fallbackTriggered.push('F');` add `emitProgress('safety', 'done');`.

`render` (G) — emit around the whole G branch so the fallback path (no LLM call) still completes the bar. Change:

```javascript
  // G — final render
  let blockG;
  emitProgress('render', 'start');
  if (!chosenPrimary) {
    blockG = blockGFallback({ primary: null, alternative: null });
    fallbackTriggered.push('G');
  } else {
    const gResult = await callBlock({
      blockId: 'G',
      /* …unchanged… */
    });
    traces.push(...gResult.trace);
    blockG = gResult.ok ? gResult.data : blockGFallback({ primary: chosenPrimary, alternative: chosenAlt });
    if (!gResult.ok) fallbackTriggered.push('G');
  }
  emitProgress('render', 'done');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/expert-progress.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add test/expert-progress.test.js src/main-process/features/interviewer/expert-orchestrator.js
git commit -m "feat(interviewer): emit 6-phase progress from expert chain"
```

---

## Task 2: Runtime forwards progress to renderer

**Files:**
- Modify: `src/main-process/features/interviewer/interviewer-runtime.js`

- [ ] **Step 1: Thread `requestId` into the expert path**

Change the signature of `analyzeCandidateAnswerExpert` (currently `async function analyzeCandidateAnswerExpert({ candidateAnswer, questionHistory, emotion })`) to accept `requestId`:

```javascript
  async function analyzeCandidateAnswerExpert({ candidateAnswer, questionHistory, emotion, requestId = null }) {
```

- [ ] **Step 2: Add a progress emitter and pass it into the chain**

Inside `analyzeCandidateAnswerExpert`, inside the `try {` before `const expertResult = await runExpertChain({`, the chain call gains an `onProgress`. Add this property to the `runExpertChain({...})` argument object (next to `onSessionState`):

```javascript
        // Forward per-phase progress to the renderer so the chat-stream
        // progress card can advance. No-op unless sendToRenderer is wired
        // (it is — see start-application.js). requestId correlates the events
        // to the card that started this analysis.
        onProgress: (evt) => {
          if (typeof sendToRenderer !== 'function') return;
          try {
            sendToRenderer('interviewer-progress', { requestId, ...evt });
          } catch (error) {
            console.error('Failed to emit interviewer-progress:', error?.message || error);
          }
        },
```

- [ ] **Step 3: Pass `requestId` from the public entry through to the expert path**

Change `analyzeCandidateAnswer` signature to accept `requestId`:

```javascript
  async function analyzeCandidateAnswer({ candidateAnswer, questionHistory = [], emotion = null, requestId = null } = {}) {
```

And update the expert dispatch call (currently `return analyzeCandidateAnswerExpert({ candidateAnswer: answer, questionHistory, emotion });`) to:

```javascript
      return analyzeCandidateAnswerExpert({ candidateAnswer: answer, questionHistory, emotion, requestId });
```

- [ ] **Step 4: Echo `requestId` in the expert result**

In the success `return {` object of `analyzeCandidateAnswerExpert` (the one with `mode: 'expert', iterationVersion: …`), add `requestId,` as the first property. Also add `requestId` to the skipped return: `return { mode: 'expert', skipped: true, requestId, reason: … };`. (This lets the renderer match the final result to the active card.)

- [ ] **Step 5: Verify the orchestrator test still passes**

Run: `node --test test/expert-progress.test.js`
Expected: PASS (runtime change doesn't touch the orchestrator; this confirms no accidental break in the shared module graph).

- [ ] **Step 6: Commit**

```bash
git add src/main-process/features/interviewer/interviewer-runtime.js
git commit -m "feat(interviewer): forward expert progress over interviewer-progress IPC"
```

---

## Task 3: IPC reads + forwards requestId

**Files:**
- Modify: `src/main-process/features/interviewer/ipc.js`

- [ ] **Step 1: Read `requestId` from payload and pass it through**

In `src/main-process/features/interviewer/ipc.js`, inside the `interviewer-analyze-answer` handler, after the `emotion` const block, add:

```javascript
      const requestId = payload && payload.requestId != null ? String(payload.requestId) : null;
```

Then update the `analyzeCandidateAnswer({ … })` call to include it:

```javascript
      const result = await interviewerRuntime.analyzeCandidateAnswer({
        candidateAnswer,
        questionHistory,
        emotion,
        requestId
      });
```

(The handler already spreads `...result` into the response, so the echoed `requestId` reaches the renderer automatically.)

- [ ] **Step 2: Commit**

```bash
git add src/main-process/features/interviewer/ipc.js
git commit -m "feat(interviewer): thread requestId through analyze-answer IPC"
```

---

## Task 4: Preload exposes onInterviewerProgress

**Files:**
- Modify: `src/windows/assistant/preload/listeners.js`

- [ ] **Step 1: Register the listener**

In `src/windows/assistant/preload/listeners.js`, after the `onSessionContext` declaration (around line 112), add:

```javascript
  const onInterviewerProgress = createEventListener(ipcRenderer, {
    channel: 'interviewer-progress',
    label: 'onInterviewerProgress'
  });
```

- [ ] **Step 2: Export it**

In the returned object at the bottom of `createEventActions`, add `onInterviewerProgress` after `onSessionContext`:

```javascript
    onSessionContext,
    onInterviewerProgress
```

- [ ] **Step 3: Commit**

```bash
git add src/windows/assistant/preload/listeners.js
git commit -m "feat(preload): expose onInterviewerProgress listener"
```

---

## Task 5: Renderer progress-card module

**Files:**
- Create: `src/windows/assistant/renderer/features/chat/progress-card.js`

- [ ] **Step 1: Create the module**

Create `src/windows/assistant/renderer/features/chat/progress-card.js`:

```javascript
// Chat-stream progress card for the interviewer Expert follow-up chain.
// Starts indeterminate ("生成追问中…"); the first Expert progress event upgrades
// it to a determinate, weighted bar. Fast mode sends no progress events, so the
// card stays indeterminate until finish/fail. Owns the phase labels + weights
// (UI concerns); the orchestrator only emits phase ids + index/total + status.

const PHASES = [
  { id: 'answer', label: '拆解回答、梳理上下文…', weight: 0.15 },
  { id: 'gaps',   label: '查找证据缺口…',         weight: 0.12 },
  { id: 'pool',   label: '生成候选问题…',         weight: 0.18 },
  { id: 'rank',   label: '排序打分（深度推理）…', weight: 0.35 },
  { id: 'safety', label: '安全审查…',             weight: 0.10 },
  { id: 'render', label: '整理成稿…',             weight: 0.10 }
];

// Cumulative [start, end] fraction (0..1) for each phase, in declared order.
const BOUNDS = (() => {
  let acc = 0;
  const map = {};
  for (const p of PHASES) {
    const start = acc;
    acc += p.weight;
    map[p.id] = { start, end: acc, label: p.label };
  }
  return map;
})();

const CREEP_CEILING = 0.92; // fraction of the way to segment end the creep targets

export function createProgressCard({ chatMessagesElement, isAutoScrollEnabled = () => true }) {
  let activeRequestId = null;
  let cardEl = null;
  let fillEl = null;
  let labelEl = null;
  let rafId = null;
  let creepFrom = 0;   // fraction
  let creepTo = 0;     // fraction
  let creepStart = 0;  // ms timestamp
  let creepDurationMs = 0;

  function nearBottom() {
    if (!chatMessagesElement) return true;
    const d = chatMessagesElement.scrollHeight - chatMessagesElement.clientHeight - chatMessagesElement.scrollTop;
    return d <= 28;
  }

  function setFill(fraction) {
    if (!fillEl) return;
    const pct = Math.max(0, Math.min(100, fraction * 100));
    fillEl.style.width = `${pct}%`;
  }

  function stopCreep() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // Ease the fill from creepFrom toward creepTo over creepDurationMs, then hold.
  function creepTick(now) {
    const t = Math.min(1, (now - creepStart) / creepDurationMs);
    // easeOutCubic so it decelerates as it approaches the ceiling.
    const eased = 1 - Math.pow(1 - t, 3);
    setFill(creepFrom + (creepTo - creepFrom) * eased);
    if (t < 1) {
      rafId = requestAnimationFrame(creepTick);
    } else {
      rafId = null;
    }
  }

  function startCreep(from, to, durationMs) {
    stopCreep();
    creepFrom = from;
    creepTo = to;
    creepStart = performance.now();
    creepDurationMs = Math.max(200, durationMs);
    rafId = requestAnimationFrame(creepTick);
  }

  function start({ requestId } = {}) {
    remove(); // clear any stale card
    activeRequestId = requestId != null ? String(requestId) : null;

    const shouldScroll = nearBottom();
    cardEl = document.createElement('div');
    cardEl.className = 'chat-message interviewer-coach-message lane-ai chat-progress-card is-indeterminate';

    labelEl = document.createElement('div');
    labelEl.className = 'chat-progress__label';
    labelEl.textContent = '生成追问中…';

    const bar = document.createElement('div');
    bar.className = 'chat-progress__bar';
    fillEl = document.createElement('div');
    fillEl.className = 'chat-progress__fill';
    bar.appendChild(fillEl);

    cardEl.append(labelEl, bar);
    chatMessagesElement.appendChild(cardEl);
    if (shouldScroll && isAutoScrollEnabled()) {
      chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
    }
  }

  function advance(evt = {}) {
    if (!cardEl) return;
    const reqId = evt.requestId != null ? String(evt.requestId) : null;
    if (activeRequestId != null && reqId != null && reqId !== activeRequestId) return; // stale
    const bound = BOUNDS[evt.phase];
    if (!bound) return;

    // First real event upgrades from indeterminate to determinate.
    cardEl.classList.remove('is-indeterminate');

    if (evt.status === 'start') {
      labelEl.textContent = bound.label;
      // Creep across most of this segment over an estimated time; a slow phase
      // (rank/E) keeps inching forward instead of dead-stopping.
      const ceiling = bound.start + (bound.end - bound.start) * CREEP_CEILING;
      const estMs = Math.max(1200, (bound.end - bound.start) * 60000); // weight×60s heuristic
      startCreep(bound.start, ceiling, estMs);
    } else if (evt.status === 'done') {
      stopCreep();
      setFill(bound.end); // snap to segment end
    }
  }

  function finish(requestId) {
    if (!cardEl) return;
    if (requestId != null && activeRequestId != null && String(requestId) !== activeRequestId) return;
    stopCreep();
    setFill(1);
    remove();
  }

  function fail(requestId) {
    if (!cardEl) return;
    if (requestId != null && activeRequestId != null && String(requestId) !== activeRequestId) return;
    stopCreep();
    remove();
  }

  function remove() {
    stopCreep();
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    cardEl = null; fillEl = null; labelEl = null; activeRequestId = null;
  }

  return { start, advance, finish, fail };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/windows/assistant/renderer/features/chat/progress-card.js
git commit -m "feat(chat): add weighted progress-card module"
```

---

## Task 6: Wire the progress card in the renderer

**Files:**
- Modify: `src/windows/assistant/renderer.js`

- [ ] **Step 1: Import the module**

Near the existing chat import (`import { createChatUiManager } from './renderer/features/chat/chat-ui-manager.js';`, line 6), add:

```javascript
import { createProgressCard } from './renderer/features/chat/progress-card.js';
```

- [ ] **Step 2: Create the card instance after chatMessagesElement exists**

After `const chatUiManager = createChatUiManager({ … });` (the block starting at line 645), add:

```javascript
const interviewerProgressCard = createProgressCard({
    chatMessagesElement,
    isAutoScrollEnabled: () => autoScrollEnabled
});
let interviewerRequestSeq = 0;
```

(Use the same auto-scroll source `createChatUiManager` is given for `isAutoScrollEnabled`; if that local has a different name in this file, pass the same expression used in the `createChatUiManager({ … isAutoScrollEnabled })` call.)

- [ ] **Step 3: Register the progress listener once**

Inside `setupSessionContextPanel` is the wrong place; add a sibling near it. After the `setupSessionContextPanel` function definition (ends ~line 1255), add:

```javascript
function setupInterviewerProgressListener() {
    if (window.electronAPI?.onInterviewerProgress) {
        window.electronAPI.onInterviewerProgress((evt) => {
            interviewerProgressCard.advance(evt || {});
        });
    }
}
```

Then call `setupInterviewerProgressListener();` from `init()` right after the existing `setupSessionContextPanel();` call. (Search for `setupSessionContextPanel();` invocation and add the new call beneath it.)

- [ ] **Step 4: Start/finish/fail the card around the analysis**

In `triggerInterviewerAnalysis` (starts ~line 189), replace the body so the card brackets the invoke. The current block is:

```javascript
    interviewerAnalysisInFlight = true;
    try {
        const response = await window.electronAPI.interviewerAnalyzeAnswer({
            candidateAnswer,
            emotion,
            questionHistory: interviewerQuestionHistory.slice()
        });
```

Change to:

```javascript
    interviewerAnalysisInFlight = true;
    interviewerRequestSeq += 1;
    const requestId = String(interviewerRequestSeq);
    interviewerProgressCard.start({ requestId });
    try {
        const response = await window.electronAPI.interviewerAnalyzeAnswer({
            candidateAnswer,
            emotion,
            requestId,
            questionHistory: interviewerQuestionHistory.slice()
        });
```

Then handle the terminal states. The existing early returns must fail the card first. Update the three exit points inside the `try`:

1. After `if (!response || response.success === false) {` block — at its top add `interviewerProgressCard.fail(requestId);`.
2. Inside `if (response.skipped) {` — at its top add `interviewerProgressCard.fail(requestId);`.
3. On the success path, before `if (response.shouldShowFollowUps …)`, add `interviewerProgressCard.finish(requestId);`.

And in the `catch (err) {` block, add `interviewerProgressCard.fail(requestId);` as the first line.

- [ ] **Step 5: Manual verification (Expert)**

Run: `npm start`
In the running app: set interviewer mode to Expert (Settings), ensure a DashScope key is set, then click **Generate Q** with a candidate answer present (Task 8 seeds one). Expected: an indigo progress card appears, the bar steps through 拆解回答 → 查找证据缺口 → 生成候选问题 → 排序打分 (creeps here) → 安全审查 → 整理成稿, then is replaced by the real follow-up question card.

- [ ] **Step 6: Commit**

```bash
git add src/windows/assistant/renderer.js
git commit -m "feat(renderer): wire interviewer progress card into generate-q flow"
```

---

## Task 7: Progress card styles

**Files:**
- Modify: `src/windows/assistant/renderer/features/chat/chat.css`

- [ ] **Step 1: Append the card styles**

Append to `src/windows/assistant/renderer/features/chat/chat.css` (colours from existing `--ai` token; durations are local since the card is transient):

```css
/* ── Generate-Q progress card ──────────────────────────────────────────────
 * Transient chat-stream card shown while the Expert follow-up chain runs.
 * Determinate bar (JS sets --fill width); indeterminate variant for Fast mode.
 * Indigo --ai lane, consistent with .is-question-card. */
.chat-progress-card {
    --lane-accent: var(--ai);
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--ai) 28%, var(--hairline));
    border-left: 3px solid var(--ai);
    border-radius: 10px;
    background: color-mix(in srgb, var(--ai) 5%, var(--bg-elev));
}

.chat-progress__label {
    font-size: 12px;
    color: var(--ai);
    margin-bottom: 8px;
    letter-spacing: 0.01em;
}

.chat-progress__bar {
    position: relative;
    height: 6px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--ai) 14%, transparent);
}

.chat-progress__fill {
    height: 100%;
    width: 0%;
    border-radius: 999px;
    background: var(--ai);
    transition: width 220ms ease-out;
}

/* Indeterminate (Fast mode / pre-first-event): ignore the JS width and run a
 * sliding shimmer instead. */
.chat-progress-card.is-indeterminate .chat-progress__fill {
    width: 40% !important;
    transition: none;
    animation: chat-progress-slide 1.1s ease-in-out infinite;
}

@keyframes chat-progress-slide {
    0%   { transform: translateX(-110%); }
    100% { transform: translateX(280%); }
}

@media (prefers-reduced-motion: reduce) {
    .chat-progress-card.is-indeterminate .chat-progress__fill {
        animation: none;
        width: 100% !important;
        opacity: 0.5;
    }
    .chat-progress__fill { transition: none; }
}
```

- [ ] **Step 2: Manual verification**

Run: `npm start`; trigger Generate Q in both Fast and Expert modes. Expected: Fast shows a sliding shimmer; Expert shows a filling bar. No hard-coded colours (matches the indigo AI lane).

- [ ] **Step 3: Commit**

```bash
git add src/windows/assistant/renderer/features/chat/chat.css
git commit -m "style(chat): progress-card determinate + indeterminate styles"
```

---

## Task 8: Seed a sample interview chat for testing

**Files:**
- Modify: `src/windows/assistant/renderer.js`

Generate-Q reads the latest candidate transcript from the message store
(`getLatestCandidateTranscript`): online interviews → `voice-system` (Candidate)
lane; offline → `voice-mic`. The seed must put the candidate answer on the lane
matching the active interview type, and push prior interviewer questions into
`interviewerQuestionHistory` so the chain has history.

- [ ] **Step 1: Add a seed function**

In `src/windows/assistant/renderer.js`, near the other interviewer helpers (after `handleGenerateQuestionClick`, ~line 313), add:

```javascript
// Dev convenience: seed a short sample interview so Generate Q can be tested
// immediately without a live transcript. Idempotent — only seeds when the chat
// is empty. Flip SEED_SAMPLE_INTERVIEW to false to disable.
const SEED_SAMPLE_INTERVIEW = true;
function seedSampleInterview() {
    if (!chatMessagesElement) return;
    if (chatMessagesArray.length > 0) return; // don't clobber a real session
    const candidateType = activeInterviewType === 'offline' ? 'voice-mic' : 'voice-system';
    const turns = [
        { type: 'voice-mic', text: 'Tell me about a recent project where you owned the technical design.' },
        { type: candidateType, text: 'Sure. I led the migration of our payments service from a monolith to microservices. We had reliability issues during peak traffic, so I redesigned the order pipeline and introduced an async queue. After the rollout, p99 latency dropped a lot and the on-call pages basically stopped.' }
    ];
    for (const t of turns) {
        chatUiManager.addChatMessage(t.type, t.text);
        if (t.type === 'voice-mic') recordInterviewerQuestion(t.text);
    }
}
```

(If the helper that appends to `interviewerQuestionHistory` is named differently, use that name. The function pushing to `interviewerQuestionHistory` is defined near line 71 — match its actual name; if it is inline-only, replace `recordInterviewerQuestion(t.text)` with the same push+trim logic.)

- [ ] **Step 2: Call it once on init**

In `init()`, after the chat UI and listeners are set up (after `setupInterviewerProgressListener();` from Task 6), add:

```javascript
    if (SEED_SAMPLE_INTERVIEW) seedSampleInterview();
```

- [ ] **Step 3: Manual verification**

Run: `npm start`. Expected: on launch the chat already contains one interviewer question (You / amber) and one candidate answer (Candidate / teal in online, or mic lane in offline). Clicking **Generate Q** runs the chain against the seeded answer and shows the progress card.

- [ ] **Step 4: Commit**

```bash
git add src/windows/assistant/renderer.js
git commit -m "chore(dev): seed sample interview chat for generate-q testing"
```

---

## Self-Review notes

- **Spec coverage:** 6-phase emission + weights (Task 1, Task 5), runtime forward + requestId (Task 2/3), preload listener (Task 4), renderer card + wiring (Task 5/6), CSS determinate + indeterminate (Task 7), Fast-mode indeterminate (Task 5 `is-indeterminate` start state), error/skip handling (Task 6 fail calls), sample seed for testing (Task 8). Block-fallback-still-advances is covered by emitting `done` after the `fallbackTriggered.push` lines and verified by the Task 1 test (which forces all blocks to fall back).
- **Type/name consistency:** the card API `start({requestId}) / advance(evt) / finish(id) / fail(id)` is used identically in Task 5 (definition) and Task 6 (call sites). Phase ids `answer/gaps/pool/rank/safety/render` match between orchestrator (Task 1) and renderer table (Task 5). Channel name `interviewer-progress` matches across runtime (Task 2), preload (Task 4).
- **Verify-at-execution:** the exact name of the auto-scroll local in `renderer.js` and the `interviewerQuestionHistory` push helper must be confirmed when editing (noted inline in Task 6 Step 2 and Task 8 Step 1).
