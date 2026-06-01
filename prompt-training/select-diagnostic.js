// select-diagnostic.js — judge ALL of Block D's 5 candidates per fixture (not just
// the primary E picked), to answer: is E selecting the best candidate, or is a
// better question being generated and passed over? If best-of-5 >> primary often,
// the lever is Block E's SELECTION, not Block D's generation.
//
// Usage: DASHSCOPE_TRANSPORT=curl node prompt-training/select-diagnostic.js \
//   --in prompt-training/results/seldiag.jsonl --concurrency 16

const fs = require('fs');
const path = require('path');
const { dashscopeChat, safeJsonParse, FLASH_MODEL } = require('../src/main-process/features/interviewer/expert-orchestrator');

const DIM_MAX = { depth: 30, ownership: 20, trait: 25, anchoring: 15, antitriviality: 10 };
const PASS = 80;

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try { return String(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8')).dashscopeApiKey || '').trim(); } catch (_) { return ''; }
}
function args() { const a = process.argv.slice(2); const o = { in: null, concurrency: 16 }; for (let i = 0; i < a.length; i++) { if (a[i] === '--in') o.in = a[++i]; else if (a[i] === '--concurrency') o.concurrency = parseInt(a[++i], 10); } return o; }

function judgePrompt(candidateAnswer, question) {
  return `You are a STRICT senior interviewer scoring one follow-up question on whether it forces the candidate to reveal durable POTENTIAL and WORK TRAITS (judgment, ownership, reasoning depth, growth) — NOT whether it pins a fact. A question whose answer is a single number/name/date is BAD even if "specific".
[Candidate answer]
"""${candidateAnswer || '(none)'}"""
[Question]
"""${question}"""
Score each integer in range, be harsh, when unsure score lower:
1 depth(0-30) must answer expose HOW they think (decision/alternatives, tradeoff+cost, failure+diagnosis)? 0 if a fact answers it.
2 ownership(0-20) forces personal "I" not "we"?
3 trait(0-25) reveals durable trait (ambiguity/conflict/failure/prioritization/influence/judgment/learning)?
4 anchoring(0-15) tied to what THIS candidate said (not generic)?
5 antitriviality(0-10) 10 if value is reasoning; 0 if a fact-pin.
STRICT JSON: {"depth":,"ownership":,"trait":,"anchoring":,"antitriviality":}`;
}
function clamp(name, v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(DIM_MAX[name], n)) : 0; }
function total(d) { const raw = clamp('depth', d.depth) + clamp('ownership', d.ownership) + clamp('trait', d.trait) + clamp('anchoring', d.anchoring) + clamp('antitriviality', d.antitriviality); return clamp('antitriviality', d.antitriviality) === 0 ? Math.min(raw, 45) : raw; }

async function score(apiKey, answer, question) {
  if (!question) return 0;
  try {
    const { text } = await dashscopeChat({ apiKey, model: FLASH_MODEL, prompt: judgePrompt(answer, question), temperature: 0, maxTokens: 400, timeoutMs: 120000 });
    return total(safeJsonParse(text) || {});
  } catch (_) { return -1; }
}

async function pool(items, c, worker, onDone) { let i = 0, done = 0; const out = new Array(items.length); async function next() { const k = i++; if (k >= items.length) return; out[k] = await worker(items[k]); onDone(++done, items.length, out[k]); return next(); } await Promise.all(Array.from({ length: Math.min(c, items.length) }, next)); return out; }

async function main() {
  const o = args(); const apiKey = resolveApiKey();
  const recs = fs.readFileSync(o.in, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ok && Array.isArray(r.d_candidates) && r.d_candidates.length);
  console.error(`select-diagnostic: ${recs.length} fixtures, judging all candidates...`);
  const rows = await pool(recs, o.concurrency, async (r) => {
    const scores = await Promise.all(r.d_candidates.map((c) => score(apiKey, r.candidate_last_answer, c.question)));
    const primaryScore = await score(apiKey, r.candidate_last_answer, r.primary_question);
    const best = Math.max(...scores);
    const bestIdx = scores.indexOf(best);
    return { id: r.id, primaryScore, best, bestIdx, scores, primaryIsBest: primaryScore >= best - 2, bestQ: r.d_candidates[bestIdx] && r.d_candidates[bestIdx].question, primaryQ: r.primary_question };
  }, (d, t) => process.stderr.write(`  ${d}/${t}\r`));
  process.stderr.write('\n');

  const n = rows.length;
  const primaryPass = rows.filter((r) => r.primaryScore >= PASS).length;
  const bestPass = rows.filter((r) => r.best >= PASS).length;
  const eLeftPoints = rows.filter((r) => r.best - r.primaryScore >= 8); // E passed over a clearly better candidate
  const meanPrimary = (rows.reduce((a, r) => a + r.primaryScore, 0) / n).toFixed(1);
  const meanBest = (rows.reduce((a, r) => a + r.best, 0) / n).toFixed(1);

  console.log('===== SELECTION DIAGNOSTIC =====');
  console.log(`fixtures: ${n}`);
  console.log(`PRIMARY (what E picked):  pass ${primaryPass}/${n} (${(100 * primaryPass / n).toFixed(1)}%), mean ${meanPrimary}`);
  console.log(`BEST-of-5 (oracle pick):  pass ${bestPass}/${n} (${(100 * bestPass / n).toFixed(1)}%), mean ${meanBest}`);
  console.log(`E left >=8 pts on table (better candidate existed): ${eLeftPoints.length}/${n} (${(100 * eLeftPoints.length / n).toFixed(1)}%)`);
  console.log(`\n--- cases where E passed over a clearly better candidate (top 10) ---`);
  eLeftPoints.sort((a, b) => (b.best - b.primaryScore) - (a.best - a.primaryScore)).slice(0, 10).forEach((r) => {
    console.log(`  ${r.id}: primary=${r.primaryScore} best=${r.best} (+${r.best - r.primaryScore})`);
    console.log(`     E picked : ${r.primaryQ}`);
    console.log(`     better   : ${r.bestQ}`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
