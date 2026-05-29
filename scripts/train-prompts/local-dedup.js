// Local, no-API near-duplicate check — fallback for embed-dedup.js when the
// DashScope key lacks text-embedding-v3 access (Model.AccessDenied on the
// /compatible-mode embeddings endpoint). Uses 64-permutation MinHash over
// character 4-gram shingles of (resume + jd + candidate_last_answer) to
// estimate pairwise Jaccard similarity. Flags pairs >= threshold. Does NOT
// delete; writes _manifests/local-dedup-report.json.
//
// Usage: node scripts/train-prompts/local-dedup.js [--threshold 0.7]

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');
const REPORT = path.join(FIXTURE_DIR, '_manifests', 'local-dedup-report.json');
const K = 4;            // char shingle size (works for en + zh)
const NUM_HASH = 64;
let THRESHOLD = 0.7;

const a = process.argv.slice(2);
for (let i = 0; i < a.length; i += 1) if (a[i] === '--threshold' && a[i + 1]) THRESHOLD = parseFloat(a[i + 1]);

// 64 random linear-transform constants (odd multipliers) for permutation hashing.
const A = Array.from({ length: NUM_HASH }, (_, i) => ((i * 2654435761) | 1) >>> 0);
const B = Array.from({ length: NUM_HASH }, (_, i) => ((i * 40503 + 12345)) >>> 0);

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function fnv(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i += 1) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

function signature(text) {
  const seen = new Set();
  const sig = new Array(NUM_HASH).fill(0xFFFFFFFF);
  for (let i = 0; i + K <= text.length; i += 1) {
    const sh = text.slice(i, i + K);
    if (seen.has(sh)) continue;
    seen.add(sh);
    const base = fnv(sh);
    for (let j = 0; j < NUM_HASH; j += 1) {
      const v = (Math.imul(base, A[j]) + B[j]) >>> 0;
      if (v < sig[j]) sig[j] = v;
    }
  }
  return sig;
}

function estJaccard(x, y) {
  let eq = 0;
  for (let j = 0; j < NUM_HASH; j += 1) if (x[j] === y[j]) eq += 1;
  return eq / NUM_HASH;
}

function main() {
  const files = fs.readdirSync(FIXTURE_DIR).filter((n) => /^fx_\d+\.json$/.test(n)).sort();
  const ids = [];
  const sigs = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8'));
    const text = `${norm(d.resume)} ${norm(d.jd)} ${norm(d.candidate_last_answer)}`;
    ids.push(d.id);
    sigs.push(signature(text));
  }
  const pairs = [];
  for (let i = 0; i < sigs.length; i += 1) {
    for (let j = i + 1; j < sigs.length; j += 1) {
      const s = estJaccard(sigs[i], sigs[j]);
      if (s >= THRESHOLD) pairs.push({ a: ids[i], b: ids[j], est_jaccard: Number(s.toFixed(3)) });
    }
  }
  pairs.sort((x, y) => y.est_jaccard - x.est_jaccard);
  const report = {
    method: 'minhash-char4gram-64perm',
    threshold: THRESHOLD,
    fixtures: files.length,
    pairs_compared: (files.length * (files.length - 1)) / 2,
    near_dup_pairs: pairs.length,
    top: pairs.slice(0, 25)
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fixtures: report.fixtures, threshold: THRESHOLD, near_dup_pairs: report.near_dup_pairs, top5: pairs.slice(0, 5) }, null, 2));
  console.log(`Report -> ${REPORT}`);
}

if (require.main === module) main();
