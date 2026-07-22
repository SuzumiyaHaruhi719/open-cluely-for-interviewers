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

Status: fixed, replayed, committed, and pushed.

### Run

- Baseline build: `bd86c0b` (Round 1 product behavior plus its journal checkpoint).
- Fixed product build: `c5bb7ac`.
- Before report: `/tmp/open-cluely-five-round-20260722/round-2-before.json`.
- After report: `/tmp/open-cluely-five-round-20260722/round-2-after.json`.
- Exact command, with the output filename changed between runs:

```bash
node scripts/verify-live-asr.mjs --provider volc \
  --audio /tmp/open-cluely-five-round-20260722/p7p8-16k.wav \
  --speed 1 --auto-generate \
  --job-description-file /tmp/open-cluely-five-round-20260722/context/p8-jd.txt \
  --interview-guide-file /tmp/open-cluely-five-round-20260722/context/p8-guide.json \
  --out /tmp/open-cluely-five-round-20260722/round-2-after.json
```

Both before and after runs were also replayed at 1× through `BlackHole 2ch` into the visible rebuilt app with the built-in `用户运营专家（P8）` context. The direct WebSocket run and browser capture were independent Seed ASR sessions so provider clustering differences were observable instead of hidden.

### Problem encountered from the interviewer’s perspective

The aggregate baseline report passed, but the visible app rendered the closing exchange as:

1. 面试官：`现在在北京是吧？`
2. **面试官：`啊对。`**
3. 面试官：`考虑来杭州吗？`
4. **面试官：post-interview commentary**

The user would see a candidate's direct answer confidently assigned to the interviewer. The direct CLI replay happened to cluster `啊对` with the candidate, showing that the failure depended on Seed's acoustic clustering and could not be dismissed as a renderer-only typo.

Using the visible role toggle as a diagnostic changed exactly three bubbles together: the opening narrator, `啊对`, and the closing commentary. This proved that Seed had placed all three in one native voiceprint and that the UI was correctly honoring the atomic voiceprint rule; the automatic cohort decision itself was wrong.

### Root cause

The two semantic audits and the two cohort audits allowed `unknown`, but neither prompt explicitly defined voice-over narration, intros/outros, or post-interview commentary as non-participant speech. With only interviewer/candidate examples in the prompt, both Flash layers forced a narrator-heavy native cluster into the interviewer cohort. The short `啊对` fragment was not enough to safely overturn the whole already-delegated voiceprint.

The acceptance harness had a related policy mismatch: `allSubstantiveSpeakersDelegated` failed every substantive pending ID, even when the final assignment was the approved explicit `unknown/observing` fail-safe and that ID never entered Auto.

### Fix

- Added one shared non-participant rule to every required-turn classifier mode: narration, intro/outro voice-over, and off-interview commentary must return `unknown`, even when the words mention an interview, candidate, or outcome.
- Added the same rule to both reversed-order whole-voiceprint cohort audits, so an atomic narrator-contaminated ID remains unresolved instead of being forced into either participant cohort.
- Preserved the core invariant: the client still assigns one role to the complete native ID; it does not relabel `啊对` independently.
- Replaced the harness's “every substantive ID must be delegated” gate with `ambiguousSpeakersFailSafe`. A pending substantive ID passes only when the final partition explicitly represents it as `unknown` with `observing|contested` state and `unknown` source. Missing or structurally inconsistent pending assignments still fail, and any Auto result anchored outside a delegated candidate still fails independently.
- Added `unsafePendingSpeakerIds` and `unsafePendingSubstantiveSpeakerIds` to the machine report so safe ambiguity and an actual missing assignment are distinguishable.

### Red/green evidence

- Focused prompt-contract test before the product fix: `npx tsx --test test/speaker-partitioner.test.ts test/speaker-cohort.test.ts` → `55 passed, 2 failed`; neither audit input contained the non-participant rule.
- Focused product test after the fix: the same command → `57 passed, 0 failed`.
- Full server suite after the product fix: `269 passed, 0 failed`.
- Harness regression before its fix: `node --test scripts/live-asr-lib.test.mjs` → the safe explicit pending fixture failed because `unsafePendingSubstantiveSpeakerIds` did not exist.
- Harness regression after its fix: `6 passed, 0 failed`, including a counter-test where a substantive ID has no final fail-safe assignment and must still fail QA.
- Production web/server build completed with exit code 0.

### Full replay evidence

- Direct after-run: lifecycle `connecting → live → finalizing → stopped`; 48 finals; 1,304 partials; 493.550 s of source streaming for 493.517 s of audio; no errors.
- Final native IDs: `0` interviewer, `1` candidate, `2` explicit `unknown/observing` with `audit_no_consensus`; no mixed role and no invalid partition.
- Final partition: 12 interviewer segments, 12 candidate segments, 3 unknown segments. The opening narration, one narrator-contaminated interview prompt, and the closing commentary stayed unresolved.
- The exact direct-run boundary was `interviewer 0: 你现在在北京是吗？` → `candidate 1: 啊对。` → `interviewer 0: 考虑来杭州吗？` → `unknown 2: closing commentary`.
- The visible BlackHole replay independently ended as `面试官` → `候选人（啊，对。）` → `面试官` → `待确认 · 说话人 2`, and capture reached the closed state after finalization.
- Seven direct-run Auto questions were observed; every anchor belonged to the delegated candidate, all completed in 2.973–5.324 s, and none used narrator/pending evidence. The visible replay displayed four inline Auto cards with real token counts and 3.4–5.2 s latency.
- The saved after report was re-evaluated with the corrected harness against the same immutable replay evidence: `qaPassed=true`, `pendingSubstantiveSpeakerIds=[2]`, `unsafePendingSubstantiveSpeakerIds=[]`.

### Remaining evidence carried forward

The replay confirmed the Round 1 observation that generated fallback dimensions can be contextually awkward, and one visible Expert generation remained in progress while later speech arrived. Those are separate candidate defects for subsequent rounds. The safe pending narrator also leaves one acoustically contaminated interviewer prompt unresolved, which is intentionally preferable to a confident wrong identity and remains manually correctable.

## Round 3 — A / 物业经理

Status: fixed, replayed, committed, and pushed.

### Run

- Baseline build: `116a855`.
- Fixed product build: `4623ff1`.
- Baseline evidence: visible consecutive-session replay in the rebuilt app.
- After report: `/tmp/open-cluely-five-round-20260722/round-3-after.json`.
- Exact direct replay command:

```bash
node scripts/verify-live-asr.mjs --provider volc \
  --audio /tmp/open-cluely-five-round-20260722/property-16k.wav \
  --speed 1 --auto-generate \
  --job-description-file /tmp/open-cluely-five-round-20260722/context/property-jd.txt \
  --interview-guide-file /tmp/open-cluely-five-round-20260722/context/property-guide.json \
  --out /tmp/open-cluely-five-round-20260722/round-3-after.json
```

The full after-run was played at 1× through `BlackHole 2ch` into a visible `线下面试` session while the direct harness ran independently. Two timestamped notes and both transcript scroll modes were exercised during playback.

### Problem encountered from the interviewer’s perspective

Ending the Round 2 P8 interview returned to a visually clean preparation screen. Starting the next `物业经理` microphone capture, however, immediately resurrected the complete previous P8 transcript before any new audio played. Every old row was stamped `00:00:00`; recognizable stale markers included the opening narration, `银行卡频道`, and the closing `白嫖方案` commentary.

This is a severe privacy and decision-integrity failure: the interviewer can mistake another candidate's evidence and AI questions for the current interview even though the setup page looked reset.

### Root cause

`useCopilotSocket()` already exposed `resetAudioSession()`, which suppresses audio and partition events while the old provider drains, but `Shell` never called it when an interview ended. `clearSession()` erased visible rows and reset the server model state only.

The browser's partition suppression was released when a new ASR `connecting/live` status arrived. A delayed full `speaker-partition` from the prior interview could then pass through after that release. Because the current-session timestamp maps had already been cleared, the stale partition rebuilt every old row with the current partition arrival time, which rendered as zero elapsed time.

### Fix

- Ending an interview now calls `resetAudioSession()` before clearing UI/model state. This stops both audio lanes and quarantines their drain before returning to preparation.
- End confirmation also sends a fresh `resetGeneration`, so transcript context, question history, cooldowns, speaker evidence, and in-flight generation are invalidated at the same boundary.
- The renderer now keeps an immutable raw-final evidence ledger for the current interview, keyed by final sequence.
- A `speaker-partition` is accepted only when every visible run starts from a raw final that exists in this interview and its native speaker ID (when present) and normalized text agree. A late prior-session snapshot is discarded even if a fresh ASR status has reopened normal event handling.
- The raw-final ledger is cleared together with timestamps and speaker identity state on every new interview.

### Red/green evidence

- Focused regression before the partition guard: `useCopilotSocket` accepted a prior-session final partition after the fresh ASR `connecting` event; targeted result was `55 passed, 1 failed`.
- Focused regression after the fix: `useCopilotSocket` plus `Shell` → `56 passed, 0 failed`.
- The Shell end-flow test now proves that confirmation adds a new `resetGeneration` frame rather than matching the reset already sent on initial setup.
- Full web suite: `36 files, 246 passed, 0 failed`.
- Production web/server build completed with exit code 0.

### Full replay and interaction evidence

- Direct after-run: `qaPassed=true`; lifecycle `connecting → live → finalizing → stopped`; 28 finals; 938 partials; 444.113 s of source streaming for 444.151 s of audio; no errors.
- Final partition arrived before stopped and contained 6 interviewer, 6 candidate, and 1 safe unknown segment. Native IDs `0` and `1` delegated; score-announcement ID `2` remained `unknown/observing`; both unsafe-pending lists were empty.
- Two Auto Expert questions were anchored to candidate seqs `14` and `20`, used real token counts, and completed in 3.529 s and 3.884 s.
- The visible replay contained no P8 markers, displayed two inline Auto questions, and preserved the two notes in creation order.
- Manual scroll was held at the beginning while transcript height grew from 901 px to 1,881 px without moving `scrollTop` from zero. Returning to the bottom restored follow-latest; after further speech the measured bottom distance remained exactly zero.
- After ending the completed property replay, a new microphone capture was started in the same tab with no audio. It remained empty and contained none of the prior speech, notes, or AI question text.

### Remaining evidence carried forward

The property replay again produced acceptable but ownership-heavy follow-ups. Round 4 will alternate back to the interruption-heavy P7/P8 fixture and inspect whether question generation is invalidated at real interviewer hand-offs instead of surviving on stale candidate evidence.

## Round 4 — B / 用户运营专家（P7）

Status: fixed, replayed, committed, and pushed.

### Run

- Baseline build: `f3011e3`.
- Fixed product build: `e6d7707`.
- Before report: `/tmp/open-cluely-five-round-20260722/round-4-before.json`.
- After report: `/tmp/open-cluely-five-round-20260722/round-4-after.json`.
- Exact command, with the output filename changed between runs:

```bash
node scripts/verify-live-asr.mjs --provider volc \
  --audio /tmp/open-cluely-five-round-20260722/p7p8-16k.wav \
  --speed 1 --auto-generate \
  --job-description-file /tmp/open-cluely-five-round-20260722/context/p7-jd.txt \
  --interview-guide-file /tmp/open-cluely-five-round-20260722/context/p7-guide.json \
  --out /tmp/open-cluely-five-round-20260722/round-4-after.json
```

Both runs were also played completely at 1× through `BlackHole 2ch` into a visible rebuilt app using the built-in `用户运营专家（P7）` profile. This round deliberately preserved the source's frequent interviewer interruptions and short interjections.

### Problem encountered from the interviewer’s perspective

The baseline visible replay generated an Auto question at about `00:01:29` about the candidate's self-introduction even though the interviewer had already changed the subject at `00:01:15` to redesigning the bank-card channel and the candidate was actively answering that new case. The question was individually plausible but belonged to a closed answer. In a live interview it would distract the interviewer, reopen a discarded topic, and make Auto appear unaware of the ongoing conversation.

The direct baseline happened to pass its aggregate gates and generated eight questions, demonstrating why role correctness and sub-10-second latency alone were insufficient acceptance criteria. The visible session exposed the temporal defect.

### Root cause

Whole-voiceprint cohorts become eligible at different refreshes. A candidate cohort can therefore be delegated after a newer interviewer turn has already closed its older answer. When that happened, `speaker-partitioner` replayed every previously buffered candidate turn into Auto, including the stale self-introduction.

The first attempted repair used only confirmed native interviewer callbacks as a closure boundary. A full replay disproved it: the bank-channel prompt belonged to the narrator-contaminated native ID and correctly remained `待确认`, although both independent semantic passes recognized that individual turn as an interviewer speech act. The candidate's old evidence could still leak through before the native interviewer cohort delegated.

### Fix

- Added a monotonic `latestClosedAnswerSeq` boundary to the partitioner. Candidate evidence released after late whole-voiceprint delegation is admitted only when it belongs after the latest closed answer.
- A confirmed native interviewer callback advances the boundary and continues to cancel Auto's current answer normally.
- Two-pass semantic interviewer consensus may advance the boundary conservatively while its native voiceprint is still pending. This operation can only suppress stale evidence; it cannot label the voiceprint, populate interviewer context, or release any question-generation evidence.
- An already delegated/manual candidate voiceprint remains authoritative. A rhetorical question inside a candidate answer therefore cannot advance the boundary from one contrary per-turn verdict.
- Resetting an interview clears the temporal boundary with all other speaker/Auto evidence.

### Red/green evidence

- Regression 1 reproduces a late candidate delegation after a confirmed newer interviewer turn. Before the fix it released candidate seqs `[1,3,4,5]`; after the fix it releases only the still-open answer `[3,4,5]`.
- The first full after-replay then exposed the pending-native-interviewer variant, so it was rejected rather than counted as completion.
- Regression 2 keeps the newer interviewer voiceprint pending while two semantic passes agree on its speech act. Before the enhanced fix, stale seq `1` was again released; after the fix only `[3,4,5]` enters Auto and the pending voiceprint still never enters a role-sensitive callback.
- Focused speaker-partitioner suite: `42 passed, 0 failed`.
- Full server suite: `271 passed, 0 failed`.
- Production web/server build completed with exit code 0.

### Full replay evidence

- Direct after-run: `qaPassed=true`; lifecycle `connecting → live → finalizing → stopped`; 48 finals; 1,303 rolling partials; 493.527 s streamed for 493.517 s of audio; no errors.
- Native voiceprints remained atomic: ID `0` interviewer, ID `1` candidate, and narrator-contaminated ID `2` explicit `unknown/observing`; no mixed-role ID, unsafe pending ID, invalid partition, or invalid Auto anchor.
- Final partition contained 12 interviewer, 12 candidate, and 3 unknown segments and arrived before `stopped`.
- Five direct Auto questions were anchored only to current delegated-candidate evidence, used 2,752–3,125 total tokens, and completed in 3.727–4.826 s.
- In the visible replay, no question appeared against the closed self-introduction. The first card appeared at `00:04:58` below the current answer about accumulating user-behaviour data to persuade merchants: `你提到沉伏几个月期间，你具体用哪些用户行为数据（比如卡券偏好、品类频次）去说服合作商？`
- Later visible questions stayed with the current bank-channel discussion, including measuring the channel's own user assets, the trade-off behind breadth of benefits, and evidence for obtaining an exclusive lowest price. Capture finalized to `待录音` with the transcript and assignments intact.

### Remaining evidence carried forward

The visible replay produced two related questions only 40 seconds apart against one exceptionally long uninterrupted answer. Round 5 will alternate back to the property interview and test whether Auto question cards remain a useful single suggestion per answer rather than accumulating multiple competing suggestions before the interviewer moves on.

## Round 5 — A / 物业经理

Status: fixed, replayed, verified, committed, and pushed.

### Run

- Baseline build: `5e50d4a`.
- Fixed product build: `516da90`.
- Before report: `/tmp/open-cluely-five-round-20260722/round-5-before.json`.
- Rejected intermediate report: `/tmp/open-cluely-five-round-20260722/round-5-intermediate.json`.
- Final after report: `/tmp/open-cluely-five-round-20260722/round-5-after.json`.
- The direct after-run and the visible BlackHole replay both used the complete 00:07:24 property fixture at 1× with the built-in `物业经理` context.

### Problems encountered from the interviewer’s perspective

This round exposed five connected lifecycle and usefulness defects rather than accepting the baseline aggregate pass:

1. Starting the microphone against a silent BlackHole cable opened Seed ASR immediately. Eight seconds later the product displayed `[Timeout waiting next packet]`, and beginning the MP3 afterward did not recover without a manual Stop/Start.
2. After that manual restart, transcript time visibly rewound: an existing row at `00:04:43` was followed by new speech at `00:00:11`. The interview script was no longer chronological.
3. The long third answer received two Auto cards before the interviewer moved on. Both questions could be defensible alone, but an interviewer had to choose between competing suggestions while still listening.
4. The first implementation prevented duplicate cards but its deterministic fallback asked which attribution baseline proved incremental impact for a hypothetical conflict-mediation plan. It sounded analytical without matching the evidence the candidate could reasonably provide, so that intermediate replay was rejected.
5. At the end of the final visible MP3 replay, the capture card reached `关闭` while a leftover `输入中…考官` fragment remained on the transcript. A terminal provider state could leave the UI looking as though transcription was still active.

### Root causes

- Browser media permission and a locally ready audio graph were treated as proof that PCM was flowing. A silent virtual cable therefore started Seed's upstream idle timer too early.
- Seed's `start_time` is relative to one upstream capture cycle, not the full interview. `TranscriptStream` added every raw offset to the original interview start, so Stop/Start reset the visible clock.
- Cooldown limited frequency but did not represent the conversational invariant “one useful suggestion for this answer.” Expiry reopened generation even though no interviewer boundary had occurred.
- The generic fallback prioritized measurable attribution when it saw words such as “监督/确保”, even if the entire response used hypothetical `如果/我会/我将` language and contained no real event.
- Final ASR status updated the capture card but never cleared the lane's rolling partial when no last definite utterance replaced it.

### Fix

- Real capture now opens upstream ASR only from the first actual PCM worklet frame. Simulation remains immediate. A focused visible check held BlackHole silent for 15 seconds, then began playback without any provider error.
- Every source records a new first-PCM wall-clock base for every capture cycle. The socket converts Seed's provider-relative offset into an absolute `createdAtMs`; the transcript renders that value directly and keeps raw `audioStartMs` diagnostic-only.
- A successfully emitted automatic or manual suggestion claims the current answer window. Cooldown cannot produce another card until a confirmed interviewer turn—or a two-pass suppression-only interviewer boundary for a still-pending native voiceprint—opens the next window. Failed generation does not claim it and may retry.
- Hypothetical situational answers now use a real-case fallback: ask for one personally handled comparable incident and the key decision. Actual, measurable claims still use the metric/trade-off/ownership rotation.
- `stopped`, `partial`, and `failed` ASR states now clear only the transient partial while preserving every committed final and the partial-finalization notice.

### Red/green and rejected-intermediate evidence

- First-PCM regression failed because successful `getUserMedia` sent `audio-control:start`; after the fix it proved no server start before the first frame and then ordered `start → first audio`.
- Capture-cycle timestamp regressions failed because the renderer recomputed the raw offset; after the fix they prove a restarted final keeps its absolute `00:04:00` position rather than rewinding to `00:00:12`.
- Auto-trigger regressions initially emitted twice after cooldown. They now prove one successful Auto per answer, manual coverage of the same answer, reopening at the next interviewer boundary, and retry after unsuccessful generation.
- The pending-panelist regression proves a suppression-only boundary opens exactly one new window without labeling the voiceprint or adding its text to interviewer context.
- The hypothetical-fallback regression first returned an attribution-baseline question; after the fix it asks for a comparable real event and key decision.
- The terminal-partial test was explicitly red at `44 passed, 1 failed` with `停止时未成为最终句的尾音` still present, then green at `45 passed, 0 failed`.
- The first after-style replay was rejected and retained as `round-5-intermediate.json` because its second question still used the awkward metric fallback. It was not promoted to final evidence.

### Final full replay evidence

- Direct report: `qaPassed=true`; lifecycle `connecting → live → finalizing → stopped`; 28 finals; 938 character-progressive partials; first final at 15.699 s; 444.183 s streamed for 444.151 s of source audio; no errors.
- Final partition arrived before `stopped` and contained 6 interviewer, 6 candidate, and 1 safe unknown segment. Native IDs `0` and `1` were delegated atomically; the short score-announcement ID `2` remained `unknown/observing`; no unsafe pending ID or invalid Auto anchor existed.
- Exactly two direct Auto questions were emitted, one for the second answer (`anchorSeq=14`) and one for the third (`anchorSeq=20`). They used 917 and 1,840 real tokens and completed in 3.570 s and 3.903 s.
- The independently visible replay also displayed exactly two cards, never two for one answer. The first asked for the candidate's actual decision when a fire-drill mobilization still failed; the second used the new real-case fallback for the hypothetical water-pipe conflict plan. They completed in 3.4 s and 3.5 s with 895 and 1,816 displayed tokens.
- Visible final speech timestamps stayed monotonic through the complete interview, the capture closed without a provider error, and committed roles remained whole by native voiceprint.
- The manual `面试总结` action consumed the completed client transcript and returned a non-empty Chinese report with conclusion, four scored dimensions, strengths, risks, and further-assessment advice. It no longer produced the earlier false empty-state notice.
- Final automated verification: 6 copilot-core tests, 18 question-bank tests, 272 server tests, and 249 web tests passed (`545/545` total). The production web and server build completed with exit code 0.

## Completion audit

Status: five alternating full-length rounds completed with a real defect, focused red/green proof, product fix, and full replay acceptance in every round.

| Round | Fixture/context | User-facing defect fixed | Final acceptance |
| --- | --- | --- | --- |
| 1 | A / 物业经理 | Auto forgot prior questions and repeated one template | 28 finals, 2 distinct Auto, 3.630–4.514 s |
| 2 | B / P8 | Narrator-contaminated voiceprint forced into interviewer | 48 finals, narrator fail-safe unknown, 7 safe Auto |
| 3 | A / 物业经理 | Prior candidate transcript resurrected in next interview | clean consecutive session, scroll/notes verified |
| 4 | B / P7 | Late cohort delegation asked about a closed answer | 48 finals, 5 current-answer Auto, 3.727–4.826 s |
| 5 | A / 物业经理 | Silent-start timeout, timestamp rewind, duplicate cards, weak fallback, stale partial | 28 finals, exactly 2 current-answer Auto, 3.570–3.903 s |

All final reports passed provider lifecycle, final-partition timing, one-role-per-native-speaker, fail-safe ambiguity, candidate-only Auto anchoring, real-time playback, observed Auto output, and under-ten-second Expert latency gates.
