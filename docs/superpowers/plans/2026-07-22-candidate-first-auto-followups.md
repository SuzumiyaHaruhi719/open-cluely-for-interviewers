# Candidate-First Auto Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow confirmed candidate evidence to produce additional autonomous follow-ups without waiting for an interviewer voiceprint or interviewer boundary.

**Architecture:** Keep the existing candidate-only ingestion seam and all local/Flash admission gates. Remove only the answer-wide `suggestionDeliveredForAnswer` lock so a later candidate delta can open a new evidence window after cooldown; interviewer turns remain optional context and stale-work cancellation boundaries.

**Tech Stack:** TypeScript, Node test runner via `tsx --test`, npm workspaces, esbuild, Vite.

## Global Constraints

- Unknown and interviewer turns must never enter the candidate Auto evidence buffer.
- Preserve active-capture, single-in-flight, `20,000 ms` cooldown, `120` new-character, `3,000 ms` debounce, and Flash evidence-gap gates.
- Manual generation must still consume the current evidence window and restart cooldown.
- Do not add settings, UI controls, or a fixed question timer.

---

### Task 1: Candidate-first repeated evidence windows

**Files:**
- Modify: `web-app/server/test/auto-trigger.test.ts`
- Modify: `web-app/server/src/auto-trigger.ts`

**Interfaces:**
- Consumes: `createAutoTrigger(deps: AutoTriggerDeps): AutoTrigger`
- Produces: `onCandidateFinal()` may open another automatic evaluation after cooldown and enough new candidate evidence, without an intervening `onInterviewerFinal()`.

- [ ] **Step 1: Write the failing regression test**

Replace the one-question-per-answer assertion with a candidate-only continuation contract:

```ts
test('new candidate evidence can trigger again without interviewer role confirmation', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });
  trigger.onCandidateFinal(LONG_ANSWER);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 1);

  h.advance(5_000);
  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 1, 'cooldown still prevents immediate duplicates');

  h.advance(COOLDOWN_MS);
  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 2, 'candidate evidence reopens Auto without interviewer confirmation');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web-app/server
npx tsx --test --test-name-pattern='new candidate evidence can trigger again' test/auto-trigger.test.ts
```

Expected: FAIL because `suggestionDeliveredForAnswer` keeps `analyzeCalls.length` at `1`.

- [ ] **Step 3: Remove the answer-wide hard lock**

In `createAutoTrigger()`:

```ts
// Delete suggestionDeliveredForAnswer state and every admission/reset assignment.
// Keep these gates unchanged:
if (!autoGenerate) return false;
if (!capturing) return false;
if (isGenerating) return false;
if (now() - lastGenAt < cfg.cooldownMs) return false;
if (text.length - charsAtLastGen < cfg.minNewChars) return false;
```

For agent and interval delivery, continue to call `consumeSinceFire(firedRaw)` only when a question was actually delivered.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd web-app/server
npx tsx --test test/auto-trigger.test.ts
```

Expected: all Auto trigger tests pass, including cooldown, manual-run, capture, stale-generation, and candidate-only window tests.

- [ ] **Step 5: Commit the behavior change**

```bash
git add web-app/server/src/auto-trigger.ts web-app/server/test/auto-trigger.test.ts
git commit -m "fix: let candidate evidence reopen auto follow-ups"
```

### Task 2: Documentation, full verification, and runtime refresh

**Files:**
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/webapp-auto-question-generation.md`
- Verify: `web-app/server/src/auto-trigger.ts`
- Verify: `web-app/server/src/ws.ts`

**Interfaces:**
- Consumes: candidate-first trigger behavior from Task 1
- Produces: contributor documentation and a rebuilt production server running the verified revision.

- [ ] **Step 1: Update implementation documentation**

Record the invariant that candidate confirmation is sufficient for Auto admission; interviewer confirmation is optional context/cancellation and never an unlock prerequisite. Include purpose, entry points, data flow, config/state, and gotchas.

- [ ] **Step 2: Run full server and web verification**

Run:

```bash
cd web-app
npm test
npm run build
```

Expected: all package tests pass and Vite/esbuild production output completes without errors.

- [ ] **Step 3: Review the final diff and repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: only this implementation plan remains uncommitted in this repository after Task 1; the Obsidian note is external.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/superpowers/plans/2026-07-22-candidate-first-auto-followups.md
git commit -m "docs: record candidate-first auto admission"
```

The Obsidian note belongs to its own repository and is updated in place; do not stage it in this repository.

- [ ] **Step 5: Push and restart production**

```bash
git push origin main
SERVER_PID=$(lsof -tiTCP:8004 -sTCP:LISTEN)
if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID"; fi
cd web-app
PORT=8004 npm start
```

Expected: `main` is synchronized with `origin/main`, the server listens on `8004`, and the preparation UI reports the interview service ready.
