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

function buildBlockC({ candidateAnswer = '', questionHistory = [], sessionState = null, jobDescription = '' } = {}) {
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).join('\n')
    : '(no prior questions)';

  const prior = sessionState && typeof sessionState === 'object'
    ? `current_competency_target=${sessionState.current_competency_target || 'unspecified'}\ndrilled_topics=${JSON.stringify(sessionState.drilled_topics || [])}\nelapsed_minutes=${sessionState.elapsed_minutes ?? 'n/a'}`
    : '(no prior session state)';

  return `Role: You are the STATE-UPDATE block. Decide what the interviewer should drill next and whether to pivot off the current topic. Pure function — your only inputs are (prior state, history, current answer, JD).

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
- Otherwise pick the competency adjacent to topic_just_drilled with the highest evidence-yield-per-question. For example: technical-depth just covered → "judgement-tradeoffs" or "failure-handling" reads the same project from a higher angle.
- Avoid jumping back to a competency just covered in the previous 1-2 questions unless a contradiction was opened.

drilled_topics_after must be the FULL list of topics drilled so far, including the just-completed one. If prior state listed N topics and this answer was on a new topic, return N+1 topics. Increment the depth count for whichever topic this answer addressed.

Self-check before emitting (silent):
- should_pivot is a strict consequence of depth count + "no new info" — verify by re-counting prior questions on the same topic.
- next_competency_target must not equal a competency that has already been drilled to depth>=3 unless a contradiction surfaced.

Emit only the JSON object.`;
}

module.exports = { buildBlockC };
