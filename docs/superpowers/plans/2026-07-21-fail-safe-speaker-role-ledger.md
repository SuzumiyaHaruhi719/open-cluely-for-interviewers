# Fail-safe speaker-role ledger implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan. Work directly on `main` because the user explicitly selected that workflow.

**Goal:** Ensure the product never silently forces an unverified transcript turn into the candidate or interviewer lane, and prevent acoustic cluster drift from contaminating automatic question delegation.

**Architecture:** Replace the role-only `cachedTurnRoles` map with a confidence-bearing semantic ledger. Live classification remains bounded. Finalization reviews every sequence in overlapping native/text batches, merges evidence conservatively, and emits `unknown` for unresolved turns. Transcript display may use acoustic roles provisionally only while live; Auto callbacks require a confirmed per-turn semantic verdict or deterministic local repair.

**Tech stack:** TypeScript, Node test runner, React 18, Vitest/Testing Library, DeepSeek v4 Flash through the existing DashScope-compatible chat adapter.

## Constraints

- Keep Doubao Seed ASR 2.0 as the only ASR provider.
- Keep `deepseek-v4-flash`, thinking disabled, and the existing live timeout.
- Do not add settings or expose credentials.
- Manual role corrections always win.
- Support multiple interviewers and one candidate without numeric speaker-order assumptions.
- Never allow final ambiguity to fall back to a confident but unverified acoustic label.

### Task 1: Classification windows and semantic ledger tests

**Files:**
- Modify: `web-app/server/test/speaker-partitioner.test.ts`
- Modify: `web-app/server/src/speaker-partitioner.ts`

- [x] Add a failing input-builder test showing a native `reviewSeqs` request includes every requested target plus adjacent context.
- [x] Add a failing long-interview finalization test that collects all final `reviewSeqs` and asserts every transcript `seq` is covered.
- [x] Add a failing stale-verdict test where a live `interviewer` exception is later returned as `unknown`; assert the final segment is not interviewer.
- [x] Add a failing conflict test where two final observations disagree at comparable confidence; assert the final segment is `unknown`.
- [x] Implement bounded review batches, confidence-bearing ledger entries, explicit revocation, and conservative result merge.
- [x] Run the focused partitioner tests until green.

### Task 2: Safe automatic delegation

**Files:**
- Modify: `web-app/server/test/speaker-partitioner.test.ts`
- Modify: `web-app/server/src/speaker-partitioner.ts`
- Verify: `web-app/server/test/ws-speaker.test.ts`
- Verify: `web-app/server/test/ws-auto-question.test.ts`

- [x] Add a failing test proving cluster baseline alone does not call either Auto role callback.
- [x] Add a positive test proving a high-confidence per-turn verdict releases exactly once.
- [x] Gate candidate/interviewer callbacks on semantic/local confirmation while keeping live provisional transcript labels.
- [x] Preserve manual precedence and the existing split-question/answer/score local repairs.
- [x] Run speaker and WebSocket Auto tests until green.

### Task 3: Explicit ambiguity in the renderer

**Files:**
- Modify: `web-app/web/src/desktop/TranscriptStream.tsx`
- Modify: the closest transcript renderer test under `web-app/web/src/desktop/`

- [x] Add a failing test for the Chinese label `待确认 · 说话人 N` on an `unknown` segment.
- [x] Implement the label without adding a setting or changing the GLP layout.
- [x] Run the focused and full web test suites.

### Task 4: Notes, integrated verification, rebuild, and delivery

**Files:**
- Update: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/speaker-role-auto-partition.md`
- Update: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/web-offline-speaker-diarization.md`
- Update if Auto semantics change: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/interviewer-ai-surfaces.md`

- [x] Document final full-transcript batching, reversible ledger state, final ambiguity, and the stricter Auto release invariant.
- [x] Run server typecheck, all server/web tests, the production build, and `git diff --check`.
- [x] Commit and push scoped checkpoints on `main`.
- [x] Restart the repository-owned production server on port 8788 and verify `/api/health`.
- [x] Replay the supplied MP3 through BlackHole, confirm real transcript roles and inline Auto behavior, then restore MacBook Pro Speakers.
- [x] Verify local `HEAD` equals `origin/main` and the worktree is clean.
