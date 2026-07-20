# Auto-question Evidence Sufficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit Auto questions only after a complete candidate answer contains enough concrete information to support a meaningful Expert follow-up.

**Architecture:** Extend the existing deterministic `decideLocalTrigger()` boundary rather than adding a second model or another setting. The new checks classify completion and evidence shape locally, then hand admitted text to the unchanged one-call DeepSeek v4 Flash path.

**Tech Stack:** TypeScript, Node test runner through `tsx`, existing WebSocket auto-trigger pipeline.

## Global Constraints

- Keep one Expert Flash call with `thinking:false`, `maxRetries:0`, and the existing 8-second model timeout.
- Do not add a UI control, prompt editor, or provider credential field.
- Preserve `AUTO_MIN_NEW_CHARS=120`, `AUTO_DEBOUNCE_MS=3000`, and `AUTO_COOLDOWN_MS=20000`.
- Candidate evidence must remain role-confirmed and candidate-only.

---

### Task 1: Implement and pin evidence sufficiency

**Files:**
- Modify: `web-app/server/test/auto-trigger-local-decision.test.ts`
- Modify: `web-app/server/src/auto-trigger.ts`

**Interfaces:**
- Consumes: `decideLocalTrigger(recentTranscript: string): TriggerDecision`
- Produces: a deterministic admission verdict before the existing Expert call.

- [ ] **Step 1: Write the failing behavior tests**

Append these cases to `auto-trigger-local-decision.test.ts`:

```ts
test('a long but cut-off candidate fragment waits for more information', () => {
  const decision = decideLocalTrigger(
    '我先核对消防巡检记录，再组织夜间盲演，发现两个岗位的响应时间超标，并记录各岗位的实际到场时间和处置步骤。接下来我会协调物业和工程团队，因为'
  );
  assert.equal(decision.shouldGenerate, false);
  assert.match(decision.reason, /未结束|更多信息/);
});

test('length padding without concrete actions or outcomes is not enough evidence', () => {
  const decision = decideLocalTrigger(
    '我认为这个事情非常重要，我们应该认真对待并积极处理。'.repeat(6)
  );
  assert.equal(decision.shouldGenerate, false);
  assert.match(decision.reason, /证据|信息/);
});

test('information-rich ASR text may be admitted without terminal punctuation', () => {
  const decision = decideLocalTrigger(
    '我负责三万平方米园区，先核对消防巡检记录，再组织夜间盲演，发现两个岗位响应超时，最终调整排班，把平均到场时间从八分钟缩短到五分钟'
  );
  assert.equal(decision.shouldGenerate, true);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web-app/server
npm exec -- tsx --test test/auto-trigger-local-decision.test.ts
```

Expected: the cut-off and padding cases fail with `true !== false`; existing substantive and filler cases stay green.

- [ ] **Step 3: Implement the minimal local gate**

In `auto-trigger.ts`, add local patterns for incomplete tails, terminal punctuation, completed ASR endings, concrete actions, outcomes, and operational details. Add this evidence combiner and call it from `decideLocalTrigger()` after completeness:

```ts
function hasEnoughEvidence(text: string): boolean {
  const clauses = text
    .split(/[，,。！？!?；;：:]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6);
  if (clauses.length < 2) return false;

  const distinctActions = new Set(
    (text.match(CONCRETE_ACTIONS) ?? []).map((match) => match.toLowerCase())
  );
  if (distinctActions.size >= 2) return true;
  return distinctActions.size >= 1 && OUTCOME_SIGNAL.test(text) && SPECIFIC_DETAIL.test(text);
}
```

Use these rejection branches before the success verdict:

```ts
if (
  INCOMPLETE_ENDING.test(text) ||
  (!TERMINAL_PUNCTUATION.test(text) && !CLOSED_ASR_ENDING.test(text))
) {
  return { shouldGenerate: false, reason: '回答疑似未结束，等待更多信息', focusHint: '', urgency: 'low' };
}
if (!hasEnoughEvidence(text)) {
  return { shouldGenerate: false, reason: '尚未形成足够的具体行动或结果证据', focusHint: '', urgency: 'low' };
}
```

- [ ] **Step 4: Run focused and surrounding tests and verify GREEN**

Run:

```bash
cd web-app/server
npm exec -- tsx --test test/auto-trigger-local-decision.test.ts test/auto-trigger.test.ts test/ws-auto-question.test.ts
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 5: Commit the behavior checkpoint**

```bash
git add web-app/server/src/auto-trigger.ts web-app/server/test/auto-trigger-local-decision.test.ts
git commit -m "fix: require substantive evidence before auto questions"
```

### Task 2: Document and verify the production boundary

**Files:**
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/webapp-auto-question-generation.md`

**Interfaces:**
- Consumes: the finalized trigger behavior from Task 1.
- Produces: contributor-facing invariants and full regression evidence.

- [ ] **Step 1: Update the implementation note**

Add this invariant to the data flow and Gotchas sections:

```md
Length is necessary but not sufficient: a candidate window must end cleanly and contain multiple substantive clauses plus concrete actions or an action/outcome/detail combination. Connective tails wait for more speech; completed evidence-rich ASR text may pass without final punctuation.
```

- [ ] **Step 2: Run full verification**

```bash
cd web-app/server && npm test && npm run typecheck && npm run build
cd ../web && npm test && npm run build
```

Expected: every command exits 0; no test or type error is introduced.

- [ ] **Step 3: Commit documentation and push**

```bash
git add docs/superpowers/specs/2026-07-20-auto-question-evidence-sufficiency-design.md docs/superpowers/plans/2026-07-20-auto-question-evidence-sufficiency.md
git commit -m "docs: define auto-question evidence sufficiency"
git push origin codex/interviewer-hardening
```

