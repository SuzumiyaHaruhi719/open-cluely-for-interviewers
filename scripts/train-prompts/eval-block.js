// Per-block evaluator. Runs ONE block (A/B/C/D/E/F/G) against N fixtures
// and computes block-specific metrics via deepseek-v4-pro as LLM-judge. Used
// during prompt iteration to score each block independently.
//
// Usage:
//   DASHSCOPE_API_KEY=... node scripts/train-prompts/eval-block.js --block A [--limit N]

const fs = require('fs');
const path = require('path');

const {
  buildBlockA, buildBlockB, buildBlockC, buildBlockD, buildBlockE, buildBlockF, buildBlockG
} = require('../../src/services/ai/interviewer-prompts').expert;
const { validateBlock } = require('../../src/services/ai/interviewer-prompts').schemas;
const { getDashscopeBaseUrl } = require('../../src/config');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');
const REPORT_DIR = path.join(FIXTURE_DIR, '_manifests');
const ANTHROPIC_VERSION = '2023-06-01';

const BLOCK_MODELS = { A: 'deepseek-v4-flash', B: 'deepseek-v4-flash', C: 'deepseek-v4-flash', D: 'deepseek-v4-flash', E: 'deepseek-v4-pro', F: 'deepseek-v4-flash', G: 'deepseek-v4-flash' };

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try {
    const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8'));
    return String(state.dashscopeApiKey || '').trim();
  } catch (_) { return ''; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { block: 'A', limit: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--block' && args[i + 1]) { out.block = args[i + 1].toUpperCase(); i++; }
    if (args[i] === '--limit' && args[i + 1]) { out.limit = parseInt(args[i + 1], 10); i++; }
  }
  return out;
}

async function callBlockOnce({ apiKey, model, prompt, maxTokens }) {
  const resp = await fetch(`${getDashscopeBaseUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION, 'x-api-key': apiKey },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.15 })
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json();
  const blocks = Array.isArray(json?.content) ? json.content : [];
  return blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
}

function safeJson(text) {
  if (!text) return null;
  const c = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(c); } catch (_) {
    const m = c.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (_2) { return null; } }
    return null;
  }
}

function buildBlockPrompt(block, fixture) {
  const ctx = {
    candidateAnswer: fixture.candidate_last_answer,
    resumeChunk: fixture.resume,
    jobDescription: fixture.jd,
    questionHistory: fixture.history.map((h) => h.q || h),
    sessionState: fixture.session_state
  };
  switch (block) {
    case 'A': return buildBlockA(ctx);
    case 'C': return buildBlockC(ctx);
    default: throw new Error(`eval-block currently supports A and C standalone. For B/D/E/F/G use eval-e2e and read the trace.`);
  }
}

function scoreA(parsed, fixture) {
  // raw_span literal-substring check
  if (!parsed || !Array.isArray(parsed.claims)) return { raw_span_pass: 0, raw_span_total: 0 };
  const answer = String(fixture.candidate_last_answer || '');
  let pass = 0;
  for (const c of parsed.claims) {
    if (typeof c.raw_span === 'string' && answer.includes(c.raw_span)) pass += 1;
  }
  return { raw_span_pass: pass, raw_span_total: parsed.claims.length };
}

function scoreC(parsed, fixture) {
  if (!parsed) return { matches_gold: false };
  return { matches_gold: parsed.next_competency_target === fixture.ground_truth?.competency_target };
}

async function main() {
  const { block, limit } = parseArgs();
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }

  const files = fs.readdirSync(FIXTURE_DIR).filter((n) => n.startsWith('fx_') && n.endsWith('.json')).sort();
  const slice = limit ? files.slice(0, limit) : files;
  console.log(`Eval block ${block} on ${slice.length} fixtures`);

  const results = [];
  for (let i = 0; i < slice.length; i++) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, slice[i]), 'utf8'));
    process.stdout.write(`  ${i + 1}/${slice.length}\r`);
    try {
      const prompt = buildBlockPrompt(block, fixture);
      const text = await callBlockOnce({ apiKey, model: BLOCK_MODELS[block], prompt, maxTokens: 1500 });
      const parsed = safeJson(text);
      const validation = validateBlock(block, parsed);
      const blockScore = block === 'A' ? scoreA(parsed, fixture) : block === 'C' ? scoreC(parsed, fixture) : {};
      results.push({ id: fixture.id, schema_ok: validation.ok, errors: validation.errors, blockScore });
    } catch (err) {
      results.push({ id: fixture.id, error: err.message });
    }
  }
  console.log();

  const okCount = results.filter((r) => r.schema_ok).length;
  let aggregate = { schema_pass: okCount, total: results.length };
  if (block === 'A') {
    const totalSpans = results.reduce((a, r) => a + (r.blockScore?.raw_span_total || 0), 0);
    const passSpans = results.reduce((a, r) => a + (r.blockScore?.raw_span_pass || 0), 0);
    aggregate.raw_span_pass_rate = totalSpans ? passSpans / totalSpans : 0;
  }
  if (block === 'C') {
    const golds = results.filter((r) => r.blockScore?.matches_gold).length;
    aggregate.next_competency_gold_match_rate = results.length ? golds / results.length : 0;
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, `eval-block-${block}-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ block, aggregate, results }, null, 2));
  console.log(JSON.stringify(aggregate, null, 2));
  console.log(`Report → ${out}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
