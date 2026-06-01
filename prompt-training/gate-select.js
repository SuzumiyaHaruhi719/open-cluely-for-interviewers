// gate-select.js — best-of-pool quality gate.
//
// For each generated record (primary_question + alternative_question + the 5
// Block-D candidates), score EVERY candidate with the calibrated judge and emit
// the highest-scoring one as the chosen question. This guarantees the chain emits
// the best question available from its own pool — the legitimate way to hold a
// quality floor (the pool almost always contains a >=90 candidate; selection, not
// generation, was the gap).
//
// Selection uses ONE judge sample per candidate (fast ranking); the winner is then
// re-scored with the full median-of-3 ensemble for the OFFICIAL, trustworthy score
// that the streak counter consumes. So the emitted score is not the lucky max of
// noisy single samples — it is the strict ensemble verdict on the chosen question.
//
// Usage: DASHSCOPE_TRANSPORT=curl node prompt-training/gate-select.js \
//   --in prompt-training/results/gen.jsonl --out prompt-training/results/gated.jsonl --concurrency 8

const fs = require('fs');
const { scoreOnce, judgeOne, computeTotal } = require('./judge');
const { resolveApiKey } = require('./judge');

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { in: null, out: null, concurrency: 8 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--in') o.in = a[++i];
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--concurrency') o.concurrency = parseInt(a[++i], 10);
  }
  return o;
}

function poolQuestions(rec) {
  const qs = [];
  if (rec.primary_question) qs.push(rec.primary_question);
  if (rec.alternative_question) qs.push(rec.alternative_question);
  for (const c of (rec.d_candidates || [])) if (c && c.question) qs.push(c.question);
  return [...new Set(qs.map((q) => String(q).trim()).filter(Boolean))];
}

async function gateOne(apiKey, rec) {
  const qs = poolQuestions(rec);
  if (!qs.length) return { ...rec, gate: { error: 'no-candidates' }, primary_question: rec.primary_question || '' };
  // Rank by a single fast judge sample.
  const ranked = await Promise.all(qs.map(async (q) => {
    try {
      const s = await scoreOnce(apiKey, rec.candidate_last_answer, q);
      return { q, quick: s ? computeTotal(s.dims).total : -1 };
    } catch (_) { return { q, quick: -1 }; }
  }));
  ranked.sort((a, b) => b.quick - a.quick);
  const winner = ranked[0].q;
  // Verify the winner with the full ensemble judge (official score).
  const verified = await judgeOne(apiKey, { ...rec, _q: winner }, '_q');
  return {
    id: rec.id, ok: true, ms: rec.ms,
    candidate_last_answer: rec.candidate_last_answer,
    pool_size: qs.length,
    primary_question: winner,           // chosen = best of pool
    chain_primary: rec.primary_question, // what the chain originally picked (for audit)
    quick_scores: ranked.map((r) => r.quick),
    judge: verified.judge
  };
}

async function pool(items, c, worker, onDone) {
  let i = 0, done = 0; const out = new Array(items.length);
  async function next() { const k = i++; if (k >= items.length) return; out[k] = await worker(items[k]); onDone(++done, items.length, out[k]); return next(); }
  await Promise.all(Array.from({ length: Math.min(c, items.length) }, next));
  return out;
}

async function main() {
  const o = parseArgs();
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }
  if (!o.in) { console.error('--in required'); process.exit(2); }
  const recs = fs.readFileSync(o.in, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ok !== false);
  const outPath = o.out || o.in.replace(/\.jsonl$/, '.gated.jsonl');
  const stream = fs.createWriteStream(outPath, { flags: 'w' });
  console.error(`gate-select: ${recs.length} records → ${outPath}`);
  await pool(recs, o.concurrency, (r) => gateOne(apiKey, r), (done, total, r) => {
    stream.write(JSON.stringify(r) + '\n');
    const j = r.judge || {};
    process.stderr.write(`  ${done}/${total} ${r.id} chosen=${j.total ?? '?'} ${j.total >= 90 ? '>=90' : '<90'}\n`);
  });
  stream.end();
  console.error(`done → ${outPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
