// ============================================================================
// INTERVIEWER COPILOT - Champion prompt chain (iter_007 + iter_008 verification)
// ============================================================================
// Three-stage prompt chain for interviewer-side deep-dive coaching:
//   Stage 1 (hook detection): runs after every candidate answer
//   Stage 2 (follow-up generator): runs when Stage 1 score >= 4 AND pivot_signal=false
//   Stage 3 (fresh-topic suggester): runs when pivot_signal=true
//
// Champion stack came out of 8 iterations × 10 self-play sims, scored on:
//   hit_rate, depth_hit_rate, STAR coverage, info density, follow-up quality.
// Champion: iter_007 with iter_008's Stage-2 self-verification step added.
// See FINAL_REPORT.md in the Obsidian "Interview Copilot" folder for details.
// ============================================================================

const ITERATION_VERSION = 'champion_iter_007+verify';

function safe(text, fallback = '(none)') {
  const s = typeof text === 'string' ? text.trim() : '';
  return s ? s : fallback;
}

// ─── STAGE 1 ─────────────────────────────────────────────────────────────────
function buildHookDetectionPrompt({
  jobDescription = '',
  resumeChunk = '',
  candidateAnswer = '',
  questionHistory = []
} = {}) {
  const history = Array.isArray(questionHistory)
    ? questionHistory.map((q, i) => `${i + 1}. ${q}`).join('\n')
    : String(questionHistory || '');

  return `You are a senior interview coach watching a live interview. The interviewer just heard a candidate's answer. Decide whether the copilot should push a follow-up drill question now, or signal the interviewer to switch topics on their next question.

[Job Description]
${safe(jobDescription, '(no JD provided)')}

[Relevant resume excerpt]
${safe(resumeChunk, '(no resume excerpt)')}

[Candidate's most recent answer]
${safe(candidateAnswer, '(empty answer)')}

[Questions already asked, oldest first]
${safe(history, '(none yet)')}

Pivot policy — apply this rule and ONLY this rule for pivot_signal:
  pivot_signal = true IF AND ONLY IF you can name at least two of the immediately-preceding questions that were follow-ups on the SAME topic as the current answer.
  Do NOT set pivot_signal=true based on answer quality or score.

Depth scoring: 5=major signal, 4=clear value, 3=optional, 1-2=exhausted.

concrete_hooks: 3-8 word near-verbatim spans FROM THE CANDIDATE'S ANSWER (not the resume).

risk_signals — be aggressive about detecting these:
  - vague-metric: 'significantly', 'a lot', 'quite a bit', 'much faster', 'really big improvement', 'roughly'
  - pronoun-shift: candidate says 'we' for work the resume attributes to 'I'
  - resume-overclaim: candidate's verbal answer is weaker/vaguer than the resume bullet on the same project
  - contradiction: candidate's facts contradict the resume or a prior answer

When you detect a risk_signal, ALWAYS include the candidate's exact vague phrase (3-8 words) as one of the concrete_hooks. Stage 2 will quote it to pin.

topic_label: project + claim, 4-8 words.

Output strict JSON only.
{
  "depth_worth_score": <1-5>,
  "pivot_signal": <true|false>,
  "answer_quality": "<concrete | evasive | mixed>",
  "missing_star_element": "<S | T | A | R | none>",
  "concrete_hooks": ["<3-8 word span from the answer>", "..."],
  "risk_signals": ["<vague-metric | pronoun-shift | resume-overclaim | contradiction>"],
  "recommended_direction": "<technical-depth | motivation | numbers | teamwork | contradiction>",
  "topic_label": "<project + claim, 4-8 words>"
}`;
}

// ─── STAGE 2 ─────────────────────────────────────────────────────────────────
function buildFollowUpQuestionPrompt({
  concreteHooks = [],
  missingStar = 'none',
  recommendedDirection = 'technical-depth',
  candidateAnswer = '',
  questionHistory = []
} = {}) {
  const hooks = Array.isArray(concreteHooks) ? concreteHooks.join('\n- ') : String(concreteHooks);
  const history = Array.isArray(questionHistory)
    ? questionHistory.map((q, i) => `${i + 1}. ${q}`).join('\n')
    : String(questionHistory || '');

  return `Generate 1-2 follow-up questions for the interviewer.

[Concrete hooks — the priority-1 question MUST quote at least 4 contiguous words from one of these spans, verbatim, in single quotes]
- ${hooks || '(none)'}

[Missing STAR element to fill]
${missingStar}

[Direction]
${recommendedDirection}

[Candidate's last answer]
${safe(candidateAnswer)}

[Questions already asked — do not repeat]
${safe(history, '(none yet)')}

Worked example of the quoting rule (READ THIS):
Bad (no quote, generic):
  "Can you tell me more about your deployment process?"
Good (quotes hook span verbatim in single quotes):
  "You said 'we hit our SLO targets' — what was the actual p99 latency number you were measuring against, and what was the SLO ceiling?"
Good (pinning a vague phrase from the hooks):
  "You said 'a lot better than expected' — what was the actual percent change and over what time window?"

Hard requirements:
- Priority-1 question MUST contain a single-quoted span of >=4 contiguous words taken verbatim from one of the concrete_hooks.
- Fill the missing STAR element. If candidate gave S + R, probe A.
- Demand numbers, not adjectives. Demand specific actions, not generic.
- One-sentence rationale TEACHES the interviewer the principle.
- Max 2 questions, priority-ranked.

FINAL VERIFICATION STEP — do this before you output:
1. Read your priority-1 question text.
2. Find the part in single quotes.
3. Verify it contains at least 4 contiguous words.
4. Verify those 4 words appear contiguously in one of the concrete_hooks above.
5. If any check fails, REWRITE the question and re-verify. Do not output the JSON until all 4 checks pass.

Output strict JSON only. No prose. No markdown fences.
{
  "questions": [
    {"priority": 1, "question": "<must contain a quoted hook span>", "rationale": "<one sentence>"},
    {"priority": 2, "question": "<distinct angle>", "rationale": "<one sentence>"}
  ]
}`;
}

// ─── STAGE 3 ─────────────────────────────────────────────────────────────────
function buildFreshTopicPrompt({
  jobDescription = '',
  untouchedHooks = [],
  questionHistory = [],
  previousTopicLabel = ''
} = {}) {
  const hooks = Array.isArray(untouchedHooks)
    ? untouchedHooks.map(h => `- label: ${h.label}\n  keywords: ${(h.keywords || []).join(', ')}\n  why_deep_dive: ${h.why_deep_dive || ''}`).join('\n')
    : String(untouchedHooks);
  const history = Array.isArray(questionHistory)
    ? questionHistory.map((q, i) => `${i + 1}. ${q}`).join('\n')
    : String(questionHistory || '');

  return `You are a senior interview coach. The interviewer has just exhausted the current topic and the copilot has signalled a topic pivot. Pick the SINGLE highest-value untouched hook from the resume and write the transition question.

[Job Description]
${safe(jobDescription, '(no JD provided)')}

[Untouched resume hooks — each with its keywords and the reason it deserves deep-diving]
${hooks || '(none)'}

[Questions already asked — do NOT repeat or paraphrase]
${safe(history, '(none yet)')}

[Last topic just exhausted]
${safe(previousTopicLabel, '(unknown)')}

Rules:
- Pick exactly ONE hook from the untouched list. Prefer hooks whose why_deep_dive mentions specific numbers, decisions, or contradictions.
- The question must include at least one of that hook's keywords verbatim, to anchor the transition.
- The question opens the new topic — it does not drill yet.
- Speakable, <=30 words. No 'now let's switch' preamble.

Output strict JSON only.
{
  "target_hook_label": "<the picked hook's label>",
  "question": "<one question that opens this new hook>",
  "rationale": "<one sentence>"
}`;
}

module.exports = {
  ITERATION_VERSION,
  buildHookDetectionPrompt,
  buildFollowUpQuestionPrompt,
  buildFreshTopicPrompt
};
