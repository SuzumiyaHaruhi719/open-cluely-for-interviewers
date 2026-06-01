#!/usr/bin/env node
// open-cluely CLI — a headless interface to the interviewer pipeline engine.
// Lets you run presets/pipelines, manage the preset library, and eval quality
// without the Electron GUI. Reuses the SP1 engine + preset library + the
// prompt-training harness.
//
// API key: DASHSCOPE_API_KEY env, else cache/app-state.json → dashscopeApiKey.
// Transport: set DASHSCOPE_TRANSPORT=curl for reliability from this Win env.
//
// Usage:
//   node cli.js help
//   node cli.js ask "<candidate answer>" [--preset expert] [--resume R] [--jd J] [--history "q1||q2"] [--trace]
//   node cli.js pipeline list
//   node cli.js pipeline show <id>
//   node cli.js pipeline validate <file.json>
//   node cli.js pipeline run <id|file.json> --answer "<...>" [--fixture fx_0001] [--trace]
//   node cli.js pipeline save <file.json> | delete <id> | export <id> | import <file.json>
//   node cli.js eval [--preset expert] [--per-bucket N] [--limit N] [--concurrency C]
//   node cli.js judge --in <questions.jsonl>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const lib = require('./src/services/ai/pipeline/preset-library');
const { validatePipeline } = require('./src/services/ai/pipeline/pipeline-schema');
const { BLOCK_TYPES } = require('./src/services/ai/pipeline/block-types');

function resolveApiKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  try { return String(JSON.parse(fs.readFileSync(path.join(ROOT, 'cache', 'app-state.json'), 'utf8')).dashscopeApiKey || '').trim(); } catch (_) { return ''; }
}

// Minimal flag parser: --key value (and bare positionals).
function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[k] = argv[++i]; } else { flags[k] = true; }
    } else pos.push(argv[i]);
  }
  return { pos, flags };
}

function loadFixture(id) {
  const p = path.join(ROOT, 'fixtures', 'expert-interview', id.endsWith('.json') ? id : `${id}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function fmtMs(ms) { return `${(ms / 1000).toFixed(1)}s`; }

async function runPipelineObj(pipeline, context, withTrace) {
  const { runPipeline } = require('./src/services/ai/pipeline/pipeline-engine');
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No DashScope key (set DASHSCOPE_API_KEY or cache/app-state.json).'); process.exit(2); }
  const phases = [];
  const t0 = Date.now();
  const r = await runPipeline({ pipeline, apiKey, context, onProgress: (e) => { if (e.status === 'done') phases.push(`${e.phase}(${e.tokens ? e.tokens.input + e.tokens.output : 0}tok)`); } });
  const out = r.output || {};
  console.log('\n=== FOLLOW-UP ===');
  console.log('Q:', out.primary_question || '(none)');
  if (out.alternative_question) console.log('ALT:', out.alternative_question);
  if (out.rationale_for_interviewer) console.log('WHY:', out.rationale_for_interviewer);
  console.log(`\npipeline=${pipeline.name} elapsed=${fmtMs(r.elapsedMs)} tokens=${r.tokensUsed.total} (in ${r.tokensUsed.input}/out ${r.tokensUsed.output})`);
  if (r.fallbackTriggered.length) console.log('fallbacks:', r.fallbackTriggered.join(','));
  console.log('phases:', phases.join(' → '));
  if (withTrace) {
    console.log('\n--- trace ---');
    for (const t of r.trace) console.log(`  ${t.block} att${t.attempt} ${fmtMs(t.ms)} ${t.ok ? 'ok' : 'FAIL'} ${t.model || ''} ${t.usage ? `in/out ${t.usage.input_tokens || 0}/${t.usage.output_tokens || 0}` : ''}`);
  }
  return r;
}

function contextFromFlags(flags, answerArg) {
  if (flags.fixture) {
    const fx = loadFixture(flags.fixture);
    return { candidateAnswer: answerArg || fx.candidate_last_answer, resumeChunk: fx.resume, jobDescription: fx.jd, questionHistory: (fx.history || []).map((h) => h.q || h), sessionState: fx.session_state };
  }
  return {
    candidateAnswer: answerArg || flags.answer || '',
    resumeChunk: flags.resume || '',
    jobDescription: flags.jd || '',
    questionHistory: flags.history ? String(flags.history).split('||') : [],
    sessionState: null
  };
}

function shellHarness(script, args) {
  execFileSync('node', [path.join('prompt-training', script), ...args], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, DASHSCOPE_TRANSPORT: process.env.DASHSCOPE_TRANSPORT || 'curl' }
  });
}

const HELP = `open-cluely CLI
  ask "<answer>" [--preset expert] [--resume R] [--jd J] [--history "q1||q2"] [--fixture fx_0001] [--trace]
  pipeline list | show <id> | validate <file> | run <id|file> --answer "..." [--fixture id] [--trace]
  pipeline save <file> | delete <id> | export <id> | import <file>
  eval [--preset expert] [--per-bucket N|--limit N] [--concurrency C]
  judge --in <questions.jsonl>`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);

  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); return; }

  if (cmd === 'ask') {
    const pipeline = lib.getPipeline(flags.preset || 'expert');
    if (!pipeline) { console.error(`unknown preset: ${flags.preset}`); process.exit(2); }
    await runPipelineObj(pipeline, contextFromFlags(flags, pos[0]), Boolean(flags.trace));
    return;
  }

  if (cmd === 'pipeline') {
    const sub = pos[0];
    if (sub === 'list') {
      for (const p of lib.listPipelines()) console.log(`${p.builtin ? '[builtin]' : '[user]   '} ${p.id}  "${p.name}"  (${p.nodes} blocks)`);
      return;
    }
    if (sub === 'show') { const p = lib.getPipeline(pos[1]); if (!p) { console.error('not found'); process.exit(2); } console.log(JSON.stringify(p, null, 2)); return; }
    if (sub === 'validate') {
      const p = JSON.parse(fs.readFileSync(pos[1], 'utf8'));
      const v = validatePipeline(p, BLOCK_TYPES);
      console.log(v.ok ? `VALID (terminal: ${v.terminalId})` : `INVALID:\n - ${v.errors.join('\n - ')}`);
      process.exit(v.ok ? 0 : 1);
    }
    if (sub === 'run') {
      const idOrFile = pos[1];
      const pipeline = idOrFile && idOrFile.endsWith('.json') ? JSON.parse(fs.readFileSync(idOrFile, 'utf8')) : lib.getPipeline(idOrFile);
      if (!pipeline) { console.error('pipeline not found'); process.exit(2); }
      await runPipelineObj(pipeline, contextFromFlags(flags, flags.answer), Boolean(flags.trace));
      return;
    }
    if (sub === 'save') { console.log('saved:', lib.savePipeline(JSON.parse(fs.readFileSync(pos[1], 'utf8')))); return; }
    if (sub === 'delete') { console.log('deleted:', lib.deletePipeline(pos[1])); return; }
    if (sub === 'export') { const s = lib.exportPipeline(pos[1]); if (!s) { console.error('not found'); process.exit(2); } console.log(s); return; }
    if (sub === 'import') { console.log('imported:', lib.importPipeline(fs.readFileSync(pos[1], 'utf8'))); return; }
    console.error(`unknown pipeline subcommand: ${sub}`); process.exit(2);
  }

  if (cmd === 'eval') {
    const out = `prompt-training/results/cli-eval-${Date.now()}.jsonl`;
    const genArgs = [];
    if (flags['per-bucket']) genArgs.push('--per-bucket', String(flags['per-bucket']));
    else genArgs.push('--limit', String(flags.limit || 5));
    genArgs.push('--concurrency', String(flags.concurrency || 8), '--out', out);
    shellHarness('gen-questions.js', genArgs);
    const judged = out.replace(/\.jsonl$/, '.judged.jsonl');
    shellHarness('judge.js', ['--in', out, '--out', judged, '--concurrency', '12']);
    execFileSync('node', [path.join('prompt-training', 'report.js'), judged, '--show', '4'], { cwd: ROOT, stdio: 'inherit' });
    return;
  }

  if (cmd === 'judge') {
    if (!flags.in) { console.error('--in required'); process.exit(2); }
    const judged = String(flags.in).replace(/\.jsonl$/, '.judged.jsonl');
    shellHarness('judge.js', ['--in', flags.in, '--out', judged, '--concurrency', '12']);
    execFileSync('node', [path.join('prompt-training', 'report.js'), judged], { cwd: ROOT, stdio: 'inherit' });
    return;
  }

  console.error(`unknown command: ${cmd}\n\n${HELP}`); process.exit(2);
}

main().catch((e) => { console.error('CLI error:', e && e.stack ? e.stack : e); process.exit(1); });
