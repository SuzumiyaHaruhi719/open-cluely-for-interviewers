// ============================================================================
// Fixture diversity-slot allocator
// ----------------------------------------------------------------------------
// Produces a deterministic assignment of (industry, level, language,
// answer_quality, history_length, resume_type, edge_case) tags to 1000
// fixture slots, then partitions the 1000 slots into 20 batches of 50.
//
// Each batch becomes the slot manifest for one Opus fixture-writing subagent.
//
// The allocator uses a constraint-satisfaction strategy:
//   1. Each dimension's values are assigned via interleaved round-robin so
//      every value's minimum quota is met before any value goes over.
//   2. Dimensions are assigned independently with offset-prime stride to
//      approximate a Latin square — no two dimensions are correlated.
//   3. Edge cases are assigned to a randomized subset of 150 slots (out of
//      1000) so they're sprinkled across batches rather than clumped.
//   4. Batches are then formed by taking every 20th slot — batch 0 gets
//      slots 0, 20, 40, ...; batch 1 gets 1, 21, 41, ...; etc. This ensures
//      each batch's 50 slots are well-spread across the diversity space.
//
// Run:  node scripts/train-prompts/alloc-slots.js
// Writes: fixtures/expert-interview/_manifests/batch-<NN>.json (20 files)
//         fixtures/expert-interview/_manifests/diversity-plan.json
// ============================================================================

const fs = require('fs');
const path = require('path');

const TOTAL_FIXTURES = 1000;
const BATCH_COUNT = 20;
const BATCH_SIZE = 50;

const INDUSTRIES = [
  'tech-engineering', 'product-management', 'data', 'design',
  'sales', 'operations', 'hr', 'legal',
  'finance', 'marketing', 'customer-support', 'supply-chain',
  'manufacturing', 'research', 'education', 'healthcare'
];
const LEVELS = ['intern', 'junior', 'mid', 'senior', 'staff', 'director', 'vp'];
const LANGUAGES = [
  { tag: 'zh', count: 400 },
  { tag: 'en', count: 400 },
  { tag: 'mixed', count: 200 }
];
const ANSWER_QUALITIES = [
  'STAR-complete', 'STAR-partial', 'vague-empty', 'over-packaged',
  'inflated-metrics', 'off-topic', 'deflective-blame', 'concise-precise',
  'defensive-hostile', 'nervous-rambling', 'overtime-tangent',
  'counter-question', 'team-credit-only', 'timeline-confused'
];
const HISTORY_BUCKETS = [
  { tag: '1-3', count: 250, minRange: 1, maxRange: 3 },
  { tag: '4-7', count: 250, minRange: 4, maxRange: 7 },
  { tag: '8-12', count: 250, minRange: 8, maxRange: 12 },
  { tag: '13+', count: 250, minRange: 13, maxRange: 18 }
];
const RESUME_TYPES = [
  'clean-STAR', 'keyword-stuffed', 'numbers-missing',
  'self-contradictory', 'over-bragging', 'sparse-200words', 'verbose-1500words'
];
const EDGE_CASES = [
  'silent-then-recovered', 'multi-task-in-one-answer', 'reverses-question',
  'cites-NDA', 'borderline-compliance'
];
// 5 × 30 = 150 fixtures get an edge case; the rest have null.
const EDGE_CASE_COUNT = 30;
const TOTAL_EDGE_FIXTURES = EDGE_CASE_COUNT * EDGE_CASES.length;

function expandLanguage() {
  const out = [];
  for (const { tag, count } of LANGUAGES) for (let i = 0; i < count; i++) out.push(tag);
  return out;
}

function expandHistory() {
  const out = [];
  for (const bucket of HISTORY_BUCKETS) {
    for (let i = 0; i < bucket.count; i++) {
      const min = bucket.minRange;
      const max = bucket.maxRange;
      const length = min + ((i * 7) % (max - min + 1));
      out.push({ tag: bucket.tag, length });
    }
  }
  return out;
}

function roundRobin(values, total) {
  const out = [];
  for (let i = 0; i < total; i++) out.push(values[i % values.length]);
  return out;
}

// LCG-style deterministic shuffle so output is reproducible. We don't import
// crypto — fixture generation doesn't need true randomness, just decorrelation.
function deterministicShuffle(array, seed) {
  const out = array.slice();
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildSlots() {
  // Pre-shuffle each dimension's expanded sequence with a distinct seed so the
  // dimensions are independent. Without this, e.g. industry[0] would always
  // co-occur with level[0] and break diversity.
  const industries = deterministicShuffle(roundRobin(INDUSTRIES, TOTAL_FIXTURES), 0xA1);
  const levels = deterministicShuffle(roundRobin(LEVELS, TOTAL_FIXTURES), 0xB2);
  const languages = deterministicShuffle(expandLanguage(), 0xC3);
  const qualities = deterministicShuffle(roundRobin(ANSWER_QUALITIES, TOTAL_FIXTURES), 0xD4);
  const histories = deterministicShuffle(expandHistory(), 0xE5);
  const resumes = deterministicShuffle(roundRobin(RESUME_TYPES, TOTAL_FIXTURES), 0xF6);

  // Edge cases: pick 150 slot indices uniformly.
  const edgeAssignments = new Array(TOTAL_FIXTURES).fill(null);
  const edgeIndices = deterministicShuffle(
    Array.from({ length: TOTAL_FIXTURES }, (_, i) => i),
    0x171
  ).slice(0, TOTAL_EDGE_FIXTURES);
  edgeIndices.forEach((slotIdx, k) => {
    edgeAssignments[slotIdx] = EDGE_CASES[Math.floor(k / EDGE_CASE_COUNT) % EDGE_CASES.length];
  });

  const slots = [];
  for (let i = 0; i < TOTAL_FIXTURES; i++) {
    const fixtureId = `fx_${String(i + 1).padStart(4, '0')}`;
    slots.push({
      fixture_id: fixtureId,
      slot_index: i,
      tags: {
        industry: industries[i],
        level: levels[i],
        language: languages[i],
        answer_quality: qualities[i],
        history_length_bucket: histories[i].tag,
        history_length: histories[i].length,
        resume_type: resumes[i],
        edge_case: edgeAssignments[i]
      }
    });
  }
  return slots;
}

function partitionIntoBatches(slots) {
  const batches = Array.from({ length: BATCH_COUNT }, () => []);
  // Strided assignment: slot i → batch (i % 20). This guarantees every batch
  // gets a uniformly thinned slice of the diversity space.
  slots.forEach((slot, i) => {
    batches[i % BATCH_COUNT].push(slot);
  });
  return batches;
}

function verifyQuotas(slots) {
  const errors = [];
  const counts = (key) => {
    const m = new Map();
    for (const s of slots) {
      const v = s.tags[key];
      const k = v === null ? '__null__' : v;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };

  const ind = counts('industry');
  for (const i of INDUSTRIES) if ((ind.get(i) || 0) < 50) errors.push(`industry "${i}" got ${ind.get(i) || 0}, need >=50`);

  const lvl = counts('level');
  for (const l of LEVELS) if ((lvl.get(l) || 0) < 50) errors.push(`level "${l}" got ${lvl.get(l) || 0}, need >=50`);

  const lang = counts('language');
  if ((lang.get('zh') || 0) < 400) errors.push(`zh got ${lang.get('zh') || 0}, need >=400`);
  if ((lang.get('en') || 0) < 400) errors.push(`en got ${lang.get('en') || 0}, need >=400`);
  if ((lang.get('mixed') || 0) < 200) errors.push(`mixed got ${lang.get('mixed') || 0}, need >=200`);

  const qual = counts('answer_quality');
  for (const q of ANSWER_QUALITIES) if ((qual.get(q) || 0) < 50) errors.push(`answer_quality "${q}" got ${qual.get(q) || 0}, need >=50`);

  const hist = counts('history_length_bucket');
  for (const h of HISTORY_BUCKETS) if ((hist.get(h.tag) || 0) < 200) errors.push(`history "${h.tag}" got ${hist.get(h.tag) || 0}, need >=200`);

  const res = counts('resume_type');
  for (const r of RESUME_TYPES) if ((res.get(r) || 0) < 100) errors.push(`resume "${r}" got ${res.get(r) || 0}, need >=100`);

  const edge = counts('edge_case');
  for (const e of EDGE_CASES) if ((edge.get(e) || 0) < 30) errors.push(`edge "${e}" got ${edge.get(e) || 0}, need >=30`);

  return errors;
}

function main() {
  const outDir = path.join(process.cwd(), 'fixtures', 'expert-interview', '_manifests');
  fs.mkdirSync(outDir, { recursive: true });

  const slots = buildSlots();
  const errors = verifyQuotas(slots);
  if (errors.length) {
    console.error('Quota violations:');
    for (const e of errors) console.error(' -', e);
    process.exit(2);
  }
  const batches = partitionIntoBatches(slots);

  // Write per-batch manifests
  batches.forEach((batch, idx) => {
    const batchNum = String(idx + 1).padStart(2, '0');
    const file = path.join(outDir, `batch-${batchNum}.json`);
    fs.writeFileSync(file, JSON.stringify({
      batch_index: idx + 1,
      slot_count: batch.length,
      slots: batch
    }, null, 2));
  });

  // Write a summary plan
  const summary = {
    total_fixtures: slots.length,
    batches: BATCH_COUNT,
    batch_size: BATCH_SIZE,
    dimensions: {
      industries: INDUSTRIES,
      levels: LEVELS,
      languages: LANGUAGES.map((l) => l.tag),
      answer_qualities: ANSWER_QUALITIES,
      history_buckets: HISTORY_BUCKETS.map((h) => h.tag),
      resume_types: RESUME_TYPES,
      edge_cases: EDGE_CASES
    },
    quota_check: 'PASS'
  };
  fs.writeFileSync(
    path.join(outDir, 'diversity-plan.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(`Wrote ${BATCH_COUNT} batch manifests to ${outDir}`);
  console.log('Quota verification: PASS');
}

if (require.main === module) main();

module.exports = {
  buildSlots,
  partitionIntoBatches,
  verifyQuotas,
  INDUSTRIES, LEVELS, ANSWER_QUALITIES, HISTORY_BUCKETS, RESUME_TYPES, EDGE_CASES
};
