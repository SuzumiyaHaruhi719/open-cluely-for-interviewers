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
  const o = { perBucket: null, ids: null, limit: null, concurrency: 8, out: null, corpus: null, runs: 1 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--per-bucket') o.perBucket = parseInt(a[++i], 10);
    else if (a[i] === '--ids') o.ids = a[++i];
    else if (a[i] === '--limit') o.limit = parseInt(a[++i], 10);
    else if (a[i] === '--concurrency') o.concurrency = parseInt(a[++i], 10);
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--corpus') o.corpus = a[++i]; // run on a JSONL corpus instead of fixtures
    else if (a[i] === '--runs') o.runs = parseInt(a[++i], 10); // K chain runs/record, pooled (richer candidate set for gate-select)
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

// Run the chain on one already-loaded fixture-shaped record (id/resume/jd/history/
// candidate_last_answer/session_state). Shared by fixture mode and --corpus mode.
async function runRecord(apiKey, fixture) {
  const start = Date.now();
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
    const dCandidates = (r.blocks && r.blocks.D && Array.isArray(r.blocks.D.candidates))
      ? r.blocks.D.candidates.map((c) => ({ id: c.id, question: c.question, question_type: c.question_type }))
      : [];
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
      d_candidates: dCandidates,
      fallbacks: r.fallbackTriggered || []
    };
  } catch (e) {
    return { id: fixture.id, ok: false, ms: Date.now() - start, error: e.message };
  }
}

// Fixture mode: read the file, then delegate to runRecord.
async function runOne(apiKey, file) {
  let fixture;
  try { fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')); }
  catch (e) { return { id: file, ok: false, error: `read: ${e.message}` }; }
  return runRecord(apiKey, fixture);
}

// Run the chain K times on the same record and POOL every candidate (each run's
// primary + alternative + 5 D-candidates) into one fat d_candidates list, so
// gate-select picks the best across K*~7 questions. More independent samples from
// the same generator => the calibrated judge reliably finds a >=90 question.
async function runRecordMulti(apiKey, fixture, runs) {
  if (!runs || runs <= 1) return runRecord(apiKey, fixture);
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await runRecord(apiKey, fixture)); // serial: keep per-record API load bounded
  const ok = results.filter((r) => r && r.ok);
  if (!ok.length) return results[0];
  const base = ok[0];
  const pool = [];
  const seen = new Set();
  const add = (q, type) => { const k = String(q || '').trim(); if (k && !seen.has(k)) { seen.add(k); pool.push({ id: `r${pool.length}`, question: k, question_type: type || '' }); } };
  for (const r of ok) {
    add(r.primary_question, 'primary');
    add(r.alternative_question, 'alt');
    for (const c of (r.d_candidates || [])) add(c.question, c.question_type);
  }
  return { ...base, runs: ok.length, ms: ok.reduce((a, r) => a + (r.ms || 0), 0), d_candidates: pool };
}

// Corpus mode: each JSONL line is already a fixture-shaped record.
function loadCorpus(corpusPath, limit) {
  const recs = fs.readFileSync(corpusPath, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
  return limit ? recs.slice(0, limit) : recs;
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
  const useCorpus = !!o.corpus;
  const items = useCorpus ? loadCorpus(o.corpus, o.limit) : selectFiles(o);
  const readRec = useCorpus
    ? async (rec) => rec
    : async (f) => { try { return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')); } catch (e) { return { id: f, _readError: e.message }; } };
  const worker = async (item) => {
    const rec = await readRec(item);
    if (rec._readError) return { id: rec.id, ok: false, error: `read: ${rec._readError}` };
    return runRecordMulti(apiKey, rec, o.runs);
  };
  const outPath = o.out || path.join('prompt-training', 'results', `gen-${Date.now()}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const stream = fs.createWriteStream(outPath, { flags: 'w' });
  console.error(`gen: ${items.length} ${useCorpus ? 'corpus records' : 'fixtures'}, runs/record ${o.runs}, concurrency ${o.concurrency}, transport ${process.env.DASHSCOPE_TRANSPORT || 'fetch'} → ${outPath}`);

  const t0 = Date.now();
  await pool(items, o.concurrency, worker, (done, total, r) => {
    stream.write(JSON.stringify(r) + '\n');
    const tag = r.ok ? `${r.ms}ms ${r.fallbacks && r.fallbacks.length ? 'fb:' + r.fallbacks.join('') : 'ok'}` : `ERR ${r.error}`;
    process.stderr.write(`  ${done}/${total} ${r.id} ${tag}\n`);
  });
  stream.end();
  console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outPath}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
