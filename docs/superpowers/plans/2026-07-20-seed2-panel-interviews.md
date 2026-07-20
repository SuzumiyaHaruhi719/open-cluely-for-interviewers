# Seed ASR 2.0 Speaker Clustering and Panel Interviews — Implementation Plan

> Execute with `superpowers:executing-plans`; use test-driven development for every behavior change.

**Goal:** Enable native Doubao Seed ASR 2.0 speaker clustering and make automatic follow-up delegation understand multiple interviewers speaking with one candidate.

**Architecture:** Keep ASR acoustic identity and interview role as separate layers. Doubao supplies stable speaker clusters when available; the existing DeepSeek partitioner maps any number of clusters to `interviewer` or `candidate` and weakly corrects obvious semantic mistakes. The continuous Flash monitor receives recent interviewer context plus candidate-only evidence, while the expert generator may anchor questions only to candidate evidence.

**Constraints:** Use only Seed ASR 2.0 duration/concurrency resources, never ASR 1.0 or CAM++. Keep Chinese as the fixed product language. Preserve the existing GLP UI language. Work directly on `main` per the user's instruction, with small commits and pushes.

## Task 1: Enable and normalize native Doubao speaker clusters

**Files:**
- Modify: `web-app/server/test/volc-client.test.ts`
- Modify: `web-app/server/src/volc-client.ts`
- Modify: `web-app/server/src/asr-relay.ts`

1. Add failing tests proving the Seed request contains `enable_speaker_info: true` and `ssd_version: "200"` without an ASR language override or bidirectional-only `enable_nonstream` flag.
2. Add failing parser cases for integer/string speaker IDs found at utterance top level and in object/JSON-string `additions`; reject empty, negative, fractional, or nonnumeric IDs.
3. Run `npm test -- --run server/test/volc-client.test.ts` and confirm RED.
4. Implement the minimal request flags and strict `speakerId?: number` normalization.
5. Run the focused test again and confirm GREEN; run `git diff --check`.
6. Commit and push this checkpoint.

## Task 2: Make the settings choice truthful

**Files:**
- Modify: `web-app/web/src/desktop/SettingsModal.test.tsx`
- Modify: `web-app/web/src/desktop/SettingsModal.tsx`

1. Add a failing assertion for `豆包 Seed ASR 2.0 · 原生说话人分离`.
2. Run the focused test and confirm RED.
3. Change only the provider label, preserving the existing GLP structure and styling.
4. Run the focused test and confirm GREEN.
5. Commit and push this checkpoint.

## Task 3: Retain panel-interviewer context in the continuous Flash monitor

**Files:**
- Modify: `web-app/server/test/auto-trigger.test.ts`
- Modify: `web-app/server/test/auto-monitor.test.ts`
- Modify: `web-app/server/src/auto-trigger.ts`
- Modify: `web-app/server/src/auto-monitor.ts`

1. Add failing tests proving back-to-back interviewer turns accumulate before a candidate reply, a new interviewer turn after candidate evidence replaces stale context, candidate evidence remains candidate-only, and reset clears both windows.
2. Add a failing monitor prompt test proving recent interviewer context is present but explicitly forbidden as an evidence source.
3. Run focused tests and confirm RED.
4. Add bounded `interviewerContext` state/input (1,500 characters), wire it through the trigger decision, and preserve all existing silence/evidence gates.
5. Run focused tests and confirm GREEN.
6. Commit and push this checkpoint.

## Task 4: Wire panel context through expert generation and role partitioning

**Files:**
- Modify: `web-app/server/test/expert-question.test.ts`
- Modify: `web-app/server/test/speaker-partitioner.test.ts`
- Modify: `web-app/server/src/expert-question.ts`
- Modify: `web-app/server/src/ws.ts`

1. Add a failing expert prompt test showing interviewer context can prevent repetition but cannot satisfy candidate evidence anchors.
2. Add a characterization test with two interviewer clusters and one candidate cluster mapping correctly in the same transcript.
3. Run focused tests and confirm RED only for the missing expert/ws behavior.
4. Pass interviewer text into the trigger, monitor, and expert request; keep anchor validation strictly against candidate text.
5. Run all four focused suites and confirm GREEN.
6. Commit and push this checkpoint.

## Task 5: Extend the live-audio QA harness

**Files:**
- Modify: `web-app/scripts/live-asr-lib.test.mjs`
- Modify: `web-app/scripts/live-asr-lib.mjs`
- Modify: `web-app/scripts/verify-live-asr.mjs`

1. Add failing tests for an `--auto-generate` option and report fields covering monitor states, generated questions, anchor sequence, token use, and latency.
2. Run `node --test scripts/live-asr-lib.test.mjs` and confirm RED.
3. Implement the option and credential-free report capture.
4. Run the focused test and confirm GREEN.
5. Commit and push this checkpoint.

## Task 6: Production-grade verification and documentation

**Files:**
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-audio-capture.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/speaker-role-auto-partition.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/webapp-auto-question-generation.md`

1. Run the real MP3 through Seed ASR 2.0 at real-time speed with auto generation enabled; verify lifecycle, real Chinese transcripts, observed native speaker IDs, final role partition, monitor activity, and any generated question.
2. If the provider returns a different credential-free speaker metadata shape, add a failing fixture first, then extend only the normalizer.
3. Update the three implementation notes with purpose, entry points, data flow, config/state, and gotchas.
4. Run `npm test`, `npm run build`, `git diff --check`, and the production health check.
5. Rebuild/restart the app on port 8788 and perform a focused in-app-browser acceptance check of the settings label and live transcript/inline auto-question path.
6. Read and apply `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`; because the user explicitly chose direct `main` work, verify and push `main` rather than opening a feature PR.
