// Embedding-based dedup using DashScope text-embedding-v3 via the
// OpenAI-compatible endpoint. The Anthropic-shape endpoint does not expose
// embeddings, but the same DashScope key works on /compatible-mode/v1.
//
// Pairwise cosine similarity > 0.85 between two fixtures' (resume + JD +
// candidate_last_answer) concatenated text triggers rejection of the later-
// indexed fixture (we keep the earlier one). Rejected fixtures are NOT
// deleted from disk — they are listed in dedup-report.json so the orchestrator
// can decide whether to re-write or accept the corpus as-is.
//
// Usage: DASHSCOPE_API_KEY=... node scripts/train-prompts/embed-dedup.js
//        (or reads cache/app-state.json when env var unset)

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');
const MANIFEST_DIR = path.join(FIXTURE_DIR, '_manifests');
const REPORT_PATH = path.join(MANIFEST_DIR, 'dedup-report.json');

const DASHSCOPE_EMBED_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
const EMBED_MODEL = 'text-embedding-v3';
const SIM_THRESHOLD = 0.85;
const BATCH_SIZE = 25; // DashScope embedding batch cap
const MAX_TEXT_CHARS = 4000;

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try {
    const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'app-state.json'), 'utf8'));
    return String(state.dashscopeApiKey || '').trim();
  } catch (_) { return ''; }
}

function listFixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json') && name.startsWith('fx_'))
    .sort()
    .map((name) => path.join(FIXTURE_DIR, name));
}

function dedupText(fixture) {
  const resume = String(fixture?.resume || '').trim();
  const jd = String(fixture?.jd || '').trim();
  const answer = String(fixture?.candidate_last_answer || '').trim();
  return `${resume}\n${jd}\n${answer}`.slice(0, MAX_TEXT_CHARS);
}

async function embedBatch(apiKey, texts) {
  const resp = await fetch(DASHSCOPE_EMBED_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Embedding API ${resp.status}: ${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  return (json?.data || []).map((entry) => entry.embedding);
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key'); process.exit(2); }

  const files = listFixtures();
  console.log(`Embedding ${files.length} fixtures...`);
  if (files.length === 0) { console.log('No fixtures'); return; }

  const fixtures = files.map((p) => ({ id: path.basename(p, '.json'), file: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }));
  const texts = fixtures.map((f) => dedupText(f.data));

  const embeddings = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  embedding ${i + batch.length}/${texts.length}...\r`);
    const result = await embedBatch(apiKey, batch);
    embeddings.push(...result);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`\nEmbedded ${embeddings.length} vectors`);

  const rejects = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = cosineSim(embeddings[i], embeddings[j]);
      if (sim > SIM_THRESHOLD) {
        rejects.push({ keep: fixtures[i].id, reject: fixtures[j].id, sim: Number(sim.toFixed(4)) });
      }
    }
  }

  const rejectIds = new Set(rejects.map((r) => r.reject));
  const report = {
    total: fixtures.length,
    rejects: rejects.length,
    unique_rejected_fixtures: rejectIds.size,
    sim_threshold: SIM_THRESHOLD,
    pairs: rejects.slice(0, 200) // cap the report; full pair list lives in memory only
  };
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Found ${rejects.length} above-threshold pairs (${rejectIds.size} unique fixtures to reject)`);
  console.log(`Report → ${REPORT_PATH}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { cosineSim };
