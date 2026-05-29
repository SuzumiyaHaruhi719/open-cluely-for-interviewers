// Allocator for parallel fixture authoring.
//
// Computes the next N unfilled fixture slots (every fixture_id named in the
// batch manifests, minus the fx_*.json already written to disk), sorted by
// fixture_id, and partitions them into C chunk files so disjoint subagents can
// author them in parallel with zero overlap.
//
// Each chunk file: { assignment_id, count, slots: [{ fixture_id, tags }] }
//
// Usage:  node scripts/train-prompts/next-slots.js [--count 48] [--chunks 4]
// Writes: fixtures/expert-interview/_assign/chunk-XX.json  (cleared each run)
// Prints: a JSON summary including absolute chunk-file paths.

const fs = require('fs');
const path = require('path');

const FX_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');
const MANIFEST_DIR = path.join(FX_DIR, '_manifests');
const ASSIGN_DIR = path.join(FX_DIR, '_assign');

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { count: 48, chunks: 4 };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--count' && a[i + 1]) { o.count = parseInt(a[i + 1], 10); i += 1; }
    else if (a[i] === '--chunks' && a[i + 1]) { o.chunks = parseInt(a[i + 1], 10); i += 1; }
  }
  return o;
}

function loadManifestSlots() {
  const map = new Map(); // fixture_id -> tags
  for (const name of fs.readdirSync(MANIFEST_DIR)) {
    if (!/^batch-\d+\.json$/.test(name)) continue;
    const data = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, name), 'utf8'));
    for (const slot of data.slots) map.set(slot.fixture_id, slot.tags);
  }
  return map;
}

function existingIds() {
  const set = new Set();
  for (const name of fs.readdirSync(FX_DIR)) {
    if (!/^fx_\d+\.json$/.test(name)) continue;
    // Only a fixture that parses and carries an `id` counts as done; a partial
    // or corrupt file is treated as not-yet-written so it gets reassigned.
    try {
      const d = JSON.parse(fs.readFileSync(path.join(FX_DIR, name), 'utf8'));
      if (d && d.id) set.add(d.id);
    } catch (_) { /* not done */ }
  }
  return set;
}

function idNum(id) { return parseInt(String(id).slice(3), 10); }

function main() {
  const { count, chunks } = parseArgs();
  const manifest = loadManifestSlots();
  const have = existingIds();
  const unfilled = [...manifest.keys()]
    .filter((id) => !have.has(id))
    .sort((a, b) => idNum(a) - idNum(b));
  const taking = unfilled.slice(0, count);

  if (!fs.existsSync(ASSIGN_DIR)) fs.mkdirSync(ASSIGN_DIR, { recursive: true });
  for (const n of fs.readdirSync(ASSIGN_DIR)) {
    if (/^chunk-\d+\.json$/.test(n)) fs.unlinkSync(path.join(ASSIGN_DIR, n));
  }

  const per = Math.max(1, Math.ceil(taking.length / chunks));
  const chunkFiles = [];
  for (let c = 0; c < chunks; c += 1) {
    const slice = taking.slice(c * per, (c + 1) * per);
    if (slice.length === 0) break;
    const slots = slice.map((id) => ({ fixture_id: id, tags: manifest.get(id) }));
    const file = path.join(ASSIGN_DIR, `chunk-${String(c + 1).padStart(2, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify({ assignment_id: c + 1, count: slots.length, slots }, null, 2));
    chunkFiles.push(file);
  }

  console.log(JSON.stringify({
    total_manifest: manifest.size,
    have: have.size,
    total_unfilled: unfilled.length,
    taking: taking.length,
    remaining_after: unfilled.length - taking.length,
    chunk_files: chunkFiles
  }, null, 2));
}

if (require.main === module) main();

module.exports = { loadManifestSlots, existingIds };
