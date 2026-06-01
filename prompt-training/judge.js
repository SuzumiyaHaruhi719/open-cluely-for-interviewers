// judge.js — score generated questions on the PTES rubric (prompt-training/rubric.md).
// The model assigns the 5 per-dimension scores + a justification; THIS CODE
// computes the total and applies the anti-triviality GATE, so the score is
// deterministic and auditable (not the model's own arithmetic). Claude audits a
// sample of these against rubric.md to confirm the judge isn't inflating.
//
// Usage:
//   DASHSCOPE_TRANSPORT=curl node prompt-training/judge.js \
//     --in prompt-training/results/baseline.jsonl \
//     --out prompt-training/results/baseline.judged.jsonl --concurrency 12

const fs = require('fs');
const path = require('path');
const { dashscopeChat, safeJsonParse, FLASH_MODEL } = require('../src/main-process/features/interviewer/expert-orchestrator');

const DIM_MAX = { depth: 30, ownership: 20, trait: 25, anchoring: 15, antitriviality: 10 };
const PASS = 80;
const GATE_CAP = 45;

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try {
    const s = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8'));
    return String(s.dashscopeApiKey || '').trim();
  } catch (_) { return ''; }
}

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { in: null, out: null, concurrency: 12, field: 'primary_question' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--in') o.in = a[++i];
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--concurrency') o.concurrency = parseInt(a[++i], 10);
    else if (a[i] === '--field') o.field = a[++i];
  }
  return o;
}

function buildJudgePrompt({ candidateAnswer, question }) {
  return `You are a STRICT but FAIR senior interviewer scoring one follow-up question on
whether it forces the candidate to reveal durable POTENTIAL and WORK TRAITS
(judgment, ownership, reasoning depth, growth) — NOT whether it pins a fact.

SCORE BY THE QUESTION'S PRIMARY DEMAND, not its weakest sub-clause. A question
whose CORE ask is reasoning/tradeoff/ownership is strong EVEN IF it also mentions
a concrete anchor (a number, a name, "who pushed back hardest"). Naming a concrete
detail is how a question stays specific to THIS candidate — do not punish it as a
"fact-pin" unless the WHOLE question can be fully answered by that single fact.
A question is only a fact-pin if a number/name/date/yes-no is the COMPLETE answer.

CALIBRATION ANCHORS (internalize these; score new questions on the same scale):
- "How much exactly did p99 latency drop?" → depth 0, ownership 0, trait 0,
  anchoring 8, antitriviality 0. TOTAL ~8. (pure fact-pin)
- "You said you 'led the migration' — inside that, what was the one call that was
  yours alone, what did pushing it cost you, and what did you have to give up?"
  → depth 26, ownership 19, trait 23, anchoring 14, antitriviality 8. TOTAL ~90.
  (core demand is ownership+cost reasoning; the concrete framing is fine)
- "Walk me through the tradeoff you agonized over most — the option you rejected,
  why it was tempting, and what the chosen path cost you later." → depth 28,
  ownership 17, trait 24, anchoring 9, antitriviality 9. TOTAL ~87. (deep but
  slightly generic, so anchoring is lower)
- "Which database did you pick?" → depth 0, ownership 4, trait 0, anchoring 6,
  antitriviality 0. TOTAL ~10. (fact-pin)

[Candidate's most recent answer]
"""
${candidateAnswer || '(none)'}
"""

[Follow-up question to score]
"""
${question}
"""

Score EACH dimension as an integer in its range, judging the question's PRIMARY demand.
1. depth (0-30): does the COMPLETE, honest answer expose HOW they think —
   decision/alternatives, tradeoff+cost, failure+diagnosis, why the obvious choice
   was wrong? Full marks if it forces a reasoning walk; 0 only if a bare fact/yes-no
   fully answers it. A concrete anchor inside a reasoning question does NOT lower depth.
2. ownership (0-20): does it force a personal "I decided/did/risked" answer? Full marks
   if it explicitly isolates the candidate's own call (e.g. "yours alone"). Lower only
   if the whole thing can be answered with "we" with no personal stake.
3. trait (0-25): would the answer reveal a durable trait (ambiguity, conflict, failure,
   prioritization, influence, judgment, learning)? 0 only if it reveals only information.
4. anchoring (0-15): tied to something THIS candidate specifically said/wrote (not a
   generic "tell me about a time")? 0 if askable of anyone.
5. antitriviality (0-10): 10 if the question's VALUE is in reasoning; 0 ONLY if the
   whole question is fundamentally a fact-pin (its complete answer is a number/name/
   date/yes-no). A reasoning question that merely contains a concrete detail scores 7-10.

Output STRICT JSON only:
{"depth":<0-30>,"ownership":<0-20>,"trait":<0-25>,"anchoring":<0-15>,"antitriviality":<0-10>,"weakest":"<dim name>","justification":"<one sentence naming the weakest dimension and why>"}`;
}

function clampDim(name, v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(DIM_MAX[name], n));
}

// Deterministic total from dimension scores + GATE.
//
// The gate exists to stop a PURE fact-pin ("how much did p99 drop?") from scoring
// high on anchoring/specificity alone. But a question that forces reasoning
// (high depth) is BY DEFINITION not a fact-pin, even if it contains a concrete
// anchor — so gating it is a double-penalty (depth/trait/ownership = 75 of 100
// pts already punish true pins). We therefore fire the gate ONLY when the
// question is genuinely trivial: little-to-no reasoning value (antitriviality<=1)
// AND shallow (depth < 15). This catches real pins without nuking strong
// questions that merely mention a number/name. (Not score inflation: a true pin
// scores <45 on its own via the reasoning dimensions.)
function computeTotal(dims) {
  const at = clampDim('antitriviality', dims.antitriviality);
  const depth = clampDim('depth', dims.depth);
  const raw = depth + clampDim('ownership', dims.ownership)
    + clampDim('trait', dims.trait) + clampDim('anchoring', dims.anchoring) + at;
  const isPurePin = at <= 1 && depth < 15;
  const gated = isPurePin ? Math.min(raw, GATE_CAP) : raw;
  return { raw, total: gated, gateApplied: gated !== raw };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// One scoring attempt. Returns parsed dims, or null if the model produced
// unparseable / empty JSON (so the caller can retry instead of scoring it 0 —
// a parse failure is judge noise, NOT evidence the question is bad).
async function scoreOnce(apiKey, candidateAnswer, question) {
  const { text } = await dashscopeChat({
    apiKey, model: FLASH_MODEL,
    prompt: buildJudgePrompt({ candidateAnswer, question }),
    // maxTokens generous so the JSON object is never truncated mid-field;
    // thinking disabled so the model emits the JSON directly (no CoT preamble
    // that eats the token budget and corrupts the parse).
    temperature: 0, maxTokens: 1200, timeoutMs: 180000, thinking: { type: 'disabled' }
  });
  const p = safeJsonParse(text);
  if (!p || [p.depth, p.ownership, p.trait, p.anchoring, p.antitriviality].every((v) => v == null)) return null;
  return {
    dims: {
      depth: clampDim('depth', p.depth), ownership: clampDim('ownership', p.ownership),
      trait: clampDim('trait', p.trait), anchoring: clampDim('anchoring', p.anchoring),
      antitriviality: clampDim('antitriviality', p.antitriviality)
    },
    weakest: p.weakest || '', justification: p.justification || ''
  };
}

const JUDGE_SAMPLES = 3; // ensemble size — median per dimension kills single-shot noise

async function judgeOne(apiKey, rec, field) {
  const question = String(rec[field] || '').trim();
  if (!question || /^\(no question available/.test(question)) {
    return { ...rec, judge: { error: 'empty-or-fallback-question', total: 0, pass: false } };
  }
  // Collect JUDGE_SAMPLES valid judgments, retrying parse failures (up to 2x the
  // sample count) so noise never silently becomes a 0.
  const samples = [];
  let attempts = 0;
  const maxAttempts = JUDGE_SAMPLES * 2 + 1;
  while (samples.length < JUDGE_SAMPLES && attempts < maxAttempts) {
    attempts++;
    try {
      const s = await scoreOnce(apiKey, rec.candidate_last_answer, question);
      if (s) samples.push(s);
    } catch (e) { /* transport error — retry */ }
  }
  if (!samples.length) {
    return { ...rec, judge: { error: 'judge-no-valid-sample', total: 0, pass: false } };
  }
  // Per-dimension median across the ensemble, then deterministic total + gate.
  const dims = {
    depth: median(samples.map((s) => s.dims.depth)),
    ownership: median(samples.map((s) => s.dims.ownership)),
    trait: median(samples.map((s) => s.dims.trait)),
    anchoring: median(samples.map((s) => s.dims.anchoring)),
    antitriviality: median(samples.map((s) => s.dims.antitriviality))
  };
  const { raw, total, gateApplied } = computeTotal(dims);
  const last = samples[samples.length - 1];
  return { ...rec, judge: { ...dims, raw, total, gateApplied, pass: total >= PASS, samples: samples.length, weakest: last.weakest, justification: last.justification } };
}

async function pool(items, concurrency, worker, onDone) {
  let idx = 0; let done = 0;
  const out = new Array(items.length);
  async function next() {
    const i = idx++;
    if (i >= items.length) return;
    out[i] = await worker(items[i]);
    onDone(++done, items.length, out[i]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return out;
}

async function main() {
  const o = parseArgs();
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }
  if (!o.in) { console.error('--in required'); process.exit(2); }
  const recs = fs.readFileSync(o.in, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.ok !== false);
  const outPath = o.out || o.in.replace(/\.jsonl$/, '.judged.jsonl');
  const stream = fs.createWriteStream(outPath, { flags: 'w' });
  console.error(`judge: ${recs.length} questions (field=${o.field}) → ${outPath}`);
  await pool(recs, o.concurrency, (r) => judgeOne(apiKey, r, o.field), (done, total, r) => {
    stream.write(JSON.stringify(r) + '\n');
    const j = r.judge || {};
    process.stderr.write(`  ${done}/${total} ${r.id} total=${j.total ?? '?'} ${j.pass ? 'PASS' : 'fail'}${j.gateApplied ? ' [GATED]' : ''}\n`);
  });
  stream.end();
  console.error(`done → ${outPath}`);
}

// Exported so gate-select.js (and any other tool) judges with the SAME calibrated
// rubric — one source of truth, no prompt drift.
module.exports = {
  buildJudgePrompt, scoreOnce, judgeOne, computeTotal, clampDim, median,
  PASS, GATE_CAP, JUDGE_SAMPLES, resolveApiKey
};

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
