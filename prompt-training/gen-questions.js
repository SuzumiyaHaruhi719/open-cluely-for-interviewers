// gen-questions.js — run the Expert chain on a sample of fixtures and emit the
// generated follow-up question per fixture as JSONL (one line per fixture).
//
// Usage:
//   DASHSCOPE_TRANSPORT=curl node prompt-training/gen-questions.js \
//     --per-bucket 3 --concurrency 8 --out prompt-training/results/gen-<tag>.jsonl
//   (or --ids prompt-training/sample-ids.txt   one fixture id per line)
//   (or --limit N                              first N fixtures)
//
// Key: DASHSCOPE_API_KEY env, else cache/app-state.json → dashscopeApiKey.

const fs = require('fs');
const path = require('path');
const { runExpertChain } = require('../src/main-process/features/interviewer/expert-orchestrator');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try {
    const s = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8'));
    return String(s.dashscopeApiKey || '').trim();
  } catch (_) { return ''; }
}

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { perBucket: null, ids: null, limit: null, concurrency: 8, out: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--per-bucket') o.perBucket = parseInt(a[++i], 10);
    else if (a[i] === '--ids') o.ids = a[++i];
    else if (a[i] === '--limit') o.limit = parseInt(a[++i], 10);
    else if (a[i] === '--concurrency') o.concurrency = parseInt(a[++i], 10);
    else if (a[i] === '--out') o.out = a[++i];
  }
  return o;
}

function allFixtureFiles() {
  return fs.readdirSync(FIXTURE_DIR).filter((n) => n.startsWith('fx_') && n.endsWith('.json')).sort();
}

// Deterministic stratified sample: N per answer_quality bucket (stable by id).
function stratifiedSample(perBucket) {
  const byBucket = {};
  for (const n of allFixtureFiles()) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, n), 'utf8')); } catch (_) { continue; }
    const b = (j.tags && j.tags.answer_quality) || 'unknown';
    (byBucket[b] = byBucket[b] || []).push(n);
  }
  const picked = [];
  for (const b of Object.keys(byBucket).sort()) {
    picked.push(...byBucket[b].sort().slice(0, perBucket));
  }
  return picked;
}

function selectFiles(o) {
  if (o.ids) {
    const ids = fs.readFileSync(o.ids, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return ids.map((id) => (id.endsWith('.json') ? id : `${id}.json`));
  }
  if (o.perBucket) return stratifiedSample(o.perBucket);
  const all = allFixtureFiles();
  return o.limit ? all.slice(0, o.limit) : all;
}

async function runOne(apiKey, file) {
  const start = Date.now();
  let fixture;
  try { fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')); }
  catch (e) { return { id: file, ok: false, error: `read: ${e.message}` }; }
  try {
    const r = await runExpertChain({
      apiKey,
      candidateAnswer: fixture.candidate_last_answer,
      resumeChunk: fixture.resume,
      jobDescription: fixture.jd,
      questionHistory: (fixture.history || []).map((h) => h.q || h),
      sessionState: fixture.session_state
    });
    const out = r.output || {};
    return {
      id: fixture.id,
      ok: true,
      ms: Date.now() - start,
      tags: fixture.tags,
      candidate_last_answer: fixture.candidate_last_answer,
      primary_question: out.primary_question || '',
      alternative_question: out.alternative_question || '',
      anchor_quotes: out.anchor_quotes || [],
      rationale: out.rationale_for_interviewer || '',
      fallbacks: r.fallbackTriggered || []
    };
  } catch (e) {
    return { id: fixture.id, ok: false, ms: Date.now() - start, error: e.message };
  }
}

// Simple async pool.
async function pool(items, concurrency, worker, onDone) {
  let idx = 0; let done = 0;
  const results = new Array(items.length);
  async function next() {
    const i = idx++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    done++;
    if (onDone) onDone(done, items.length, results[i]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function main() {
  const o = parseArgs();
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }
  const files = selectFiles(o);
  const outPath = o.out || path.join('prompt-training', 'results', `gen-${Date.now()}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const stream = fs.createWriteStream(outPath, { flags: 'w' });
  console.error(`gen: ${files.length} fixtures, concurrency ${o.concurrency}, transport ${process.env.DASHSCOPE_TRANSPORT || 'fetch'} → ${outPath}`);

  const t0 = Date.now();
  await pool(files, o.concurrency, (f) => runOne(apiKey, f), (done, total, r) => {
    stream.write(JSON.stringify(r) + '\n');
    const tag = r.ok ? `${r.ms}ms ${r.fallbacks && r.fallbacks.length ? 'fb:' + r.fallbacks.join('') : 'ok'}` : `ERR ${r.error}`;
    process.stderr.write(`  ${done}/${total} ${r.id} ${tag}\n`);
  });
  stream.end();
  console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outPath}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
