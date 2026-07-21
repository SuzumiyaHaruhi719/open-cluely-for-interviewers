# Five-Round Alternating MP3 Product Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete five alternating, full-length Seed ASR 2.0 interview runs and convert one distinct, reproduced interviewer-facing problem from every round into a regression-tested, replay-verified product fix.

**Architecture:** Two normalized audio fixtures drive the existing WebSocket acceptance harness and the visible local web application. Every round captures a machine report, browser evidence, one root-cause trace, one red/green fix, a second replay, and a durable QA-journal entry. The existing whole-voiceprint ledger, Balanced Auto gate, Expert Flash path, renderer timeline, and interview controls remain the authoritative product surfaces.

**Tech Stack:** Node.js 20, TypeScript, React, Vite, Vitest, Node test runner, WebSocket, Doubao Seed ASR 2.0, DeepSeek V4 Flash, browser-client, ffmpeg.

## Global Constraints

- Work directly on `main` and push every completed round, as explicitly requested by the user.
- Use `/Users/thomasli/Downloads/Bilibili Interview 86.6.mp3` and `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`; duplicate copies do not count.
- Convert sources only into `/tmp/open-cluely-five-round-20260722/`; never modify originals.
- Replay every acceptance run at `--speed 1` through provider `volc` with `--auto-generate` and the internal Balanced gate.
- Use 物业经理 context for rounds 1, 3, and 5; P8 for round 2; P7 for round 4.
- A round requires an actual distinct user-facing problem, root cause, observed failing regression test, focused fix, green test, rebuild, replay, journal entry, implementation-note update, commit, and push.
- Do not force ambiguous voiceprints into a role; identity consistency and candidate-only Auto evidence are release blockers.
- Keep source-grounded English acronyms, but generated questions and visible product copy default to Chinese.
- Do not add settings, pipeline controls, TTS, CAM++, or unrelated UI features.

---

### Task 1: Prepare deterministic fixtures and the QA journal

**Files:**
- Create: `docs/qa/2026-07-22-five-round-mp3-iteration.md`
- Use temporary: `/tmp/open-cluely-five-round-20260722/property-16k.wav`
- Use temporary: `/tmp/open-cluely-five-round-20260722/p7p8-16k.wav`
- Use temporary: `/tmp/open-cluely-five-round-20260722/context/*.txt`

**Interfaces:**
- Consumes: the two user-supplied AAC/MP4 recordings and built-in `JobProfile` records.
- Produces: two PCM16 fixtures, three exact Expert-context pairs, and the durable round ledger.

- [ ] **Step 1: Verify that duplicate filenames are identical and the two selected recordings are distinct**

Run:

```bash
shasum -a 256 \
  "/Users/thomasli/Downloads/Bilibili Interview 86.6.mp3" \
  "/Users/thomasli/Downloads/Bilibili Interview 86.6 (1).mp3" \
  "/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8.mp3" \
  "/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3"
```

Expected: each same-name pair matches; the property and P7/P8 hashes differ.

- [ ] **Step 2: Normalize both recordings non-destructively**

Run:

```bash
mkdir -p /tmp/open-cluely-five-round-20260722/context
"/Users/thomasli/Library/Application Support/bilibili/ffmpeg/ffmpeg" -y \
  -i "/Users/thomasli/Downloads/Bilibili Interview 86.6.mp3" \
  -ac 1 -ar 16000 -c:a pcm_s16le \
  /tmp/open-cluely-five-round-20260722/property-16k.wav
"/Users/thomasli/Library/Application Support/bilibili/ffmpeg/ffmpeg" -y \
  -i "/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3" \
  -ac 1 -ar 16000 -c:a pcm_s16le \
  /tmp/open-cluely-five-round-20260722/p7p8-16k.wav
file /tmp/open-cluely-five-round-20260722/property-16k.wav \
  /tmp/open-cluely-five-round-20260722/p7p8-16k.wav
```

Expected: both files are RIFF/WAVE, Microsoft PCM, 16 bit, mono 16000 Hz; durations are approximately 444 and 493 seconds.

- [ ] **Step 3: Export exact built-in JD and guide context**

Run from `web-app/web`:

```bash
npx tsx -e "import {PROPERTY_MANAGER_PROFILE,USER_OPERATIONS_P7_PROFILE,USER_OPERATIONS_P8_PROFILE,buildInterviewGuideLines} from './src/desktop/jobProfiles.ts'; import fs from 'node:fs'; const out='/tmp/open-cluely-five-round-20260722/context'; for (const [name,p] of [['property',PROPERTY_MANAGER_PROFILE],['p7',USER_OPERATIONS_P7_PROFILE],['p8',USER_OPERATIONS_P8_PROFILE]] as const) { fs.writeFileSync(out+'/'+name+'-jd.txt',p.jobDescription); fs.writeFileSync(out+'/'+name+'-guide.json',JSON.stringify(buildInterviewGuideLines(p),null,2)); }"
```

Expected: six non-empty context files; each guide is a JSON string array and totals the selected profile’s evidence rubric.

- [ ] **Step 4: Create the QA journal with immutable fixture metadata and five round headings**

The journal records the hashes, source durations, build commit, exact commands, machine metrics, visible observations, root cause, red/green evidence, fix, replay, commit, and remaining risk for every round.

- [ ] **Step 5: Commit and push the design/plan/journal checkpoint**

```bash
git add docs/superpowers/specs/2026-07-22-five-round-alternating-mp3-iteration-design.md \
  docs/superpowers/plans/2026-07-22-five-round-alternating-mp3-iteration.md \
  docs/qa/2026-07-22-five-round-mp3-iteration.md
git commit -m "docs: define five-round MP3 product iteration"
git push git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:main
```

Expected: `main` contains the executable acceptance contract before product behavior changes.

---

### Task 2: Round 1 — property interview baseline and first defect

**Files:**
- Modify: first causal production module identified from the round evidence.
- Modify: matching focused test file adjacent to that module.
- Modify: `docs/qa/2026-07-22-five-round-mp3-iteration.md`
- Modify: matching Obsidian implementation note.
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-1-before.json`
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-1-after.json`

**Interfaces:**
- Consumes: property fixture, property JD/guide, `/ws` live ASR contract.
- Produces: one verified user-facing correction and before/after evidence.

- [ ] **Step 1: Run the full baseline at 1×**

```bash
node scripts/verify-live-asr.mjs --provider volc \
  --audio /tmp/open-cluely-five-round-20260722/property-16k.wav \
  --speed 1 --auto-generate \
  --job-description-file /tmp/open-cluely-five-round-20260722/context/property-jd.txt \
  --interview-guide-file /tmp/open-cluely-five-round-20260722/context/property-guide.json \
  --out /tmp/open-cluely-five-round-20260722/round-1-before.json
```

- [ ] **Step 2: Inspect machine and visible-browser evidence**

Check provider lifecycle, chronological timestamps, partial cadence, role history per native ID, pending intervals, candidate-only Auto anchors, question latency/content, timeline scrolling, controls, and end state. Write the first concrete defect and exact reproduction into the journal.

- [ ] **Step 3: Trace the first divergent boundary and state one root-cause hypothesis**

Compare provider event → WebSocket frame → canonical transcript/assignment → renderer state. Record evidence that identifies the first incorrect boundary before changing code.

- [ ] **Step 4: Write and run one focused regression test**

Run the narrowest existing test command for the causal module and observe a behavior assertion fail for the reproduced symptom, not for syntax or setup.

- [ ] **Step 5: Implement the minimal source fix and make the focused test green**

Change only the causal module and rerun the focused test plus its full package suite.

- [ ] **Step 6: Rebuild and replay the complete property fixture**

Repeat the Step 1 command with `round-1-after.json`. Confirm the original symptom is absent without weakening any product acceptance gate.

- [ ] **Step 7: Document, commit, and push round 1**

Update the QA journal and matching implementation note, run `git diff --check`, commit the focused source/test/journal files, and push `main`.

---

### Task 3: Round 2 — P8 interruption and expert-question defect

**Files:**
- Modify: first causal production module identified from round 2 evidence.
- Modify: matching focused test file.
- Modify: `docs/qa/2026-07-22-five-round-mp3-iteration.md`
- Modify: matching Obsidian implementation note.
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-2-before.json`
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-2-after.json`

**Interfaces:**
- Consumes: P7/P8 fixture, P8 JD/guide, Round 1 build.
- Produces: one distinct verified correction in interruption, role, Auto, or P8 question behavior.

- [ ] **Step 1: Run the full P8 baseline at 1×**

```bash
node scripts/verify-live-asr.mjs --provider volc \
  --audio /tmp/open-cluely-five-round-20260722/p7p8-16k.wav \
  --speed 1 --auto-generate \
  --job-description-file /tmp/open-cluely-five-round-20260722/context/p8-jd.txt \
  --interview-guide-file /tmp/open-cluely-five-round-20260722/context/p8-guide.json \
  --out /tmp/open-cluely-five-round-20260722/round-2-before.json
```

- [ ] **Step 2: Inspect repeated interruption windows and every generated question**

Require whole-ID role continuity across the interruption timestamps, no interviewer/pending Auto anchor, under-10-second latency, a P8-level evidence gap, and no repeated evidence dimension.

- [ ] **Step 3: Reproduce, trace, red-test, fix, and green-test one defect distinct from round 1**

Use the same causal-boundary and TDD sequence as Task 2; a regression already fixed in round 1 cannot satisfy this round.

- [ ] **Step 4: Rebuild and replay the complete P8 fixture**

Repeat Step 1 with `round-2-after.json`, verify the exact symptom is absent, and compare all acceptance fields against `round-2-before.json`.

- [ ] **Step 5: Document, commit, and push round 2**

Record before/after evidence and push a focused checkpoint to `main`.

---

### Task 4: Round 3 — property repeated-session and timeline defect

**Files:**
- Modify: first causal production module identified from round 3 evidence.
- Modify: matching focused test file.
- Modify: `docs/qa/2026-07-22-five-round-mp3-iteration.md`
- Modify: matching Obsidian implementation note.
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-3-before.json`
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-3-after.json`

**Interfaces:**
- Consumes: property fixture and the state left by the prior visible session.
- Produces: one distinct correction in reset, notes, ordering, scrolling, finalization, or lifecycle behavior.

- [ ] **Step 1: Start a new visible interview without clearing browser storage manually**

Verify the product reset path itself isolates transcript, note, question, speaker-map, and cooldown state.

- [ ] **Step 2: Run the complete property fixture and inspect the unified timeline**

Use the Task 2 command with `round-3-before.json`. Add timestamped notes during playback, scroll away from the tail, and verify that late finals do not reorder old turns or hijack manual scroll position.

- [ ] **Step 3: Reproduce, trace, red-test, fix, and green-test one new defect**

The defect must be absent from rounds 1–2 and must be observable from an interviewer’s normal workflow.

- [ ] **Step 4: Rebuild, start a second new interview, and replay the complete fixture**

Write `round-3-after.json` and verify both the defect and session-isolation boundary.

- [ ] **Step 5: Document, commit, and push round 3**

Record note placement, scroll behavior, state isolation, and before/after proof.

---

### Task 5: Round 4 — P7 level/context and finalization defect

**Files:**
- Modify: first causal production module identified from round 4 evidence.
- Modify: matching focused test file.
- Modify: `docs/qa/2026-07-22-five-round-mp3-iteration.md`
- Modify: matching Obsidian implementation note.
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-4-before.json`
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-4-after.json`

**Interfaces:**
- Consumes: P7/P8 fixture with P7 context and all prior fixes.
- Produces: one distinct verified correction in level context, interruptions, question variety, or stop-time finalization.

- [ ] **Step 1: Run the full P7-context baseline at 1×**

```bash
node scripts/verify-live-asr.mjs --provider volc \
  --audio /tmp/open-cluely-five-round-20260722/p7p8-16k.wav \
  --speed 1 --auto-generate \
  --job-description-file /tmp/open-cluely-five-round-20260722/context/p7-jd.txt \
  --interview-guide-file /tmp/open-cluely-five-round-20260722/context/p7-guide.json \
  --out /tmp/open-cluely-five-round-20260722/round-4-before.json
```

- [ ] **Step 2: Inspect P7 specificity and stop-time ordering**

Confirm questions validate independent domain ownership and experiments rather than P8 organizational scope; inspect the final ASR frame, partition, stopped status, last timestamps, and final Auto result ordering.

- [ ] **Step 3: Reproduce, trace, red-test, fix, and green-test one new defect**

Use one evidence dimension and one causal fix. Do not rewrite prompts broadly when a validation, state, or fallback defect is responsible.

- [ ] **Step 4: Rebuild and replay the complete P7 fixture**

Write `round-4-after.json` and verify the correction plus all role and Auto gates.

- [ ] **Step 5: Document, commit, and push round 4**

Record the exact P7 evidence target, before/after question, and finalization proof.

---

### Task 6: Round 5 — property final adversarial replay and summary readiness

**Files:**
- Modify: first causal production module identified from round 5 evidence.
- Modify: matching focused test file.
- Modify: `docs/qa/2026-07-22-five-round-mp3-iteration.md`
- Modify: matching Obsidian implementation note.
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-5-before.json`
- Create temporary: `/tmp/open-cluely-five-round-20260722/round-5-after.json`

**Interfaces:**
- Consumes: property fixture and the cumulative four-round build.
- Produces: final distinct correction and an interview state that can be summarized from the visible canonical transcript.

- [ ] **Step 1: Run a fresh property interview and exercise every primary control**

During the complete replay, operate manual follow-up, context drawer, theme toggle, transcript scroll, note entry, and audio source display. Stop capture, generate a summary from the visible transcript snapshot, cancel end-interview once, then confirm it.

- [ ] **Step 2: Run the matching CLI capture**

Use the Task 2 command with `round-5-before.json` to preserve machine evidence for the same build.

- [ ] **Step 3: Reproduce, trace, red-test, fix, and green-test the final distinct issue**

Prioritize a normal interviewer-blocking problem over cosmetic polish. The test must exercise the real canonical state or component behavior behind the symptom.

- [ ] **Step 4: Rebuild and replay the complete fixture**

Write `round-5-after.json`, repeat the affected visible workflow, and confirm summary receives the canonical transcript rather than an empty or stale server snapshot.

- [ ] **Step 5: Document, commit, and push round 5**

Record the final before/after user journey and push the checkpoint to `main`.

---

### Task 7: Completion audit and production handoff

**Files:**
- Modify: `docs/qa/2026-07-22-five-round-mp3-iteration.md`
- Modify: affected Obsidian implementation notes.

**Interfaces:**
- Consumes: ten before/after reports, five round commits, regression tests, and visible browser state.
- Produces: requirement-by-requirement completion proof on pushed `main`.

- [ ] **Step 1: Compare every round’s before/after machine report**

For each report, extract `qaPassed`, lifecycle, counts, speaker IDs, assignments, pending/mixed IDs, invalid partitions, Auto anchors, latencies, tokens, and errors. Confirm every fixed symptom has direct replay evidence.

- [ ] **Step 2: Run fresh full verification**

```bash
cd web-app
npm test
npm run build
cd ..
git diff --check
```

Expected: all core, question-bank, server, and web tests pass; production web/server build exits zero; no whitespace errors.

- [ ] **Step 3: Restart the built server and verify health**

```bash
cd web-app
PORT=8788 npm start
```

Then verify `GET http://127.0.0.1:8788/api/health` reports configured Doubao and model availability.

- [ ] **Step 4: Perform final visible-browser verification**

Leave one completed, scrollable transcript visible. Confirm header controls, unified timeline, role labels, questions, context drawer, note ordering, summary, theme, and end confirmation operate on the rebuilt server.

- [ ] **Step 5: Audit the design requirement by requirement**

Map every fixture, round, evidence field, identity invariant, Auto gate, interviewer-experience requirement, documentation requirement, commit, and push to authoritative current evidence. Any missing or indirect item keeps the objective active.

- [ ] **Step 6: Push the final journal and verified main branch**

```bash
git add docs/qa/2026-07-22-five-round-mp3-iteration.md
git commit -m "docs: record five-round MP3 acceptance evidence"
git push git@github.com:SuzumiyaHaruhi719/open-cluely-for-interviewers.git main:main
```

Expected: GitHub `main` contains five distinct round fixes and the complete evidence journal.
