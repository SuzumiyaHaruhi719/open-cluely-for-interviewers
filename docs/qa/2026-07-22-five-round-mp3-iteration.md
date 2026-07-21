# Five-Round MP3 Product Iteration Journal

## Test contract

- Date/timezone: 2026-07-22, Asia/Shanghai.
- Starting build: `54a5b7f` (`main`).
- Provider: Doubao Seed ASR 2.0 (`volc`).
- Question path: Balanced Auto gate → DeepSeek V4 Flash Expert.
- Playback: complete normalized source at 1× unless a round explicitly records an additional focused diagnostic.
- Design: `docs/superpowers/specs/2026-07-22-five-round-alternating-mp3-iteration-design.md`.
- Plan: `docs/superpowers/plans/2026-07-22-five-round-alternating-mp3-iteration.md`.

## Immutable fixtures

### A — Property interview

- Source: `/Users/thomasli/Downloads/Bilibili Interview 86.6.mp3`.
- SHA-256: `c646c5e3d002c0ed606022abda5f72819351c7d0bdeb04f2e4ad6f8c8ef93980`.
- Container: AAC audio in ISO Base Media/MP4 despite the `.mp3` suffix.
- Duration: 00:07:24.15.
- Temporary normalized fixture: `/tmp/open-cluely-five-round-20260722/property-16k.wav`.
- Context: built-in `物业经理` JD and 100-point guide.

### B — P7/P8 user-operations interview

- Source: `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`.
- SHA-256: `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`.
- Container: AAC audio in ISO Base Media/MP4 despite the `.mp3` suffix.
- Duration: 00:08:13.52.
- Temporary normalized fixture: `/tmp/open-cluely-five-round-20260722/p7p8-16k.wav`.
- Context: built-in `用户运营专家（P8）` in round 2 and `用户运营专家（P7）` in round 4.

The `(1)` and non-`(1)` copies of each source have matching hashes and are not counted as distinct fixtures.

## Round 1 — A / 物业经理

Status: fixed, replayed, committed, and pushed.

### Run

- Baseline build: `ae89b40`.
- Fixed build: `eb2e796`.
- Before report: `/tmp/open-cluely-five-round-20260722/round-1-before.json`.
- After report: `/tmp/open-cluely-five-round-20260722/round-1-after.json`.
- Exact command, with the output filename changed between runs:

```bash
node scripts/verify-live-asr.mjs --provider volc \
  --audio /tmp/open-cluely-five-round-20260722/property-16k.wav \
  --speed 1 --auto-generate \
  --job-description-file /tmp/open-cluely-five-round-20260722/context/property-jd.txt \
  --interview-guide-file /tmp/open-cluely-five-round-20260722/context/property-guide.json \
  --out /tmp/open-cluely-five-round-20260722/round-1-before.json
```

The after-run was also played through `BlackHole 2ch` into the rebuilt visible app. The product was configured as `线下面试`, with the built-in `物业经理` profile and one microphone lane.

### Problem encountered from the interviewer’s perspective

The aggregate acceptance report passed, but both baseline Auto follow-ups used the same ownership template against two different answers:

1. `你提到“…动员工作…”，当时哪个关键决策最能证明这是你亲自主导的？`
2. `你提到“…赶赴现场…”，当时哪个关键决策最能证明这是你亲自主导的？`

An interviewer would experience this as an assistant stuck on one question pattern. It also defeated the history-aware fallback rotation added previously.

### Root cause

The first divergent boundary was the server’s Expert input. Automatic generation in `web-app/server/src/ws.ts` explicitly passed `questionHistory: []`, and `runExpertQuestionAndEmit()` returned no emitted question for the connection to record. The browser could send history for a manual click, but Auto is server-initiated, so the renderer could not repair the missing state.

The failing WebSocket regression sent two generation requests on one connection without client history. Before the fix, the second Expert prompt contained:

```text
[已问问题]
无
```

The test failed with `2 passed, 1 failed`, matching the live symptom.

### Fix

- Added a bounded, de-duplicated, connection-scoped question ledger with a limit of eight questions.
- `runExpertQuestionAndEmit()` now returns the non-stale emitted question.
- Both manual and Auto paths merge client history, pass a server snapshot to Expert, and record the emitted result.
- `resetGeneration` clears the ledger so a new interview cannot inherit old questions.
- Stale/reset generations return `null` and are never recorded.

### Verification and replay evidence

- Focused red test: `npx tsx --test test/ws-sim-injection.test.ts` → the second prompt reported `[已问问题] 无`.
- Focused green test: the same command → `3 passed, 0 failed`.
- Full server suite: `269 passed, 0 failed`.
- Production web/server build completed with exit code 0.
- After report: `qaPassed=true`; lifecycle `connecting → live → finalizing → stopped`; 28 finals; 939 partials; first final 15.680 s; source stream 444.162 s for 444.151 s of audio; no errors.
- Native IDs: `0, 1, 2`; substantive IDs `0, 1` delegated; ID `2` was the short score-announcement voice and safely remained pending; no mixed role and no invalid partition.
- Final partition: 6 interviewer segments, 6 candidate segments, 1 unknown segment; final partition arrived before stopped.
- Two Auto questions were anchored to delegated candidate evidence, used 738 and 1,891 total tokens, and completed in 3.630 s and 4.514 s.
- The replayed questions were distinct: the first verified which preparation decisions the candidate personally owned; the second asked for a comparable repeated-failure case rather than repeating the ownership template.
- Visible app showed rolling `输入中…` text, chronologically ordered finals, whole-voiceprint role labels, inline question cards, real token counts, and a closed capture state after finalization.

### Remaining evidence carried forward

During visible playback, an Expert generation remained in flight after the candidate resumed speaking, and a fallback measurement question was contextually awkward for conflict mediation. These are separate problems and are not counted as fixed in Round 1.

## Round 2 — B / 用户运营专家（P8）

Status: pending Round 1 checkpoint.

## Round 3 — A / 物业经理

Status: pending Round 2 checkpoint.

## Round 4 — B / 用户运营专家（P7）

Status: pending Round 3 checkpoint.

## Round 5 — A / 物业经理

Status: pending Round 4 checkpoint.

## Completion audit

Status: pending all five verified rounds.
