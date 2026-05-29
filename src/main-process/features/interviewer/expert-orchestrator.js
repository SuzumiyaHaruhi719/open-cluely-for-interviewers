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
  E: PRO_MODEL,
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

function safeJsonParse(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch (_2) { return null; } }
    return null;
  }
}

async function dashscopeChat({ apiKey, model, prompt, temperature, maxTokens, abortSignal }) {
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
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
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

  const first = await dashscopeChat({ apiKey, model, prompt, temperature, maxTokens, abortSignal });
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
  const second = await dashscopeChat({ apiKey, model, prompt: repairPrompt, temperature: Math.max(0, temperature - 0.05), maxTokens, abortSignal });
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
  abortSignal = null
} = {}) {
  if (!apiKey) {
    throw new Error('Expert mode requires DashScope API key');
  }
  const startedAt = Date.now();
  const traces = [];
  const fallbackTriggered = [];

  // A ∥ C — parallel
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

  const blockA = aResult.ok ? aResult.data : blockAFallback();
  if (!aResult.ok) fallbackTriggered.push('A');
  const blockC = cResult.ok ? cResult.data : blockCFallback(sessionState);
  if (!cResult.ok) fallbackTriggered.push('C');

  // B — depends on A
  const bResult = await callBlock({
    blockId: 'B',
    apiKey,
    prompt: buildBlockB({ blockAResult: blockA, candidateAnswer, resumeChunk, jobDescription, questionHistory, sessionState }),
    abortSignal
  });
  traces.push(...bResult.trace);
  const blockB = bResult.ok ? bResult.data : blockBFallback();
  if (!bResult.ok) fallbackTriggered.push('B');

  // D — depends on A, B, C
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

  // E — depends on D, B, C
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
  }

  return {
    iterationVersion: EXPERT_ITERATION_VERSION,
    output: blockG,
    blocks: { A: blockA, B: blockB, C: blockC, D: blockD, E: blockE, F: blockF, G: blockG },
    trace: traces,
    fallbackTriggered,
    elapsedMs: Date.now() - startedAt
  };
}

module.exports = {
  runExpertChain,
  EXPERT_ITERATION_VERSION,
  BLOCK_MODELS
};
