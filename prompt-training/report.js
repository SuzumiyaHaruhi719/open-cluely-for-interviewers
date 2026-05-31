// report.js — aggregate a judged JSONL: pass-rate, mean total, per-dimension
// means, per-answer_quality-bucket pass-rate, gate frequency, and a sample of
// the lowest + highest scorers for Claude's manual audit.
//
// Usage: node prompt-training/report.js prompt-training/results/baseline.judged.jsonl [--show 8]

const fs = require('fs');

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { file: null, show: 6 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--show') o.show = parseInt(a[++i], 10);
    else if (!o.file) o.file = a[i];
  }
  return o;
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function main() {
  const o = parseArgs();
  if (!o.file) { console.error('usage: report.js <judged.jsonl> [--show N]'); process.exit(2); }
  const recs = fs.readFileSync(o.file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const scored = recs.filter((r) => r.judge && typeof r.judge.total === 'number');
  const totals = scored.map((r) => r.judge.total);
  const passCount = scored.filter((r) => r.judge.pass).length;
  const gated = scored.filter((r) => r.judge.gateApplied).length;

  const dims = ['depth', 'ownership', 'trait', 'anchoring', 'antitriviality'];
  const dimMeans = {};
  for (const d of dims) dimMeans[d] = Number(mean(scored.map((r) => r.judge[d] || 0)).toFixed(1));

  // Per answer_quality bucket.
  const byBucket = {};
  for (const r of scored) {
    const b = (r.tags && r.tags.answer_quality) || 'unknown';
    (byBucket[b] = byBucket[b] || []).push(r);
  }
  const bucketRows = Object.keys(byBucket).sort().map((b) => {
    const rs = byBucket[b];
    return `  ${b.padEnd(20)} n=${String(rs.length).padStart(2)} pass=${rs.filter((r) => r.judge.pass).length}/${rs.length} mean=${mean(rs.map((r) => r.judge.total)).toFixed(1)}`;
  });

  console.log('================ PTES REPORT ================');
  console.log('file:', o.file);
  console.log(`scored: ${scored.length}  | PASS(>=80): ${passCount} (${(100 * passCount / Math.max(1, scored.length)).toFixed(1)}%)`);
  console.log(`mean total: ${mean(totals).toFixed(1)}  | min ${Math.min(...totals)}  max ${Math.max(...totals)}  | GATED(fact-pin): ${gated}`);
  console.log('dim means:', JSON.stringify(dimMeans));
  console.log('--- per answer_quality bucket ---');
  console.log(bucketRows.join('\n'));

  const sorted = scored.slice().sort((a, b) => a.judge.total - b.judge.total);
  const showLow = sorted.slice(0, o.show);
  const showHigh = sorted.slice(-o.show).reverse();
  const fmt = (r) => `  [${String(r.judge.total).padStart(3)}] ${r.id} (${(r.tags && r.tags.answer_quality) || '?'})\n      Q: ${r.primary_question}\n      why: ${r.judge.justification || ''}`;
  console.log(`\n--- LOWEST ${showLow.length} (audit these) ---`);
  console.log(showLow.map(fmt).join('\n'));
  console.log(`\n--- HIGHEST ${showHigh.length} (audit these) ---`);
  console.log(showHigh.map(fmt).join('\n'));
}

main();
