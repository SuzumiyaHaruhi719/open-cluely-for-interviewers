// Block C · State Update
// Pure function: given prior session state + this answer, decide what gets
// drilled next and whether to pivot. Runs in parallel with Block A — does not
// depend on A's claims. Caching note: keyed on (drilled_topics, last_question,
// answer_quality_hint). Re-using state across answers is OK as long as the
// triple is unchanged.

const { COMPETENCIES } = require('../schemas');

function asJsonList(arr) {
  return arr.map((v) => `"${v}"`).join(' | ');
}

// Render the persisted session state (Block H consolidation output) into the
// prompt. Block H emits { drilled_topics, competencies_covered, open_gaps,
// candidate_profile_summary, asked_questions }; older callers may still pass
// { current_competency_target, drilled_topics, elapsed_minutes }. We surface
// whichever fields are present so consolidation actually closes the loop:
// Block C sees what's already been drilled, which competencies have evidence,
// and which gaps remain open — and steers the next question accordingly.
function renderPriorState(sessionState) {
  if (!sessionState || typeof sessionState !== 'object') {
    return '(no prior session state)';
  }
  const lines = [];
  if (Array.isArray(sessionState.drilled_topics)) {
    lines.push(`drilled_topics=${JSON.stringify(sessionState.drilled_topics)}`);
  }
  if (Array.isArray(sessionState.competencies_covered)) {
    lines.push(`competencies_covered=${JSON.stringify(sessionState.competencies_covered)}`);
  }
  if (Array.isArray(sessionState.open_gaps)) {
    lines.push(`open_gaps=${JSON.stringify(sessionState.open_gaps)}`);
  }
  if (typeof sessionState.candidate_profile_summary === 'string' && sessionState.candidate_profile_summary.trim()) {
    lines.push(`candidate_profile_summary=${sessionState.candidate_profile_summary.trim()}`);
  }
  if (Array.isArray(sessionState.asked_questions) && sessionState.asked_questions.length) {
    lines.push(`already_asked_questions=${JSON.stringify(sessionState.asked_questions)}`);
  }
  // Backward-compat fields from the older session-state shape.
  if (sessionState.current_competency_target) {
    lines.push(`current_competency_target=${sessionState.current_competency_target}`);
  }
  if (sessionState.elapsed_minutes !== undefined && sessionState.elapsed_minutes !== null) {
    lines.push(`elapsed_minutes=${sessionState.elapsed_minutes}`);
  }
  return lines.length ? lines.join('\n') : '(no prior session state)';
}

function buildBlockC({ candidateAnswer = '', questionHistory = [], sessionState = null, jobDescription = '', promptBody = null } = {}) {
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).join('\n')
    : '(no prior questions)';

  const prior = renderPriorState(sessionState);

  // Editable instruction body (role/mission); inputs + schema + rules are frame.
  const defaultBody = `Role: You are the STATE-UPDATE block. Decide what the interviewer should drill next and whether to pivot off the current topic. Pure function — your only inputs are (prior state, history, current answer, JD).`;
  return `${promptBody || defaultBody}

[Prior session state]
${prior}

[Job description — defines competency priorities for the role]
\`\`\`
${jobDescription || '(no JD)'}
\`\`\`

[Prior questions, oldest first]
${history}

[Candidate's most recent answer]
\`\`\`
${candidateAnswer}
\`\`\`

Required output — strict JSON only, no markdown fences, no prose.
{
  "topic_just_drilled": "<short label of the topic this answer addressed, e.g. 'migration latency'>",
  "next_competency_target": ${asJsonList(COMPETENCIES)},
  "depth_remaining_on_current_topic": "exhausted" | "one-more" | "deep-vein",
  "should_pivot": <true|false>,
  "drilled_topics_after": [
    { "topic": "<label>", "depth": <integer count of questions on this topic INCLUDING the just-asked one> }
  ]
}

Pivot rules — apply this and ONLY this for should_pivot:
should_pivot = true IF AND ONLY IF the depth count for topic_just_drilled in drilled_topics_after is >= 3 AND no major new information was disclosed in this answer.
Do NOT pivot based on answer quality alone. Quality is Block D/E's problem. C decides topology.

depth_remaining_on_current_topic rules:
- "exhausted": >=3 prior questions on this topic AND answer added no new anchored claims.
- "one-more": one specific gap remains that can be closed in a single follow-up (numbers, named entity, owner).
- "deep-vein": substantial unexplored territory remains (the candidate just opened a new sub-thread, e.g. mentioned a failure mode).

next_competency_target picks:
- If JD prioritizes a competency that has 0 evidence so far, pick that. (e.g. JD asks for leadership; first 3 questions covered only technical-depth; pick "leadership".)
- Treat any competency listed in prior-state competencies_covered as ALREADY having evidence — prefer a competency NOT yet in that list, all else equal.
- Otherwise pick the competency adjacent to topic_just_drilled with the highest evidence-yield-per-question. For example: technical-depth just covered → "judgement-tradeoffs" or "failure-handling" reads the same project from a higher angle.
- Avoid jumping back to a competency just covered in the previous 1-2 questions unless a contradiction was opened.

Using prior-state consolidation (from Block H, if present):
- open_gaps lists evidence the interview still owes. If topic_just_drilled maps onto an open gap that this answer did NOT close, lean toward "one-more" (one targeted follow-up closes it) rather than pivoting.
- A topic already in drilled_topics with no new info this round is a strong pivot signal (combined with the depth>=3 rule above).
- already_asked_questions / candidate_profile_summary are context only — do NOT restate them; use them to avoid steering back into ground already covered.

drilled_topics_after must be the FULL list of topics drilled so far, including the just-completed one. If prior state listed N topics and this answer was on a new topic, return N+1 topics. Increment the depth count for whichever topic this answer addressed.

Self-check before emitting (silent):
- should_pivot is a strict consequence of depth count + "no new info" — verify by re-counting prior questions on the same topic.
- next_competency_target must not equal a competency that has already been drilled to depth>=3 unless a contradiction surfaced.

Emit only the JSON object.`;
}

module.exports = { buildBlockC };
