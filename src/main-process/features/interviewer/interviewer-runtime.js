// ============================================================================
// Interviewer copilot runtime
// ----------------------------------------------------------------------------
// Stage 1 (hook detection) + Stage 2 (follow-up generation) for the
// interviewer-side coach. Calls DashScope's Anthropic-shape Messages endpoint
// with the configured interviewer model (deepseek-v4-flash by default).
//
// Why Anthropic-shape? DashScope routes V4 / qwen3.6-max-preview / qwen3.7-max
// through `/apps/anthropic` only; `/compatible-mode/v1` still tops out at v3.2
// as of May 2026. Same DashScope key, same models the rest of the app uses.
// ============================================================================

const {
  buildHookDetectionPrompt,
  buildFollowUpQuestionPrompt,
  ITERATION_VERSION
} = require('../../../services/ai/interviewer-prompts');
const {
  getDashscopeBaseUrl,
  getDefaultInterviewerModel
} = require('../../../config');
const { runExpertChain, EXPERT_ITERATION_VERSION } = require('./expert-orchestrator');
const { logExpertRun } = require('./expert-run-logger');

const STAGE1_TRIGGER_SCORE = 4;
const MIN_ANSWER_CHARS = 12;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;
const ANTHROPIC_VERSION = '2023-06-01';

function safeJsonParse(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_2) { return null; }
    }
    return null;
  }
}

// Anthropic-shape Messages call. The prompt builders ask the model to emit
// JSON; we don't pass `response_format` because the Anthropic protocol has
// no equivalent — `safeJsonParse` handles fenced/loose JSON in the text.
async function dashscopeChat({ apiKey, model, prompt, system, temperature, maxTokens }) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens
  };
  if (system) body.system = system;
  if (typeof temperature === 'number') body.temperature = temperature;

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
          await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(`DashScope ${resp.status}: ${text.slice(0, 500)}`);
      }

      const json = await resp.json();
      const blocks = Array.isArray(json?.content) ? json.content : [];
      const text = blocks
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
      return { text, usage: json?.usage, model: json?.model };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr || new Error('DashScope request failed');
}

// `saveSessionState` and `sendToRenderer` are OPTIONAL collaborators. When
// start-application.js wires them in, Block H's consolidated state is persisted
// to disk and pushed to the renderer; when omitted (current call site), the
// runtime still updates the in-memory appState so the next turn's Block C sees
// it — it just isn't durable across app restarts. This keeps the existing
// `createInterviewerRuntime({ getAppState })` call working unchanged.
function createInterviewerRuntime({ getAppState, saveSessionState = null, sendToRenderer = null }) {
  // Durable persistence of Block H output. No-op unless start-application.js
  // passes saveSessionState (see INTEGRATION NOTE in analyzeCandidateAnswerExpert).
  function persistSessionState(nextState) {
    if (typeof saveSessionState !== 'function') return;
    try {
      saveSessionState(nextState);
    } catch (error) {
      console.error('Failed to persist interviewerSessionState:', error?.message || error);
    }
  }

  // Renderer notification so the right-rail "Session context (auto)" panel can
  // refresh. No-op unless start-application.js passes sendToRenderer.
  function notifySessionContextUpdated(nextState) {
    if (typeof sendToRenderer !== 'function') return;
    try {
      sendToRenderer('session-context-updated', nextState);
    } catch (error) {
      console.error('Failed to emit session-context-updated:', error?.message || error);
    }
  }

  function getApiKey() {
    const state = getAppState() || {};
    return String(state.dashscopeApiKey || '').trim();
  }

  function getMode() {
    const state = getAppState() || {};
    return state.interviewerMode === 'expert' ? 'expert' : 'fast';
  }

  function getContext() {
    const state = getAppState() || {};
    return {
      resumeChunk: typeof state.resumeText === 'string' ? state.resumeText : '',
      jobDescription: typeof state.jobDescription === 'string' ? state.jobDescription : ''
    };
  }

  async function detectHooks(input) {
    const prompt = buildHookDetectionPrompt(input);
    const { text, usage } = await dashscopeChat({
      apiKey: getApiKey(),
      model: getDefaultInterviewerModel(),
      prompt,
      temperature: 0.15,
      maxTokens: 600
    });
    return { raw: text, usage, parsed: safeJsonParse(text) };
  }

  async function generateFollowUps(input) {
    const prompt = buildFollowUpQuestionPrompt(input);
    const { text, usage } = await dashscopeChat({
      apiKey: getApiKey(),
      model: getDefaultInterviewerModel(),
      prompt,
      temperature: 0.4,
      maxTokens: 800
    });
    return { raw: text, usage, parsed: safeJsonParse(text) };
  }

  async function analyzeCandidateAnswerExpert({ candidateAnswer, questionHistory, emotion, requestId = null }) {
    const apiKey = getApiKey();
    const { resumeChunk, jobDescription } = getContext();
    const state = getAppState() || {};
    // Block C input: the persisted consolidation from the PREVIOUS turn's
    // Block H (app-state.interviewerSessionState). On the first turn this is
    // null and Block C falls back to its default — which is exactly the loop
    // Block H closes on subsequent turns.
    const sessionState = state.interviewerSessionState || null;
    try {
      const expertResult = await runExpertChain({
        apiKey,
        candidateAnswer,
        resumeChunk,
        jobDescription,
        questionHistory,
        sessionState,
        // Block H persistence — invoked OFF the critical path once consolidation
        // resolves (never throws). We mutate the live app-state object in place
        // so the NEXT turn's `getAppState().interviewerSessionState` (read above)
        // sees the consolidated value within this app session.
        //
        // INTEGRATION NOTE (for start-application.js / orchestrator owner):
        // This only updates the IN-MEMORY appState reference. For durable
        // disk persistence and to notify the renderer, the runtime needs two
        // collaborators passed into createInterviewerRuntime():
        //   1. saveSessionState(nextState)  → saveAppState(app, { interviewerSessionState: nextState })
        //   2. sendToRenderer('session-context-updated', nextState)
        // Both are out of scope for this slice (start-application.js is owned
        // elsewhere). See the report's INTEGRATION NOTE for exact wiring.
        onSessionState: (nextState) => {
          if (nextState && typeof nextState === 'object') {
            const liveState = getAppState();
            if (liveState && typeof liveState === 'object') {
              liveState.interviewerSessionState = nextState;
            }
            persistSessionState(nextState);
            notifySessionContextUpdated(nextState);
          }
        },
        // Forward per-phase progress to the renderer so the chat-stream progress
        // card can advance. No-op unless sendToRenderer is wired (it is — see
        // start-application.js). requestId correlates the events to the card that
        // started this analysis.
        onProgress: (evt) => {
          if (typeof sendToRenderer !== 'function') return;
          try {
            sendToRenderer('interviewer-progress', { requestId, ...evt });
          } catch (error) {
            console.error('Failed to emit interviewer-progress:', error?.message || error);
          }
        }
      });
      // Per-run debug log: each block's model, purpose, duration, ok/fallback,
      // attempts, token usage. Console summary + logs/generate-q.jsonl. Wrapped
      // so logging can never affect the returned result.
      try {
        logExpertRun({
          requestId,
          trace: expertResult.trace,
          fallbackTriggered: expertResult.fallbackTriggered,
          elapsedMs: expertResult.elapsedMs
        });
      } catch (_) { /* logging is best-effort */ }
      return {
        mode: 'expert',
        requestId,
        iterationVersion: expertResult.iterationVersion,
        output: expertResult.output,
        blocks: expertResult.blocks,
        trace: expertResult.trace,
        fallbackTriggered: expertResult.fallbackTriggered,
        elapsedMs: expertResult.elapsedMs,
        emotion,
        shouldShowFollowUps: Boolean(expertResult.output?.primary_question && !String(expertResult.output.primary_question).startsWith('(no question'))
      };
    } catch (error) {
      console.error('Expert mode failed, returning skipped result:', error);
      return { mode: 'expert', skipped: true, requestId, reason: `expert-chain-error: ${error?.message || 'unknown'}` };
    }
  }

  async function analyzeCandidateAnswer({ candidateAnswer, questionHistory = [], emotion = null, requestId = null } = {}) {
    const answer = String(candidateAnswer || '').trim();
    if (!answer) {
      return { skipped: true, reason: 'empty-answer' };
    }
    if (answer.length < MIN_ANSWER_CHARS) {
      return { skipped: true, reason: 'answer-too-short' };
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return { skipped: true, reason: 'no-dashscope-key' };
    }

    if (getMode() === 'expert') {
      return analyzeCandidateAnswerExpert({ candidateAnswer: answer, questionHistory, emotion, requestId });
    }

    const { resumeChunk, jobDescription } = getContext();

    const stage1 = await detectHooks({
      jobDescription,
      resumeChunk,
      candidateAnswer: answer,
      questionHistory,
      candidateEmotion: emotion
    });

    const parsed = stage1.parsed || {};
    const score = Number.parseInt(String(parsed.score ?? 0), 10) || 0;
    const pivotSignal = parsed.pivot_signal === true;

    const result = {
      iterationVersion: ITERATION_VERSION,
      stage1: {
        raw: stage1.raw,
        parsed,
        usage: stage1.usage
      },
      stage2: null,
      shouldShowFollowUps: false
    };

    if (score >= STAGE1_TRIGGER_SCORE && !pivotSignal) {
      const stage2 = await generateFollowUps({
        jobDescription,
        resumeChunk,
        candidateAnswer: answer,
        questionHistory,
        concreteHooks: Array.isArray(parsed.concrete_hooks) ? parsed.concrete_hooks : [],
        missingStar: parsed.missing_star_element || 'none',
        recommendedDirection: parsed.recommended_direction || 'technical-depth',
        candidateEmotion: emotion
      });

      result.stage2 = {
        raw: stage2.raw,
        parsed: stage2.parsed,
        usage: stage2.usage
      };
      result.shouldShowFollowUps = Boolean(stage2.parsed?.questions?.length);
    }

    return result;
  }

  return {
    analyzeCandidateAnswer,
    isConfigured: () => getApiKey().length > 0,
    getMode,
    getFastIterationVersion: () => ITERATION_VERSION,
    getExpertIterationVersion: () => EXPERT_ITERATION_VERSION
  };
}

module.exports = {
  createInterviewerRuntime,
  STAGE1_TRIGGER_SCORE
};
