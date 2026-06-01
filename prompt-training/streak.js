// streak.js — evaluate the user's stopping condition on a judged JSONL:
// "100 consecutive questions each scoring >= 90 on trait/strength/potential".
//
// Reports: n scored, pass-rate@90, mean total, LONGEST consecutive >=90 streak
// (in file order — order = generation order), and the lowest scorers with their
// weakest dimension + justification so the next prompt iteration can target them.
//
// Usage: node prompt-training/streak.js <judged.jsonl> [--threshold 90] [--need 100] [--show 12]

const fs = require('fs');

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { file: null, threshold: 90, need: 100, show: 12 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--threshold') o.threshold = parseInt(a[++i], 10);
    else if (a[i] === '--need') o.need = parseInt(a[++i], 10);
    else if (a[i] === '--show') o.show = parseInt(a[++i], 10);
    else if (!o.file) o.file = a[i];
  }
  return o;
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function main() {
  const o = parseArgs();
  if (!o.file) { console.error('usage: streak.js <judged.jsonl> [--threshold 90] [--need 100]'); process.exit(2); }
  const recs = fs.readFileSync(o.file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const scored = recs.filter((r) => r.judge && typeof r.judge.total === 'number');
  const totals = scored.map((r) => r.judge.total);
  const passes = scored.map((r) => r.judge.total >= o.threshold);
  const passCount = passes.filter(Boolean).length;

  // Longest consecutive run of >= threshold, in file order.
  let best = 0, cur = 0, bestEnd = -1;
  for (let i = 0; i < passes.length; i++) {
    if (passes[i]) { cur++; if (cur > best) { best = cur; bestEnd = i; } }
    else cur = 0;
  }
  // Current trailing streak (most recent questions).
  let trailing = 0;
  for (let i = passes.length - 1; i >= 0 && passes[i]; i--) trailing++;

  console.log(`file: ${o.file}`);
  console.log(`scored: ${scored.length}`);
  console.log(`mean total: ${mean(totals).toFixed(1)}   median: ${[...totals].sort((a,b)=>a-b)[Math.floor(totals.length/2)]}`);
  console.log(`pass-rate @${o.threshold}: ${passCount}/${scored.length} = ${(100*passCount/scored.length).toFixed(1)}%`);
  console.log(`LONGEST consecutive >=${o.threshold}: ${best}  (need ${o.need})  ${best >= o.need ? '✅ STOP CONDITION MET' : '❌ not yet'}`);
  console.log(`trailing streak: ${trailing}`);
  if (bestEnd >= 0) {
    const s = bestEnd - best + 1;
    console.log(`  best run = records [${s}..${bestEnd}] ids ${scored[s].id}..${scored[bestEnd].id}`);
  }

  // Dimension means to see where points are lost.
  const dims = ['depth', 'ownership', 'trait', 'anchoring', 'antitriviality'];
  const dmax = { depth: 30, ownership: 20, trait: 25, anchoring: 15, antitriviality: 10 };
  console.log('dimension means (of max):');
  for (const d of dims) console.log(`  ${d}: ${mean(scored.map((r)=>r.judge[d]||0)).toFixed(1)}/${dmax[d]}`);

  // Failures below threshold — the work list for the next iteration.
  const fails = scored.filter((r) => r.judge.total < o.threshold).sort((a,b)=>a.judge.total-b.judge.total);
  console.log(`\n--- ${Math.min(o.show, fails.length)} lowest (of ${fails.length} below ${o.threshold}) ---`);
  for (const r of fails.slice(0, o.show)) {
    const j = r.judge;
    console.log(`[${j.total}] ${r.id} weakest=${j.weakest||'?'}${j.gateApplied?' GATED':''}`);
    console.log(`   Q: ${String(r.primary_question||'').slice(0,160)}`);
    console.log(`   why: ${String(j.justification||'').slice(0,160)}`);
  }
}
main();
