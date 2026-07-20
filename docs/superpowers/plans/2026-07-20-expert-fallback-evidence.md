# Evidence-ranked Expert Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep fallback Expert questions useful when the Flash call fails by anchoring them to the strongest exact evidence fragment instead of ASR boilerplate at the end of an answer.

**Architecture:** Preserve the single `deepseek-v4-flash` call and strict validator. Add a deterministic, local sentence scorer used only by `fallbackOutput()`; it penalizes cut-off closing phrases and rewards concrete action, decision, constraint, and result language without adding a network call or changing any external contract.

**Tech Stack:** TypeScript, Node test runner, DashScope-compatible chat client

## Global Constraints

- No second model call or retry.
- No change to the eight-second model timeout.
- The selected anchor must remain an exact substring of `candidateAnswer`.
- Output remains one simplified-Chinese question.
- Role partitioning, automatic-trigger admission, JD context, and model selection remain unchanged.

---

## File structure

- Modify `web-app/server/test/expert-question.test.ts` — reproduce the weak ASR-ending fallback.
- Modify `web-app/server/src/expert-question.ts` — rank exact answer fragments for deterministic fallback selection.
- Update `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/webapp-auto-question-generation.md` — record the fallback-selection invariant and entry point.

### Task 1: Rank fallback anchors by evidence value

**Files:**
- Test: `web-app/server/test/expert-question.test.ts`
- Modify: `web-app/server/src/expert-question.ts`
- Update: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/webapp-auto-question-generation.md`

**Interfaces:**
- Consumes: `candidateAnswer: string` already passed to `fallbackOutput(answer)`.
- Produces: a source-exact anchor string selected by `deriveAnchor(answer)`; no exported API or contract changes.

- [ ] **Step 1: Write the failing regression test**

Add this test after the existing generic-output fallback test:

```ts
test('fallback ignores cut-off closing boilerplate and anchors concrete candidate evidence', async () => {
  const candidateAnswer = [
    '我先检查维修记录和现场施工质量，再核对采购单据确认材料是否达标。',
    '如果资金不足，我会提交预算调整并安排复检，确保水管不再反复破裂。',
    '以上就是我对这个事情的处理，以及这件事情对我的意。'
  ].join('');

  const result = await generateExpertQuestion(
    { ...INPUT, candidateAnswer },
    { chat: async () => { throw new Error('transient provider failure'); } }
  );

  assert.equal(result.fellBack, true);
  assert.doesNotMatch(result.output.primary_question, /以上就是/);
  assert.match(result.output.primary_question, /预算调整|复检|水管/);
  assert.equal(candidateAnswer.includes(result.output.anchor_quotes[0]), true);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd web-app
npm test --workspace @open-cluely/server -- --test-name-pattern="fallback ignores cut-off"
```

Expected: FAIL because the current `deriveAnchor()` selects the final “以上就是……” fragment.

- [ ] **Step 3: Implement minimal deterministic evidence ranking**

In `web-app/server/src/expert-question.ts`, keep source fragments exact and replace final-fragment selection with a bounded score:

```ts
const LOW_SIGNAL_ENDING = /^(?:以上就是|我的回答完毕|谢谢(?:考官)?|就这些|没有了)/;
const EVIDENCE_TERMS = /(?:我|本人|亲自|负责|决定|选择|检查|核对|协调|提交|调整|复检|验证|解决|降低|提升|结果|因为|如果|风险|预算|记录|质量)/g;

function anchorScore(fragment: string): number {
  const evidenceHits = fragment.match(EVIDENCE_TERMS)?.length ?? 0;
  const usefulLength = Math.min(fragment.length, 80);
  const boilerplatePenalty = LOW_SIGNAL_ENDING.test(fragment) ? 200 : 0;
  return evidenceHits * 18 + usefulLength - boilerplatePenalty;
}

function deriveAnchor(answer: string): string {
  const sentences = answer
    .split(/[。！？!?]\s*|[\n；;]/)
    .map((part) => part.trim().slice(0, 100))
    .filter((part) => part.length >= 4);
  const ranked = sentences
    .map((fragment, index) => ({ fragment, index, score: anchorScore(fragment) }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  return ranked[0]?.fragment.trim().slice(0, 52) || answer.trim().slice(0, 52) || '刚才这项经历';
}
```

- [ ] **Step 4: Run focused and complete Expert tests**

Run:

```bash
cd web-app
npm test --workspace @open-cluely/server -- --test-name-pattern="expert|fallback|Chinese|compound"
```

Expected: PASS, including the new regression test and all existing Expert validator tests.

- [ ] **Step 5: Update the implementation note**

Add the fallback selection flow and this gotcha to `webapp-auto-question-generation.md`: network/schema failures stay inside the latency SLO and must anchor to source-exact, evidence-ranked text; never default to a trailing ASR courtesy phrase.

- [ ] **Step 6: Run full verification**

Run:

```bash
cd web-app
npm run test:server
npm run test:web
npm run typecheck --workspace @open-cluely/server
npm run build --workspace @open-cluely/server
npm run build --workspace @open-cluely/web
```

Expected: server and web tests, typecheck, and both production builds pass.

- [ ] **Step 7: Commit and push**

```bash
git add web-app/server/src/expert-question.ts web-app/server/test/expert-question.test.ts
git commit -m "fix: anchor expert fallback to concrete evidence"
git push origin HEAD
```
