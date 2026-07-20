# Semantic Speaker Weak-Correction Implementation Plan

**Goal:** Let DeepSeek v4 Flash repair obvious per-turn interviewer/candidate mistakes caused by acoustic-ID drift without globally swapping voiceprint roles.

**Architecture:** Preserve the stable native-cluster map as a baseline. Add recent chronological evidence to the classifier request, cache only high-confidence per-turn exceptions, refresh on long finalized turns, and make the semantic partitioner the sole role-sensitive Auto seam while it is enabled.

**Tech Stack:** TypeScript, Node test runner through `tsx`, WebSocket ASR pipeline, DeepSeek v4 Flash through DashScope.

## Global constraints

- No CAM++, second diarization service, or new UI setting.
- Keep `deepseek-v4-flash`, `thinking:false`, one strict-JSON classifier request, and the existing 8-second timeout.
- Manual role corrections always win.
- A turn exception must never mutate a cluster role.
- Preserve Chinese-only product output and Xunfei as the default ASR provider.

---

### Task 1: Pin the observed drift failure

**Files:**
- Modify: `web-app/server/test/speaker-partitioner.test.ts`

- [ ] Add a failing input-selection test where the old per-cluster sampler omits the latest question and long answer.
- [ ] Add a failing cadence test proving one long post-baseline turn requests a semantic refresh immediately.
- [ ] Strengthen the per-turn override test so a candidate answer and a genuine interviewer question share one acoustic ID, while only the answer changes role.
- [ ] Run the focused test and capture the expected RED failures.

### Task 2: Implement bounded weak correction

**Files:**
- Modify: `web-app/server/src/speaker-partitioner.ts`
- Modify: `web-app/server/src/ws.ts`

- [ ] Select compact native cluster anchors plus a deduplicated recent chronological window.
- [ ] Tighten the prompt to request sparse, high-confidence semantic conflicts for every recent turn.
- [ ] Ignore low-confidence stable cluster assignments and retain the stricter turn-override threshold.
- [ ] Schedule a correction refresh for each new long finalized turn after the baseline exists.
- [ ] Route role-sensitive Auto events only through semantic partition output when partitioning is enabled.
- [ ] Run the focused and surrounding WebSocket/trigger tests and verify GREEN.

### Task 3: Verify and document production behavior

**Files:**
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/speaker-role-auto-partition.md`

- [ ] Run all server tests, typecheck, and build.
- [ ] Run all web tests and build.
- [ ] Replay the supplied MP3 silently through BlackHole with Xunfei selected.
- [ ] Confirm clear answers become `候选人`, genuine questions remain `面试官`, and final partitioning preserves those corrections.
- [ ] Confirm Auto waits during speech and produces a meaningful question only after a complete candidate answer.
- [ ] Update implementation notes with the role-precedence and recent-window invariants.
- [ ] Commit and push each verified checkpoint.

