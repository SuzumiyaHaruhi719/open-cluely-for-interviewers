// Generic typed-DAG execution engine. Runs an arbitrary Pipeline (pipeline-schema.js)
// of typed blocks (block-types.js): topo waves (independent nodes run concurrently,
// reproducing the legacy A∥C parallelism), typed-edge input threading, per-node
// model/thinking/prompt-body, schema validation + one repair retry + per-block
// fallback, and phase-grouped progress (so A∥C still report as one "answer" phase,
// preserving the renderer's 6-phase contract).
//
// Reuses the orchestrator's DashScope transport + the schema validator so a
// pipeline that re-expresses Expert reproduces today's behavior.

const { validatePipeline } = require('./pipeline-schema');
const { BLOCK_TYPES } = require('./block-types');
const { dashscopeChat, safeJsonParse } = require('../../../main-process/features/interviewer/expert-orchestrator');
const { validateBlock } = require('../interviewer-prompts/schemas');

function sumTokens(trace) {
  let input = 0; let output = 0;
  for (const t of (trace || [])) {
    if (t && t.usage) { input += Number(t.usage.input_tokens) || 0; output += Number(t.usage.output_tokens) || 0; }
  }
  return { input, output };
}

// One block call: low-temp first attempt, one schema-repair retry, else caller
// falls back. Mirrors the legacy callBlock; schemaId=null skips validation.
async function callNode({ apiKey, prompt, abortSignal, schemaId, traceId, model, temperature, maxTokens, timeoutMs, thinking }) {
  const start = Date.now();
  let first;
  try {
    first = await dashscopeChat({ apiKey, model, prompt, temperature, maxTokens, abortSignal, timeoutMs, thinking });
  } catch (err) {
    return { ok: false, data: null, trace: [{ block: traceId, attempt: 1, ms: Date.now() - start, ok: false, errors: [`transport: ${err.message}`], model, usage: null }] };
  }
  if (!schemaId) {
    return { ok: true, data: { text: first.text }, trace: [{ block: traceId, attempt: 1, ms: Date.now() - start, ok: true, errors: [], model, usage: first.usage || null }] };
  }
  let parsed = safeJsonParse(first.text);
  let validation = validateBlock(schemaId, parsed);
  const trace = [{ block: traceId, attempt: 1, ms: Date.now() - start, ok: validation.ok, errors: validation.errors, model, usage: first.usage || null }];
  if (validation.ok) return { ok: true, data: validation.data, trace };

  const repairPrompt = `${prompt}

[REPAIR ROUND]
Your previous output failed schema validation with these errors:
${validation.errors.map((er) => `- ${er}`).join('\n')}

Re-emit the JSON object fixing ALL listed errors. Strict JSON only — no markdown, no prose.`;
  const repairStart = Date.now();
  let second;
  try {
    second = await dashscopeChat({ apiKey, model, prompt: repairPrompt, temperature: Math.max(0, temperature - 0.05), maxTokens, abortSignal, timeoutMs, thinking });
  } catch (err) {
    trace.push({ block: traceId, attempt: 2, ms: Date.now() - repairStart, ok: false, errors: [`transport: ${err.message}`], model, usage: null, repair: true });
    return { ok: false, data: null, trace };
  }
  parsed = safeJsonParse(second.text);
  validation = validateBlock(schemaId, parsed);
  trace.push({ block: traceId, attempt: 2, ms: Date.now() - repairStart, ok: validation.ok, errors: validation.errors, model, usage: second.usage || null, repair: true });
  return { ok: validation.ok, data: validation.ok ? validation.data : null, trace };
}

/**
 * Run a pipeline. Returns { output, blocks, trace, fallbackTriggered, elapsedMs,
 * tokensUsed }. Block H (session consolidation) is the caller's concern.
 */
async function runPipeline({ pipeline, apiKey, context = {}, abortSignal = null, onProgress = null, registry = BLOCK_TYPES }) {
  const startedAt = Date.now();
  const v = validatePipeline(pipeline, registry);
  if (!v.ok) throw new Error(`Invalid pipeline: ${v.errors.join('; ')}`);

  const nodes = pipeline.nodes;
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of pipeline.edges) incoming.get(edge.toNode).push(edge);
  const deps = new Map(nodes.map((n) => [n.id, new Set(incoming.get(n.id).map((edge) => edge.fromNode))]));

  // Phase grouping (by block-type phase). totalPhases = distinct phases, ordered.
  const phaseMap = new Map();
  for (const n of nodes) {
    const ph = registry[n.type].phase || { id: n.id, index: 1 };
    if (!phaseMap.has(ph.id)) phaseMap.set(ph.id, { id: ph.id, index: ph.index, total: 0, remaining: 0, started: false, input: 0, output: 0 });
    const p = phaseMap.get(ph.id); p.total += 1; p.remaining += 1;
  }
  const totalPhases = phaseMap.size;
  function emit(ph, status, tokens) {
    if (typeof onProgress !== 'function') return;
    try { onProgress({ phase: ph.id, index: ph.index, total: totalPhases, status, tokens: tokens || null }); } catch (_) { /* best-effort */ }
  }

  const outputs = {};
  const traces = [];
  const fallbackTriggered = [];
  const completed = new Set();
  const running = new Set();

  async function runOne(node) {
    running.add(node.id);
    const type = registry[node.type];
    const ph = phaseMap.get(type.phase.id);
    if (!ph.started) { ph.started = true; emit(ph, 'start'); }

    const inputs = {};
    for (const edge of incoming.get(node.id)) inputs[edge.toPort] = outputs[edge.fromNode];

    let derived = {};
    try { derived = type.prepare ? (type.prepare(context, inputs) || {}) : {}; } catch (_) { derived = {}; }

    let ok; let data; let trace;
    if (derived.skipToFallback) {
      data = derived.fallbackData != null ? derived.fallbackData : type.fallback(context, inputs, derived);
      ok = false;
      trace = [{ block: node.id, attempt: 1, ms: 0, ok: false, errors: ['skipped — prepare short-circuit'], model: null, usage: null }];
    } else {
      const prompt = type.build(context, inputs, node.promptBody, derived);
      const res = await callNode({
        apiKey, prompt, abortSignal,
        schemaId: type.schemaId, traceId: node.id,
        model: node.model || type.defaults.model,
        thinking: node.thinking || type.defaults.thinking,
        temperature: node.temperature != null ? node.temperature : type.defaults.temperature,
        maxTokens: node.maxTokens || type.defaults.maxTokens,
        timeoutMs: type.defaults.timeoutMs
      });
      ok = res.ok;
      data = res.ok ? res.data : type.fallback(context, inputs, derived);
      trace = res.trace;
    }

    outputs[node.id] = data;
    traces.push(...trace);
    if (!ok) fallbackTriggered.push(node.id);

    const tk = sumTokens(trace);
    ph.input += tk.input; ph.output += tk.output; ph.remaining -= 1;
    running.delete(node.id);
    completed.add(node.id);
    if (ph.remaining === 0) emit(ph, 'done', { input: ph.input, output: ph.output });
  }

  // Wave loop: run all currently-runnable nodes concurrently.
  while (completed.size < nodes.length) {
    const batch = nodes.filter((n) => !completed.has(n.id) && !running.has(n.id)
      && [...deps.get(n.id)].every((d) => completed.has(d)));
    if (batch.length === 0) throw new Error('pipeline stalled — unresolved dependencies');
    await Promise.all(batch.map((n) => runOne(n)));
  }

  const blocks = {};
  for (const n of nodes) blocks[n.id] = outputs[n.id];
  const totals = sumTokens(traces);
  return {
    output: outputs[v.terminalId],
    blocks,
    trace: traces,
    fallbackTriggered,
    elapsedMs: Date.now() - startedAt,
    tokensUsed: { input: totals.input, output: totals.output, total: totals.input + totals.output }
  };
}

module.exports = { runPipeline, callNode };
