# Doubao Live Caption Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Doubao Seed ASR 2.0 feed genuine rolling hypotheses to the existing `输入中…` character-progressive renderer without losing accurate second-pass text or native speaker clusters.

**Architecture:** Route Seed resources through Volcengine's optimized bidirectional endpoint and enable its nonstream second pass. Fast-pass `result.text` remains provisional UI state; only `definite` second-pass utterances carrying optional `speakerId` enter durable transcript and speaker-role processing.

**Tech Stack:** TypeScript, Node.js, `ws`, Volcengine SAUC v3 binary WebSocket protocol, React, Vitest/Node test runner.

## Global Constraints

- Doubao remains Seed ASR 2.0 only; never fall back to BigASR 1.0.
- Credentials remain environment-owned and never enter renderer settings or test fixtures.
- Default UI language remains Chinese and the live caption label remains `输入中…`.
- Work directly on `main`, commit and push frequently, as explicitly requested by the user.
- Do not delay semantic transcript delivery to perform a cosmetic animation.

---

### Task 1: Select the genuine rolling two-pass transport

**Files:**
- Modify: `web-app/server/src/volc-client.ts`
- Test: `web-app/server/test/volc-client.test.ts`

**Interfaces:**
- Consumes: `endpointForResource(resourceId: string): string`, `buildConfigPayload(model: string, sampleRate: number): Buffer`
- Produces: Seed endpoint `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`; request flags `enable_nonstream`, `enable_accelerate_text`, and `accelerate_score`

- [x] **Step 1: Write the failing endpoint and config assertions**

```ts
assert.equal(
  endpointForResource('volc.seedasr.sauc.duration'),
  'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
);
assert.equal(config.request.enable_nonstream, true);
assert.equal(config.request.enable_accelerate_text, true);
assert.equal(config.request.accelerate_score, 10);
```

- [x] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
./node_modules/.bin/tsx --test --test-name-pattern='buildConfigPayload|optimized bidirectional endpoint' server/test/volc-client.test.ts
```

Expected: two failures showing `_nostream` instead of `_async` and `enable_nonstream` undefined instead of true.

- [x] **Step 3: Implement the optimized two-pass request**

```ts
export const VOLC_WS_URL_ASYNC =
  'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

export function endpointForResource(resourceId: string): string {
  return /seedasr/i.test(resourceId) ? VOLC_WS_URL_ASYNC : VOLC_WS_URL;
}

request: {
  model_name: model,
  enable_punc: true,
  result_type: 'single',
  show_utterances: true,
  enable_nonstream: true,
  enable_accelerate_text: true,
  accelerate_score: 10,
  enable_speaker_info: true,
  ssd_version: '200'
}
```

- [x] **Step 4: Run the focused protocol suite**

Run:

```bash
./node_modules/.bin/tsx --test server/test/volc-client.test.ts
npm run typecheck --workspace @open-cluely/server
npm run build --workspace @open-cluely/server
```

Expected: 28 tests pass, typecheck exits 0, and `dist/index.js` builds.

- [x] **Step 5: Commit and push the protocol checkpoint**

```bash
git add web-app/server/src/volc-client.ts web-app/server/test/volc-client.test.ts
git commit -m "fix: stream Doubao captions before second-pass finals"
git push origin main
```

### Task 2: Prove rolling text and visible grapheme progression with the real MP3

**Files:**
- Verify: `web-app/scripts/verify-live-asr.mjs`
- Verify: `web-app/web/src/desktop/TranscriptStream.tsx`

**Interfaces:**
- Consumes: `/ws` audio frames and DOM attribute `[data-live-caption="visual"]`
- Produces: timestamped partial hypotheses and a visible one-grapheme-per-20-ms transition trace

- [x] **Step 1: Capture the sentence-return baseline**

Run a 35-second real-time replay of `/tmp/codex-interview-full.wav` through `verify-live-asr.mjs` before changing endpoints.

Expected: partial frames exist but collapse to one unique sentence-sized value, with the first partial around the end of the first long recognition window.

- [x] **Step 2: Replay the same audio through the optimized endpoint**

```bash
node web-app/scripts/verify-live-asr.mjs \
  --provider volc \
  --audio /tmp/codex-interview-full.wav \
  --url ws://127.0.0.1:8788/ws \
  --source mic \
  --frame-ms 40 \
  --speed 1 \
  --limit-seconds 35 \
  --no-diarize
```

Expected: multiple distinct prefix-growing partials such as `各位` → `各位考官，你们` → `各位考官，你们好`, followed by definitive speaker-tagged finals and no provider error.

- [x] **Step 3: Verify the visible browser state through BlackHole**

Select `BlackHole 2ch`, start the microphone lane, silently play the MP3 into BlackHole, and sample `.chat-message.is-live [data-live-caption="visual"]` every 20 ms.

Expected: the label is `输入中…`; successive values add exactly one grapheme during each reveal burst; Stop returns the channel to Closed; browser error/warning log is empty.

### Task 3: Document and release the behavior change

**Files:**
- Create: `docs/plans/2026-07-21-doubao-live-caption-stream-design.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/asr-pipeline.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-audio-capture.md`

**Interfaces:**
- Consumes: verified transport behavior and real-audio evidence
- Produces: contributor-facing endpoint/config invariants and release evidence

- [x] **Step 1: Record the architecture and implementation gotchas**

Document that `_nostream` is sentence-return mode, `_async` supplies rolling text, `enable_nonstream:true` preserves the accurate speaker-tagged second pass, and provisional text may rewrite its suffix.

- [x] **Step 2: Run the full project verification**

```bash
npm test
npm run typecheck --workspace @open-cluely/server
npm run build
```

Expected: every core, question-bank, server, and web test passes; server typecheck exits 0; the web build's `tsc -b` and both production bundles exit 0. The web workspace intentionally has no separate `typecheck` script.

- [x] **Step 3: Verify repository and production state**

```bash
git diff --check
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Expected: no whitespace errors; only intentional documentation changes remain before their commit; after push, the worktree is clean and `HEAD` equals `origin/main`.

- [x] **Step 4: Commit and push documentation/release evidence**

```bash
git add docs/plans/2026-07-21-doubao-live-caption-stream-design.md \
  docs/superpowers/plans/2026-07-21-doubao-live-caption-stream.md
git commit -m "docs: record Doubao live caption transport"
git push origin main
```

The Obsidian implementation-note repository auto-pushes independently per project policy and is therefore not staged in this repository.
