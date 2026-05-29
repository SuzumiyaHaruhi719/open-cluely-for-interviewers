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

CRITICAL recall rules — flag these when they apply:
1. Vague metric without number ("a lot better", "significantly", "much faster") → evidence_type="metric".
2. Pronoun shift: resume says "I" or names candidate; candidate said "we" → evidence_type="owner-of-action".
3. Named entity dropped: resume names a tool/library/framework, candidate said "the tool we used" → evidence_type="named-tool".
4. Resume claims R, candidate gave S+T+A but not R → evidence_type="metric" or "timeline" depending on the claim shape.
5. Tradeoffs absent: candidate described a decision but did not articulate alternatives → evidence_type="tradeoff-reasoning".

Self-check before emitting (silent):
- For each missing_evidence entry, write the verifier_check FIRST in your head — if you can't justify it in one sentence, DROP the entry.
- For each overclaim_flag, check that both resume_claim and verbal_claim (or "(absent)") map to the same project/topic.

Emit only the JSON object.`;
}

module.exports = { buildBlockB };
