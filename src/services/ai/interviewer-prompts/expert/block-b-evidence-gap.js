// Block B · Evidence Gap
// CoVe (Chain-of-Verification) style: given A's anatomy, B infers what is
// MISSING and what is OVERCLAIMED. Every emitted gap must include a
// verifier_check sentence explaining why B is sure the gap is real (not just
// "I didn't see it"). This is the highest-leakage block — over-flagging
// produces noisy follow-ups; under-flagging means the copilot adds no value.

const { COMPETENCIES, EVIDENCE_TYPES } = require('../schemas');

function asJsonList(arr) {
  return arr.map((v) => `"${v}"`).join(' | ');
}

function buildBlockB({ blockAResult = null, candidateAnswer = '', resumeChunk = '', jobDescription = '', questionHistory = [], sessionState = null } = {}) {
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).join('\n')
    : '(no prior questions)';

  const claims = blockAResult?.claims || [];
  const claimsStr = claims.length
    ? claims.map((c, i) => `${i + 1}. id=${c.id} type=${c.claim_type} subject="${c.subject || ''}" value="${c.value || ''}" raw_span="${c.raw_span}"`).join('\n')
    : '(no claims anchored)';

  const starStr = blockAResult?.star_coverage
    ? `S=${blockAResult.star_coverage.S} T=${blockAResult.star_coverage.T} A=${blockAResult.star_coverage.A} R=${blockAResult.star_coverage.R}`
    : '(no STAR coverage data)';

  const stateLine = sessionState && typeof sessionState === 'object'
    ? `current_competency_target=${sessionState.current_competency_target || 'unspecified'}; drilled_topics=${(sessionState.drilled_topics || []).join(' | ') || '(none)'}`
    : '(no session state)';

  return `Role: You are the EVIDENCE-GAP block. Block A already anatomized the answer into anchored claims. You decide what evidence is still MISSING for the role + what claims OVERCLAIM the resume vs the verbal answer. Use Chain-of-Verification: every gap you emit must include a verifier_check sentence stating why you're confident the gap is real, citing either an empty claim slot or a measurable delta vs the resume.

[Candidate's most recent answer — for re-reading; do NOT modify anchors]
\`\`\`
${candidateAnswer}
\`\`\`

[Resume excerpt — compare verbal claims against this]
\`\`\`
${resumeChunk || '(no resume excerpt)'}
\`\`\`

[Job description — gates which competencies matter]
\`\`\`
${jobDescription || '(no JD)'}
\`\`\`

[Block A claims — anchored to candidate answer]
${claimsStr}

[STAR coverage from Block A]
${starStr}

[Prior questions]
${history}

[Session state]
${stateLine}

Required output — strict JSON only, no markdown fences, no prose.
{
  "missing_evidence": [
    {
      "competency": ${asJsonList(COMPETENCIES)},
      "evidence_type": ${asJsonList(EVIDENCE_TYPES)},
      "why_missing": "<one sentence: the specific data point that should have been said but wasn't>",
      "verifier_check": "<one sentence: how you confirmed this is missing, not just unstated. Reference the absent claim_type or the empty STAR slot.>"
    }
  ],
  "overclaim_flags": [
    {
      "resume_claim": "<exact substring from resume>",
      "verbal_claim": "<exact substring from candidate answer, or '(absent)' if candidate skipped this entirely>",
      "delta": "<one phrase: what the resume promises that the verbal answer doesn't deliver>"
    }
  ],
  "contradictions": [
    {
      "claim_a": "<raw_span or resume substring>",
      "claim_b": "<raw_span or prior-answer substring>",
      "why_contradicts": "<one sentence>"
    }
  ]
}

CRITICAL anti-false-positive rules:
1. A "missing" piece of evidence is ONLY missing if a competent answer to the current question WOULD have included it. If the interviewer asked "what's your name", missing-metric is not a gap. Use the JD + the most-recent question to gate this.
2. Do NOT flag missing_evidence for STAR elements the question didn't ask for. If the question was "what tools did you use" and the candidate listed tools, missing-result is NOT a gap.
3. resume-vs-verbal-overclaim: ONLY emit when the resume bullet AND the candidate's verbal response cover the SAME topic. If the resume says "led 5-person team" but the question was about latency, do not flag.
4. Empty missing_evidence is a legitimate output. If the candidate gave a strong, complete answer to a non-load-bearing question, emit missing_evidence=[].

CRITICAL recall rules — the gaps that matter MOST are unrevealed JUDGMENT, OWNERSHIP, and REASONING (not missing numbers). Prioritize these:
1. Decision without reasoning: candidate described a choice/redesign/approach but did not say what alternative they rejected or why → evidence_type="tradeoff-reasoning". (HIGHEST priority — this is where potential hides.)
2. Ownership unclear: candidate said "we"/"the team" for a decision or action with no personal boundary → evidence_type="owner-of-action".
3. Outcome claimed, mechanism hidden: candidate asserts a result ("latency dropped", "pages stopped") but not HOW their decisions caused it or what nearly went wrong → evidence_type="tradeoff-reasoning" or "failure-handling".
4. No failure/learning surfaced: a substantial project narrative with zero mention of what went wrong or what they'd change → evidence_type="failure-handling".
5. Tradeoff cost unexamined: a tradeoff was made but its downside / what it cost elsewhere is unstated → evidence_type="cost-awareness".
NOTE: a missing exact NUMBER, TOOL NAME, or DATE is the LOWEST-value gap. Only flag evidence_type="metric"/"named-tool"/"timeline" if the number/name is genuinely load-bearing for the role AND no judgment gap is available — prefer the judgment/ownership gaps above.

Self-check before emitting (silent):
- For each missing_evidence entry, write the verifier_check FIRST in your head — if you can't justify it in one sentence, DROP the entry.
- For each overclaim_flag, check that both resume_claim and verbal_claim (or "(absent)") map to the same project/topic.

Emit only the JSON object.`;
}

module.exports = { buildBlockB };
