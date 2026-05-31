# Prompt-training progress log

**Goal:** Rewrite the Expert-chain block prompts so generated follow-up questions
*effectively mine the candidate's potential and work traits* (judgment, ownership,
reasoning depth, growth) instead of asking trivial fact-pins ("how much did p99
drop"). Target: every generated question scores **≥80** on the PTES rubric
(`rubric.md`), validated on a large corpus sample. Judge honestly — no inflation.

## Assets
- Corpus: `fixtures/expert-interview/` — 1000 mock interviews, stratified across
  14 `answer_quality` buckets (~71/bucket).
- Chain: `runExpertChain` (`src/main-process/features/interviewer/expert-orchestrator.js`).
- Prompts: `src/services/ai/interviewer-prompts/expert/block-{a..g}.js`.
- Key: `cache/app-state.json` → `dashscopeApiKey` (or `DASHSCOPE_API_KEY`).
- Transport: set `DASHSCOPE_TRANSPORT=curl` for reliability from this Win env.

## Harness (prompt-training/)
- `gen-questions.js` — run chain on N fixtures (concurrent) → questions JSONL.
- `judge.js` — DeepSeek judge w/ PTES rubric → scored JSONL (Claude audits a sample).
- `report.js` — aggregate pass-rate / mean / failure-modes.

## Diagnosis (root cause of bad questions)
The CURRENT prompts are designed to produce fact-pins:
- Block D rule 7 FORBIDS judgment framings ("how did you decide", "what was your
  approach") and FORCES number/named-entity/date pins.
- Block E rubric rewards `specificity` + `risk_of_dodge` as raw fact-pinning.
- Block B defines "missing evidence" as missing metric/named-tool, not missing
  *judgment/ownership/reasoning*.
Fix = philosophy shift in A/B/D/E/G toward depth/ownership/trait elicitation.

## Iteration log
(prepend newest)

### BASELINE (old prompts, 42 fixtures) — the number to beat
**PASS 6/42 = 14.3%, mean 42.0**, GATED(fact-pin) heavy, dim means
depth7.8 own9.6 trait8.7 anch13.1 nontriv3.0. Lowest scorers all fact-pins
(ACV/MTTR/exact %/"how many days"). Passes = occasional tradeoff/counterfactual.
Audit: judge matches my read. File: results/baseline.judged.jsonl.

### ITER1 result (committed 8159fcd) — 14.3% → 71.4%, mean 42→82.4
depth7.8→21.5 own9.6→17.6 trait8.7→20.2 nontriv3→8.9, 0 fact-pins won.
Remaining 12 failures → 4 patterns: (1) yes/no openings "有没有/did you"; (2)
name/list-only answerable as a fact w/o reasoning; (3) team-credit still allows
"we"; (4) contradiction/timeline → mere "reconcile" (clarification not depth).

### ITER2 (in progress, bg bh3bf03bs) — Block D refinements
Added rules 4a (forbid yes/no + name-only + list-only; mandatory reasoning clause),
4b (ownership must force personal call + reasoning together), 4c (contradiction →
ask the judgment/tradeoff, not reconcile). Same 42 fixtures. Judge on completion.
Plan after iter2 converges on 42: large validation (per-bucket 10 = 140), then push
residual failures; restart app w/ final prompts so user can test live.

### ITER2 result — 71.4% → 78.6%, mean 82.4→85.0
depth21.9 own18.8 trait20.9 anch14.5 nontriv9. Anchoring near-max, depth is the
BOTTLENECK. 9 failures all same root cause: question NAMES a decision+alternative
but doesn't force reconstructing the WEIGHING (cost/what-broke/why-tempting-wrong).

### ITER3 (in progress, bg b1eu9xjq6) — depth/weighing
Block D rule 4a/4b + self-check: mandatory clause must force the TENSION (what given
up / cost elsewhere / nearly broke / why tempting option wrong), not just "name an
alternative + why". DEPTH TEST added. Same 42 fixtures.

### ITER3 result — 78.6% → 90.5%, mean 85→87.6, depth→23.4
Progression: 14.3 → 71.4 → 78.6 → 90.5%. Only 4 fails (45/74/74/77), all the same
residual: question lets candidate NAME decision + named cost without a reasoning
WALK. fx_0009 regressed to "which budget did you cut" name-pin.

### ITER4 (in progress, bg bh17hfidw, 84 fixtures = per-bucket 6)
Block D 4a: strongest form opens "walk me through" + forces reasoning WALK (tempting
option, why tempting, why ultimately wrong, what it cost). Kills "which X did you
cut" name-pins. Larger sample for a robust pass-rate (42 was noisy at 2.4%/item).
NOTE on the bar: literal 100% across 1000 is bounded by generator tail + judge
threshold noise near 80; will report the TRUE pass-rate + residual analysis, not
fake 100%. Uncommitted: iter4 Block D edits (commit after validation).

### Judge calibration (validated, honest)
Smoke audit of judge.js vs my own read:
- fx_0001 "how many FTEs redeployed" (number-pin) → 10/100, depth0 nontriv0. Correct.
- fx_0002 "what alternative did you reject" (good but not great) → 72/100, fails 80
  because it stops short of forcing the tradeoff. Strict + matches my judgment.
Judge is trustworthy (not inflating). Total computed in code w/ gate (nontriv0→cap45).

### Status: two gen runs in parallel (waiting)
- baseline.jsonl (OLD prompts, bg bsqf06i45) and iter1.jsonl (NEW prompts, bg
  bwug3l1ix), both --per-bucket 3 = same 42 fixtures, deterministic → comparable.
- NEXT on completion: judge both → report.js → audit lowest/highest → compare
  pass-rate. If iter1 >> baseline, commit prompts; iterate on remaining failures.

### Iter 1 — philosophy rewrite (DONE, awaiting eval)
New question philosophy: **"probe the person, not the datum."** Every question must
force ONE OF: (a) a decision + the alternative rejected + why; (b) a tradeoff + its
cost / what broke; (c) a failure/mistake + what it taught; (d) a personal ownership
boundary inside "we"; (e) a counterfactual judgment ("if you had half the X…");
(f) a prioritization call under conflict. FORBIDDEN: questions whose complete answer
is a single number/name/date ("how much exactly", "which tool"). Anchoring to the
candidate's words still REQUIRED (non-generic).
Edits: D (invert rule 7), E (rubric → depth/ownership/trait/anchoring/non_triviality/
usability, schema + fallback updated), B (gap = unrevealed judgment/ownership, not
missing metric), G (rationale teaches depth, not "unfalsifiable without a number"),
A (flag decision/outcome/ownership spans as prime anchors). Schema E.rubric keys
changed; blockEFallback updated to match.

### Iter 0 — setup (done)
- Confirmed key present, corpus 1000 stratified.
- E switched pro→flash earlier (latency: chain was 416s w/ pro-E, E alone 255s).
  Keeping flash for training throughput.
- Building gen/judge/report harness + baseline next.
