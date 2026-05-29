// End-to-end evaluator. Runs the Expert 7-block chain against N fixtures
// and computes:
//   - yield rate (% of fixtures where output.primary_question is non-fallback)
//   - per-block retry / fallback rates
//   - p50 / p90 / p99 latency
//   - schema validity (always 100% post-fallback by design — surfaced for trace)
//
// Usage:
//   DASHSCOPE_API_KEY=... node scripts/train-prompts/eval-e2e.js [--limit N]
//   (defaults to running all fixtures in fixtures/expert-interview/)

const fs = require('fs');
const path = require('path');

const { runExpertChain } = require('../../src/main-process/features/interviewer/expert-orchestrator');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');
const REPORT_DIR = path.join(FIXTURE_DIR, '_manifests');

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try {
    const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8'));
    return String(state.dashscopeApiKey || '').trim();
  } catch (_) { return ''; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) { out.limit = parseInt(args[i + 1], 10); i++; }
  }
  return out;
}

function listFixtures() {
  return fs.readdirSync(FIXTURE_DIR)
    .filter((n) => n.endsWith('.json') && n.startsWith('fx_'))
    .sort()
    .map((n) => path.join(FIXTURE_DIR, n));
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function runOne({ apiKey, fixture }) {
  const start = Date.now();
  try {
    const result = await runExpertChain({
      apiKey,
      candidateAnswer: fixture.candidate_last_answer,
      resumeChunk: fixture.resume,
      jobDescription: fixture.jd,
      questionHistory: fixture.history.map((h) => h.q || h),
      sessionState: fixture.session_state
    });
    return {
      id: fixture.id,
      ok: true,
      ms: Date.now() - start,
      fallbacks: result.fallbackTriggered || [],
      output: result.output,
      gold: fixture.ground_truth
    };
  } catch (err) {
    return { id: fixture.id, ok: false, ms: Date.now() - start, error: err.message };
  }
}

async function main() {
  const args = parseArgs();
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }

  const files = listFixtures();
  const slice = args.limit ? files.slice(0, args.limit) : files;
  console.log(`Running E2E on ${slice.length} fixtures (Expert mode)`);

  const results = [];
  for (let i = 0; i < slice.length; i++) {
    const fixture = JSON.parse(fs.readFileSync(slice[i], 'utf8'));
    process.stdout.write(`  ${i + 1}/${slice.length} ${fixture.id}...\r`);
    const r = await runOne({ apiKey, fixture });
    results.push(r);
  }
  console.log();

  const latencies = results.filter((r) => r.ok).map((r) => r.ms);
  const fallbackByBlock = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  let yieldCount = 0;
  for (const r of results) {
    if (!r.ok) continue;
    for (const b of r.fallbacks || []) fallbackByBlock[b] = (fallbackByBlock[b] || 0) + 1;
    const text = String(r.output?.primary_question || '');
    if (text && !text.startsWith('(no question available')) yieldCount += 1;
  }

  const summary = {
    fixtures_run: results.length,
    succeeded: results.filter((r) => r.ok).length,
    yield_count: yieldCount,
    yield_rate: results.length ? Number((yieldCount / results.length).toFixed(4)) : 0,
    fallback_by_block: fallbackByBlock,
    latency_ms: {
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p99: percentile(latencies, 99),
      mean: latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)
    },
    errors: results.filter((r) => !r.ok).slice(0, 30)
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, `eval-e2e-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Full report → ${out}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
