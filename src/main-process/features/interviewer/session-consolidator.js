// ============================================================================
// Expert-mode Block H · Session-state consolidation
// ----------------------------------------------------------------------------
// Runs AFTER the Expert chain has rendered its final follow-up question (so it
// is OFF the critical path — see expert-orchestrator.js runExpertChain). It
// summarizes the just-finished Q/A round and folds it into a persistent
// `interviewerSessionState` that the NEXT answer's Block C consumes
// (block-c-state-update.js). This closes the loop the Expert design intended:
// without it, Block C always sees a default/empty state.
//
// Shape of the returned (and persisted) state object:
//   {
//     drilled_topics:            string[],   // topics already probed
//     competencies_covered:      string[],   // COMPETENCIES with real evidence
//     open_gaps:                 string[],   // evidence still missing / to chase
//     candidate_profile_summary: string,     // running 2-4 sentence profile
//     asked_questions:           string[]    // verbatim questions already asked
//   }
//
// Design rules (mirrors the rest of the orchestrator):
//   - Flash model (cheap; this is summarization, not reasoning).
//   - Strict-JSON prompt; safe-parse with fenced/loose recovery.
//   - NEVER throws. Any failure (transport, timeout, bad JSON, bad shape)
//     returns the normalized `priorState` unchanged so the caller can persist
//     a stable value and the next turn degrades to "no new consolidation".
//
// Transport: reuses the exact DashScope Anthropic-shape Messages call,
// connect-timeout dispatcher tweak, curl escape hatch, and safe-JSON helper
// from expert-orchestrator.js (imported below to stay DRY — that module sets
// the global undici dispatcher on load, so importing it also applies the
// connect-timeout fix here).
// ============================================================================

const { dashscopeChat, safeJsonParse, FLASH_MODEL } = require('./expert-orchestrator');

// Block H is summarization on a small prompt — it does not need Block E's long
// budget. Keep it deterministic-ish so the running profile stays stable.
const BLOCK_H_TEMPERATURE = 0.1;
const BLOCK_H_MAX_TOKENS = 900;
const BLOCK_H_TIMEOUT_MS = 60000;

// Hard caps so the state object can't grow unbounded across a long interview
// (it is re-fed into every subsequent Block C prompt — unbounded growth would
// blow the context budget and slow every turn).
const MAX_DRILLED_TOPICS = 40;
const MAX_COMPETENCIES = 24;
const MAX_OPEN_GAPS = 24;
const MAX_ASKED_QUESTIONS = 60;
const MAX_PROFILE_CHARS = 1200;

function uniqueStrings(value, limit) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    // Block A/C sometimes emit topic objects ({ topic, depth }); accept those.
    const str = typeof entry === 'string'
      ? entry
      : (entry && typeof entry === 'object' && typeof entry.topic === 'string' ? entry.topic : '');
    const trimmed = str.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

// Coerce ANY input (prior state, LLM output, partial object) into the canonical
// five-field shape with capped arrays. Used both to normalize `priorState`
// before prompting and to sanitize the model's response.
function normalizeSessionState(candidate) {
  const src = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const profileRaw = typeof src.candidate_profile_summary === 'string' ? src.candidate_profile_summary.trim() : '';
  return {
    drilled_topics: uniqueStrings(src.drilled_topics, MAX_DRILLED_TOPICS),
    competencies_covered: uniqueStrings(src.competencies_covered, MAX_COMPETENCIES),
    open_gaps: uniqueStrings(src.open_gaps, MAX_OPEN_GAPS),
    candidate_profile_summary: profileRaw.slice(0, MAX_PROFILE_CHARS),
    asked_questions: uniqueStrings(src.asked_questions, MAX_ASKED_QUESTIONS)
  };
}

function emptySessionState() {
  return {
    drilled_topics: [],
    competencies_covered: [],
    open_gaps: [],
    candidate_profile_summary: '',
    asked_questions: []
  };
}

function buildConsolidationPrompt({ priorState, candidateAnswer, renderedQuestion, resumeChunk, jobDescription, questionHistory }) {
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).filter((line) => line.trim().length > 3).join('\n')
    : '(no prior questions)';

  return `Role: You are BLOCK H — the SESSION CONSOLIDATOR. A single interview Q/A round just finished. Fold it into the running interview state. You are a careful note-taker, NOT a question generator. Output is internal state, never shown to the candidate.

[Prior session state — the running record BEFORE this round]
\`\`\`json
${JSON.stringify(priorState, null, 2)}
\`\`\`

[Job description — defines which competencies matter]
\`\`\`
${jobDescription || '(no JD)'}
\`\`\`

[Resume excerpt]
\`\`\`
${resumeChunk || '(no resume excerpt)'}
\`\`\`

[Prior questions asked, oldest first]
${history}

[The follow-up question the interviewer just asked this round]
\`\`\`
${renderedQuestion || '(no question was rendered this round)'}
\`\`\`

[The candidate's answer that prompted it]
\`\`\`
${candidateAnswer || '(no answer captured)'}
\`\`\`

Required output — STRICT JSON only. No markdown fences, no prose, no comments.
{
  "drilled_topics": ["<every distinct topic probed so far, prior + this round, short labels e.g. 'payment migration latency'>"],
  "competencies_covered": ["<competencies for which the candidate has now given REAL evidence; use only: technical-depth, communication, ownership, leadership, collaboration, judgement-tradeoffs, numbers-fluency, failure-handling, motivation, role-fit, culture-fit, integrity>"],
  "open_gaps": ["<evidence still MISSING or only weakly supported that a future question should chase — short phrases, e.g. 'no concrete QPS number', 'ownership vs team unclear'>"],
  "candidate_profile_summary": "<2-4 sentence running profile of the candidate's demonstrated strengths and weak spots, UPDATED with this round. Keep it factual and anchored to what was actually said.>",
  "asked_questions": ["<every follow-up question already asked, prior + this round, verbatim — used downstream to avoid repeats>"]
}

Merge rules — accumulate, do not reset:
1. Carry forward EVERY entry from prior state. Add this round's new topic(s), gaps closed/opened, and the question just asked. Never drop prior history.
2. If this round CLOSED a prior open_gap (the candidate finally gave the number / named the tool / clarified ownership), remove it from open_gaps. If it opened a NEW gap, add it.
3. Move a competency into competencies_covered ONLY when there is concrete, anchored evidence — not merely because the topic was raised.
4. candidate_profile_summary is cumulative: refine the prior summary with this round's signal; do not rewrite from scratch and do not let it exceed ~4 sentences.
5. asked_questions must include the question from "[The follow-up question the interviewer just asked this round]" verbatim, plus all prior questions. De-duplicate exact repeats.
6. Use ONLY the listed competency labels. Drop anything that doesn't match.

Emit only the JSON object.`;
}

/**
 * Block H — consolidate one finished Q/A round into the persistent session state.
 * NEVER throws: on missing key, transport failure, or unparseable/invalid output
 * it returns the normalized `priorState` (so persistence stays stable).
 *
 * @param {Object} args
 * @param {string} args.apiKey            DashScope API key.
 * @param {Object|null} args.priorState   Existing interviewerSessionState (any shape; normalized internally).
 * @param {string} args.candidateAnswer   The answer that triggered this round.
 * @param {string} args.renderedQuestion  The follow-up question Block G produced (primary_question).
 * @param {string} [args.resumeChunk]
 * @param {string} [args.jobDescription]
 * @param {Array}  [args.questionHistory]
 * @returns {Promise<{drilled_topics:string[], competencies_covered:string[], open_gaps:string[], candidate_profile_summary:string, asked_questions:string[]}>}
 */
async function consolidateSessionState({
  apiKey,
  priorState = null,
  candidateAnswer = '',
  renderedQuestion = '',
  resumeChunk = '',
  jobDescription = '',
  questionHistory = []
} = {}) {
  const normalizedPrior = normalizeSessionState(priorState);

  // No key → cannot consolidate; hand back the stable prior state untouched.
  if (!apiKey || !String(apiKey).trim()) {
    return normalizedPrior;
  }

  const prompt = buildConsolidationPrompt({
    priorState: normalizedPrior,
    candidateAnswer,
    renderedQuestion,
    resumeChunk,
    jobDescription,
    questionHistory
  });

  let text = '';
  try {
    const result = await dashscopeChat({
      apiKey,
      model: FLASH_MODEL,
      prompt,
      temperature: BLOCK_H_TEMPERATURE,
      maxTokens: BLOCK_H_MAX_TOKENS,
      timeoutMs: BLOCK_H_TIMEOUT_MS
    });
    text = result?.text || '';
  } catch (error) {
    // Transport / timeout / abort — keep the prior state so the caller persists
    // a stable value and the next turn just lacks this round's consolidation.
    console.error('Block H consolidation transport failed; keeping prior session state:', error?.message || error);
    return normalizedPrior;
  }

  const parsed = safeJsonParse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('Block H consolidation produced unparseable JSON; keeping prior session state');
    return normalizedPrior;
  }

  const next = normalizeSessionState(parsed);

  // Defensive monotonicity: the model is told to accumulate, but if it returned
  // a degenerate empty object we keep the richer prior state rather than wiping
  // hard-won history. A genuinely-richer update always wins.
  if (
    next.drilled_topics.length === 0 &&
    next.competencies_covered.length === 0 &&
    next.open_gaps.length === 0 &&
    next.asked_questions.length === 0 &&
    !next.candidate_profile_summary
  ) {
    return normalizedPrior;
  }

  return next;
}

module.exports = {
  consolidateSessionState,
  normalizeSessionState,
  emptySessionState
};
