// ============================================================================
// Expert-mode 7-block orchestrator
// ----------------------------------------------------------------------------
// DAG:
//   A ∥ C  → B  → D  → E  → F  → G
//   (A and C run in parallel — C is a pure function of session state +
//    history + answer; A depends on the answer only.)
//
// Per-block models:
//   A, B, C, D, F, G → deepseek-v4-flash
//   E                → deepseek-v4-pro  (Pro tier; deep prompt-level CoT)
//
// Retry / fallback policy:
//   - Each block's first call is at low temperature.
//   - If schema validation fails OR JSON unparseable, a single repair call
//     is made with the schema errors pasted in.
//   - If the repair also fails, that block enters its fallback. Fallbacks
//     are designed so the chain produces *something* the renderer can show
//     even when the LLM misbehaves — never a thrown error.
//
// Tracing:
//   Every block call emits a trace entry: { block, attempt, ms, ok, errors,
//   modelUsed, tokensUsage }. Traces are returned in the result so the
//   evaluator + log writer can audit a run end-to-end.
// ============================================================================

const {
  buildBlockA
} = require('../../../services/ai/interviewer-prompts/expert/block-a-answer-anatomy');
const {
  buildBlockB
} = require('../../../services/ai/interviewer-prompts/expert/block-b-evidence-gap');
const {
  buildBlockC
} = require('../../../services/ai/interviewer-prompts/expert/block-c-state-update');
const {
  buildBlockD
} = require('../../../services/ai/interviewer-prompts/expert/block-d-question-pool');
const {
  buildBlockE
} = require('../../../services/ai/interviewer-prompts/expert/block-e-rank-score');
const {
  buildBlockF,
  runHardRules
} = require('../../../services/ai/interviewer-prompts/expert/block-f-safety-audit');
const {
  buildBlockG,
  EXPERT_ITERATION_VERSION
} = require('../../../services/ai/interviewer-prompts/expert/block-g-final-render');
const { validateBlock } = require('../../../services/ai/interviewer-prompts/schemas');
const { getDashscopeBaseUrl } = require('../../../config');

const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 180000;
const MAX_RETRIES_TRANSPORT = 2;

// Node 22+ undici default connect-timeout is 10 s, which is too aggressive for
// DashScope from this Windows / Git Bash dev environment (we observed
// UND_ERR_CONNECT_TIMEOUT in <10 s while curl to the same endpoint succeeded
// in 2 s). Bump it once at module load.
//
// Note: undici is a built-in mechanism in Node 22+ but is NOT exposed as a
// require-able built-in (`node:undici` does not resolve). To customize the
// dispatcher you must add `undici` as an npm dep — install with
// `npm install undici --no-save` for ad-hoc dev, or add it to
// `dependencies` for production builds where the same connect-timeout
// issue might surface in Electron's main process.
//
// The try/catch keeps the orchestrator working at default fetch settings
// when undici isn't installed (production Fast mode has been fine without
// it — Expert mode's longer prompts are where the issue first surfaced).
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({
    connect: { timeout: 30000 },
    // The per-request AbortController (REQUEST_TIMEOUT_MS) is the SINGLE timeout
    // authority. undici's own 90 s headers/body timeouts were firing first on the
    // slow Block E (Pro model, ~12 KB prompt) and surfacing as "fetch failed",
    // which the transport-retry then repeated ~3x (≈279 s of dead time per fixture).
    // 0 disables them, so a slow-but-valid block runs up to REQUEST_TIMEOUT_MS and a
    // genuine overrun aborts once (timedOut → no retry → block fallback).
    headersTimeout: 0,
    bodyTimeout: 0
  }));
} catch (_) { /* undici not installed — fall through to Node's default fetch dispatcher */ }

const FLASH_MODEL = 'deepseek-v4-flash';
const PRO_MODEL = 'deepseek-v4-pro';

const BLOCK_MODELS = {
  A: FLASH_MODEL,
  B: FLASH_MODEL,
  C: FLASH_MODEL,
  D: FLASH_MODEL,
  // EXPERIMENT (latency): E was PRO_MODEL (deep CoT) and dominated the chain at
  // ~255s / 61% of total. Trying FLASH to see the latency↓ vs ranking-quality
  // trade-off. Revert to PRO_MODEL if the top-2 question selection degrades.
  E: FLASH_MODEL,
  F: FLASH_MODEL,
  G: FLASH_MODEL
};

const BLOCK_TEMPERATURES = {
  A: 0.1,
  B: 0.15,
  C: 0.1,
  D: 0.45,
  E: 0.2,
  F: 0.1,
  G: 0.1
};

const BLOCK_MAX_TOKENS = {
  A: 1200,
  B: 1200,
  C: 600,
  D: 1500,
  E: 2000,
  F: 800,
  G: 800
};

// Per-block request timeout. Block E (Pro model on a ~12 KB composed prompt) is
// the slow one and legitimately needs longer before we give up and fall back;
// the rest stay at the default REQUEST_TIMEOUT_MS.
const BLOCK_TIMEOUTS_MS = {
  A: REQUEST_TIMEOUT_MS,
  B: REQUEST_TIMEOUT_MS,
  C: REQUEST_TIMEOUT_MS,
  D: REQUEST_TIMEOUT_MS,
  E: 300000,
  F: REQUEST_TIMEOUT_MS,
  G: REQUEST_TIMEOUT_MS
};

function safeJsonParse(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch (_2) { return null; } }
    return null;
  }
}

// Eval-only transport. Node's built-in fetch (undici) is unreliable against
// DashScope from some Windows / Git-Bash environments (intermittent "fetch
// failed" and multi-minute hangs), while curl to the same endpoint is fast and
// reliable. Setting DASHSCOPE_TRANSPORT=curl (eval scripts only — never the
// production Electron path) routes LLM calls through curl instead. The default
// fetch path below is left completely untouched.
async function curlChat({ apiKey, model, prompt, temperature, maxTokens, timeoutMs }) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFile } = require('child_process');
  const body = { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens };
  if (typeof temperature === 'number') body.temperature = temperature;
  const tmp = path.join(os.tmpdir(), `dsc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(body), 'utf8');
  const maxTime = Math.ceil((timeoutMs || REQUEST_TIMEOUT_MS) / 1000);
  const args = [
    '-sS', '--max-time', String(maxTime),
    '-X', 'POST', `${getDashscopeBaseUrl()}/v1/messages`,
    '-H', 'Content-Type: application/json',
    '-H', `anthropic-version: ${ANTHROPIC_VERSION}`,
    '-H', `x-api-key: ${apiKey}`,
    '--data-binary', `@${tmp}`
  ];
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (err, out, errOut) => {
        if (err) reject(new Error(`curl failed: ${err.message}${errOut ? ` | ${String(errOut).slice(0, 200)}` : ''}`));
        else resolve(out);
      });
    });
    const json = JSON.parse(stdout);
    const blocks = Array.isArray(json?.content) ? json.content : [];
    const text = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
    return { text, usage: json?.usage, modelEcho: json?.model };
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* best-effort cleanup */ }
  }
}

async function dashscopeChat({ apiKey, model, prompt, temperature, maxTokens, abortSignal, timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (process.env.DASHSCOPE_TRANSPORT === 'curl') {
    return curlChat({ apiKey, model, prompt, temperature, maxTokens, timeoutMs });
  }
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens
  };
  if (typeof temperature === 'number') body.temperature = temperature;

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES_TRANSPORT; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    if (abortSignal && typeof abortSignal.addEventListener === 'function') {
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      const resp = await fetch(`${getDashscopeBaseUrl()}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if (resp.status >= 500 || resp.status === 429) {
          lastErr = new Error(`DashScope ${resp.status}: ${text.slice(0, 300)}`);
          await new Promise((r) => setTimeout(r, 1200 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(`DashScope ${resp.status}: ${text.slice(0, 500)}`);
      }
      const json = await resp.json();
      const blocks = Array.isArray(json?.content) ? json.content : [];
      const text = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
      return { text, usage: json?.usage, modelEcho: json?.model };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // A wall-clock timeout won't recover within a retry window — the endpoint is
      // hung for this prompt and retrying just burns another full REQUEST_TIMEOUT_MS
      // (that compounding is what made the 7-block E2E abort at ~3 min). An external
      // abort means the caller gave up. In both cases, stop now and let the block fall
      // back. Only genuinely transient connection drops (undici ECONNRESET, which
      // recovers on a fast retry) are worth retrying.
      if (timedOut || (abortSignal && abortSignal.aborted)) break;
      if (attempt < MAX_RETRIES_TRANSPORT) {
        await new Promise((r) => setTimeout(r, 1200 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr || new Error('DashScope request failed');
}

async function callBlock({ blockId, apiKey, prompt, abortSignal }) {
  const start = Date.now();
  const model = BLOCK_MODELS[blockId];
  const temperature = BLOCK_TEMPERATURES[blockId];
  const maxTokens = BLOCK_MAX_TOKENS[blockId];

  let first;
  try {
    first = await dashscopeChat({ apiKey, model, prompt, temperature, maxTokens, abortSignal, timeoutMs: BLOCK_TIMEOUTS_MS[blockId] });
  } catch (err) {
    // Transport error / timeout-abort on the first attempt. Do NOT throw — that
    // crashes the whole chain. Signal runExpertChain to use this block's fallback
    // synthesizer instead, so one slow/failed block degrades gracefully.
    return {
      ok: false,
      data: null,
      raw: '',
      trace: [{ block: blockId, attempt: 1, ms: Date.now() - start, ok: false, errors: [`transport: ${err.message}`], model, usage: null }],
      threw: err.message
    };
  }
  let parsed = safeJsonParse(first.text);
  let validation = validateBlock(blockId, parsed);
  const trace = [{
    block: blockId,
    attempt: 1,
    ms: Date.now() - start,
    ok: validation.ok,
    errors: validation.errors,
    model,
    usage: first.usage || null
  }];

  if (validation.ok) {
    return { ok: true, data: validation.data, raw: first.text, trace };
  }

  // Single repair pass — paste the validation errors back into the prompt.
  const repairPrompt = `${prompt}

[REPAIR ROUND]
Your previous output failed schema validation with these errors:
${validation.errors.map((e) => `- ${e}`).join('\n')}

Re-emit the JSON object fixing ALL listed errors. Strict JSON only — no markdown, no prose.`;

  const repairStart = Date.now();
  let second;
  try {
    second = await dashscopeChat({ apiKey, model, prompt: repairPrompt, temperature: Math.max(0, temperature - 0.05), maxTokens, abortSignal, timeoutMs: BLOCK_TIMEOUTS_MS[blockId] });
  } catch (err) {
    // Repair attempt failed at transport level — fall back rather than crash.
    trace.push({ block: blockId, attempt: 2, ms: Date.now() - repairStart, ok: false, errors: [`transport: ${err.message}`], model, usage: null, repair: true });
    return { ok: false, data: null, raw: first.text, trace, threw: err.message };
  }
  parsed = safeJsonParse(second.text);
  validation = validateBlock(blockId, parsed);
  trace.push({
    block: blockId,
    attempt: 2,
    ms: Date.now() - repairStart,
    ok: validation.ok,
    errors: validation.errors,
    model,
    usage: second.usage || null,
    repair: true
  });

  return {
    ok: validation.ok,
    data: validation.ok ? validation.data : null,
    raw: second.text,
    trace,
    failed: !validation.ok ? validation.errors : null
  };
}

// ─── Fallback synthesis ─────────────────────────────────────────────────────
// When a block exhausts retries we synthesize a minimal schema-compliant
// fallback so the chain doesn't crash. The fallback is intentionally
// pessimistic — it should produce a "no follow-up worth showing" outcome
// rather than a confidently wrong one.

function blockAFallback() {
  return {
    claims: [],
    star_coverage: { S: false, T: false, A: false, R: false },
    answer_quality_label: 'mixed',
    language_register: 'professional'
  };
}
function blockBFallback() {
  return { missing_evidence: [], overclaim_flags: [], contradictions: [] };
}
function blockCFallback(sessionState) {
  return {
    topic_just_drilled: '(unknown)',
    next_competency_target: 'technical-depth',
    depth_remaining_on_current_topic: 'one-more',
    should_pivot: false,
    drilled_topics_after: (sessionState?.drilled_topics || []).map((t) => ({ topic: typeof t === 'string' ? t : t?.topic || '(unknown)', depth: 1 }))
  };
}
function blockDFallback() {
  // Five generic candidates with distinct types so the schema validator passes.
  // Block E will score these low and Block G's rationale will note the fallback.
  return {
    candidates: [
      { id: 'q1', question: "Could you 'walk me through' the specific step you owned end-to-end here?", question_type: 'action-attribution', anchors: ['walk me through'], fills_evidence_gap: 'owner-of-action', expected_yield: 'a verb the candidate personally executed' },
      { id: 'q2', question: "What was the 'specific number' you measured — even an order-of-magnitude — for the result you described?", question_type: 'metric-pin', anchors: ['specific number'], fills_evidence_gap: 'metric', expected_yield: 'a number with units' },
      { id: 'q3', question: "Which 'named tool or library' was load-bearing for this — not the category, the actual name?", question_type: 'named-entity-pin', anchors: ['named tool or library'], fills_evidence_gap: 'named-tool', expected_yield: 'a tool name' },
      { id: 'q4', question: "What would have happened if the 'opposite tradeoff' had been chosen?", question_type: 'counterfactual', anchors: ['opposite tradeoff'], fills_evidence_gap: 'tradeoff-reasoning', expected_yield: 'an articulated counterfactual' },
      { id: 'q5', question: "Walk me through the 'decision chain' — what did you choose NOT to do, and why?", question_type: 'chain-of-decisions', anchors: ['decision chain'], fills_evidence_gap: 'tradeoff-reasoning', expected_yield: 'a sequence of rejected alternatives' }
    ]
  };
}
function blockEFallback(blockDResult) {
  const cands = blockDResult?.candidates || [];
  const ranked = cands.map((c) => ({
    id: c.id,
    rubric: { evidence_value: 3, specificity: 3, non_redundancy: 3, interviewer_usability: 3, risk_of_dodge_inverse: 3, expected_signal_density: 3 },
    total: 18,
    reasoning: 'Fallback ranking — Block E LLM did not converge. All candidates scored neutrally.'
  }));
  return {
    ranked,
    top_2_ids: ranked.length >= 2 ? [ranked[0].id, ranked[1].id] : ranked.length === 1 ? [ranked[0].id, ranked[0].id] : ['q1', 'q2']
  };
}
function blockFFallback() {
  return { verdict: 'pass', violations: [], regex_hits: [], soft_rule_findings: [] };
}
function blockGFallback({ primary, alternative }) {
  return {
    primary_question: primary?.question || '(no question available — Expert mode fallback)',
    alternative_question: alternative?.question || '',
    rationale_for_interviewer: 'Expert mode produced no high-confidence question. Consider the Fast-mode suggestion or drill on the most recent metric the candidate quoted.',
    anchor_quotes: primary?.anchors || [],
    expected_evidence_yield: primary?.expected_yield || '',
    iteration_version: EXPERT_ITERATION_VERSION
  };
}

// ─── Orchestrator main entry ────────────────────────────────────────────────

async function runExpertChain({
  apiKey,
  candidateAnswer,
  resumeChunk = '',
  jobDescription = '',
  questionHistory = [],
  sessionState = null,
  abortSignal = null,
  // Block H — optional callback invoked (off the critical path) once session
  // consolidation resolves. Receives the updated session-state object. Provided
  // in addition to result.sessionStatePromise so callers can either await the
  // promise or react via callback, whichever is cleaner. See the integration
  // note in interviewer-runtime.js for how the runtime persists it.
  onSessionState = null,
  // Optional per-phase progress callback. Invoked with
  // { phase, index, total, status } at each of the 6 user-visible phase
  // boundaries (status: 'start' | 'done'). Best-effort and never allowed to
  // throw into the chain — see emitProgress below.
  onProgress = null
} = {}) {
  if (!apiKey) {
    throw new Error('Expert mode requires DashScope API key');
  }
  const startedAt = Date.now();
  const traces = [];
  const fallbackTriggered = [];

  const TOTAL_PHASES = 6;
  const PHASE_INDEX = { answer: 1, gaps: 2, pool: 3, rank: 4, safety: 5, render: 6 };
  // Sum input/output token usage across one or more block results' traces.
  // Used to report per-phase token spend on the 'done' progress event.
  function traceTokens(...results) {
    let input = 0;
    let output = 0;
    for (const result of results) {
      for (const e of (result?.trace || [])) {
        if (e && e.usage) {
          input += Number(e.usage.input_tokens) || 0;
          output += Number(e.usage.output_tokens) || 0;
        }
      }
    }
    return { input, output };
  }
  // Progress callback must NEVER throw into the chain — a broken UI callback
  // can't be allowed to fail a generation. Wrapped here once. `tokens` (on
  // 'done' events) is the { input, output } spend for the phase just finished.
  function emitProgress(phase, status, tokens = null) {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ phase, index: PHASE_INDEX[phase], total: TOTAL_PHASES, status, tokens });
    } catch (_) { /* progress is best-effort; swallow */ }
  }

  // A ∥ C — parallel
  emitProgress('answer', 'start');
  const aPromise = callBlock({
    blockId: 'A',
    apiKey,
    prompt: buildBlockA({ candidateAnswer, resumeChunk, questionHistory, sessionState }),
    abortSignal
  });
  const cPromise = callBlock({
    blockId: 'C',
    apiKey,
    prompt: buildBlockC({ candidateAnswer, questionHistory, sessionState, jobDescription }),
    abortSignal
  });
  const [aResult, cResult] = await Promise.all([aPromise, cPromise]);
  traces.push(...aResult.trace, ...cResult.trace);
  emitProgress('answer', 'done', traceTokens(aResult, cResult));

  const blockA = aResult.ok ? aResult.data : blockAFallback();
  if (!aResult.ok) fallbackTriggered.push('A');
  const blockC = cResult.ok ? cResult.data : blockCFallback(sessionState);
  if (!cResult.ok) fallbackTriggered.push('C');

  // B — depends on A
  emitProgress('gaps', 'start');
  const bResult = await callBlock({
    blockId: 'B',
    apiKey,
    prompt: buildBlockB({ blockAResult: blockA, candidateAnswer, resumeChunk, jobDescription, questionHistory, sessionState }),
    abortSignal
  });
  traces.push(...bResult.trace);
  const blockB = bResult.ok ? bResult.data : blockBFallback();
  if (!bResult.ok) fallbackTriggered.push('B');
  emitProgress('gaps', 'done', traceTokens(bResult));

  // D — depends on A, B, C
  emitProgress('pool', 'start');
  const dResult = await callBlock({
    blockId: 'D',
    apiKey,
    prompt: buildBlockD({
      blockAResult: blockA,
      blockBResult: blockB,
      blockCResult: blockC,
      candidateAnswer,
      resumeChunk,
      jobDescription,
      questionHistory
    }),
    abortSignal
  });
  traces.push(...dResult.trace);
  const blockD = dResult.ok ? dResult.data : blockDFallback();
  if (!dResult.ok) fallbackTriggered.push('D');
  emitProgress('pool', 'done', traceTokens(dResult));

  // E — depends on D, B, C
  emitProgress('rank', 'start');
  const eResult = await callBlock({
    blockId: 'E',
    apiKey,
    prompt: buildBlockE({
      blockAResult: blockA,
      blockBResult: blockB,
      blockCResult: blockC,
      blockDResult: blockD,
      candidateAnswer,
      resumeChunk,
      jobDescription,
      questionHistory
    }),
    abortSignal
  });
  traces.push(...eResult.trace);
  const blockE = eResult.ok ? eResult.data : blockEFallback(blockD);
  if (!eResult.ok) fallbackTriggered.push('E');
  emitProgress('rank', 'done', traceTokens(eResult));

  // Resolve primary + alternative candidates from E's top_2_ids ∩ D.candidates
  const candById = new Map((blockD.candidates || []).map((c) => [c.id, c]));
  const top2 = Array.isArray(blockE.top_2_ids) ? blockE.top_2_ids : [];
  const primary = candById.get(top2[0]) || (blockD.candidates || [])[0] || null;
  const alternative = candById.get(top2[1]) || (blockD.candidates || [])[1] || null;

  // F — safety audit on top-2
  const regexHits = [
    ...runHardRules(primary?.question || ''),
    ...runHardRules(alternative?.question || '')
  ];

  emitProgress('safety', 'start');
  const fResult = await callBlock({
    blockId: 'F',
    apiKey,
    prompt: buildBlockF({
      candidateQuestions: [primary, alternative].filter(Boolean),
      regexHits,
      jobDescription
    }),
    abortSignal
  });
  traces.push(...fResult.trace);
  const blockF = fResult.ok ? fResult.data : blockFFallback();
  if (!fResult.ok) fallbackTriggered.push('F');
  emitProgress('safety', 'done', traceTokens(fResult));

  // If safety verdict is block, swap to alternative; if alternative also fails
  // (e.g. both contain a hard regex hit), G enters fallback.
  let chosenPrimary = primary;
  let chosenAlt = alternative;
  if (blockF.verdict === 'block') {
    // Try alternative as the new primary if it didn't trigger a block rule
    const altRegex = runHardRules(alternative?.question || '');
    const altRulesBlocked = altRegex.some((h) => ['personal-protected-attr', 'harassment', 'legally-sensitive'].includes(h.rule));
    if (alternative && !altRulesBlocked) {
      chosenPrimary = alternative;
      chosenAlt = null;
    } else {
      chosenPrimary = null;
      chosenAlt = null;
    }
  }

  // G — final render
  let blockG;
  let gTokens = { input: 0, output: 0 };
  emitProgress('render', 'start');
  if (!chosenPrimary) {
    blockG = blockGFallback({ primary: null, alternative: null });
    fallbackTriggered.push('G');
  } else {
    const gResult = await callBlock({
      blockId: 'G',
      apiKey,
      prompt: buildBlockG({
        primaryCandidate: chosenPrimary,
        alternativeCandidate: chosenAlt,
        blockBResult: blockB,
        blockCResult: blockC,
        safetyVerdict: blockF.verdict,
        candidateAnswer,
        resumeChunk
      }),
      abortSignal
    });
    traces.push(...gResult.trace);
    blockG = gResult.ok ? gResult.data : blockGFallback({ primary: chosenPrimary, alternative: chosenAlt });
    if (!gResult.ok) fallbackTriggered.push('G');
    gTokens = traceTokens(gResult);
  }
  emitProgress('render', 'done', gTokens);

  // ─── Block H — auto context consolidation (NON-BLOCKING) ──────────────────
  // The follow-up question (blockG) is already finalized above. We now fold the
  // just-finished round into a persistent session state for the NEXT turn's
  // Block C — but we must NOT add latency to returning blockG to the renderer.
  // So we kick off consolidateSessionState() WITHOUT awaiting it, attach the
  // promise to the result as `sessionStatePromise`, and (if provided) invoke
  // `onSessionState` when it resolves. consolidateSessionState NEVER throws —
  // it resolves to the (normalized) prior state on any failure — so the
  // .then/.catch here is belt-and-suspenders only.
  //
  // Lazy require breaks the require cycle: session-consolidator.js requires this
  // module at its top level, so importing it lazily here (after this module has
  // finished initializing) avoids a partial-exports circular load.
  const renderedQuestion = blockG?.primary_question || '';
  let sessionStatePromise = Promise.resolve(sessionState);
  try {
    const { consolidateSessionState } = require('./session-consolidator');
    sessionStatePromise = consolidateSessionState({
      apiKey,
      priorState: sessionState,
      candidateAnswer,
      renderedQuestion,
      resumeChunk,
      jobDescription,
      questionHistory
    });
  } catch (err) {
    // Failure to even start consolidation (e.g. module load error) must not
    // affect the returned question. Fall back to the prior state.
    console.error('Block H failed to start; keeping prior session state:', err?.message || err);
  }

  if (typeof onSessionState === 'function') {
    sessionStatePromise
      .then((nextState) => { try { onSessionState(nextState); } catch (_) { /* caller's handler error must not surface */ } })
      .catch(() => { /* consolidateSessionState never rejects; defensive only */ });
  }

  return {
    iterationVersion: EXPERT_ITERATION_VERSION,
    output: blockG,
    blocks: { A: blockA, B: blockB, C: blockC, D: blockD, E: blockE, F: blockF, G: blockG },
    trace: traces,
    fallbackTriggered,
    elapsedMs: Date.now() - startedAt,
    // Resolves (never rejects) with the consolidated interviewerSessionState for
    // the next turn. The caller should persist it via app-state + emit
    // `session-context-updated` to the renderer (see interviewer-runtime.js).
    sessionStatePromise
  };
}

module.exports = {
  runExpertChain,
  EXPERT_ITERATION_VERSION,
  BLOCK_MODELS,
  // Exported for reuse by Block H (session-consolidator.js) so it shares this
  // module's DashScope transport, connect-timeout dispatcher tweak, curl escape
  // hatch, safe-JSON parser, and Flash model id rather than re-implementing them.
  dashscopeChat,
  safeJsonParse,
  FLASH_MODEL
};
