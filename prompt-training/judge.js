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
  return `You are a STRICT senior interviewer scoring one follow-up question on whether
it forces the candidate to reveal durable POTENTIAL and WORK TRAITS (judgment,
ownership, reasoning depth, growth) — NOT whether it pins a fact.

A question whose answer is a single number / name / date is a BAD question here,
even if "specific". Reward depth and trait-revelation; punish fact-pins.

[Candidate's most recent answer]
"""
${candidateAnswer || '(none)'}
"""

[Follow-up question to score]
"""
${question}
"""

Score EACH dimension as an integer in its range. Be harsh; when unsure, score lower.
1. depth (0-30): must the answer expose HOW they think — decision/alternatives,
   tradeoff+cost, failure+diagnosis, why the obvious choice was wrong? 0 if a fact/yes-no answers it.
2. ownership (0-20): does it force a personal "I decided/did/risked" answer, not "we"?
3. trait (0-25): would the answer reveal a durable trait (ambiguity, conflict, failure,
   prioritization, influence, judgment, learning)? 0 if it reveals only information.
4. anchoring (0-15): tied to something THIS candidate specifically said (not a generic
   "tell me about a time")? 0 if askable of anyone.
5. antitriviality (0-10): 10 if value is in reasoning; 0 if it is fundamentally a
   fact-pin (number/name/date/yes-no).

Output STRICT JSON only:
{"depth":<0-30>,"ownership":<0-20>,"trait":<0-25>,"anchoring":<0-15>,"antitriviality":<0-10>,"weakest":"<dim name>","justification":"<one sentence naming the weakest dimension and why>"}`;
}

function clampDim(name, v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(DIM_MAX[name], n));
}

// Deterministic total from dimension scores + GATE.
function computeTotal(dims) {
  const raw = clampDim('depth', dims.depth) + clampDim('ownership', dims.ownership)
    + clampDim('trait', dims.trait) + clampDim('anchoring', dims.anchoring)
    + clampDim('antitriviality', dims.antitriviality);
  const gated = clampDim('antitriviality', dims.antitriviality) === 0 ? Math.min(raw, GATE_CAP) : raw;
  return { raw, total: gated, gateApplied: gated !== raw };
}

async function judgeOne(apiKey, rec, field) {
  const question = String(rec[field] || '').trim();
  if (!question || /^\(no question available/.test(question)) {
    return { ...rec, judge: { error: 'empty-or-fallback-question', total: 0, pass: false } };
  }
  try {
    const { text } = await dashscopeChat({
      apiKey, model: FLASH_MODEL,
      prompt: buildJudgePrompt({ candidateAnswer: rec.candidate_last_answer, question }),
      temperature: 0, maxTokens: 700, timeoutMs: 180000
    });
    const p = safeJsonParse(text) || {};
    const dims = {
      depth: clampDim('depth', p.depth), ownership: clampDim('ownership', p.ownership),
      trait: clampDim('trait', p.trait), anchoring: clampDim('anchoring', p.anchoring),
      antitriviality: clampDim('antitriviality', p.antitriviality)
    };
    const { raw, total, gateApplied } = computeTotal(dims);
    return { ...rec, judge: { ...dims, raw, total, gateApplied, pass: total >= PASS, weakest: p.weakest || '', justification: p.justification || '' } };
  } catch (e) {
    return { ...rec, judge: { error: e.message, total: 0, pass: false } };
  }
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

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
