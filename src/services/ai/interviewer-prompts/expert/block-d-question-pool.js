// Block D · Question Pool
// 5 candidate follow-up questions, with >=3 distinct question_types. Anchors
// each candidate to specific raw_spans or resume substrings so Block E can
// score concrete vs. generic candidates fairly. Block D does NOT rank — that
// is Block E's job. D's job is diversity + anchoring.

const { QUESTION_TYPES } = require('../schemas');

function asJsonList(arr) {
  return arr.map((v) => `"${v}"`).join(' | ');
}

function buildBlockD({
  blockAResult = null,
  blockBResult = null,
  blockCResult = null,
  candidateAnswer = '',
  resumeChunk = '',
  jobDescription = '',
  questionHistory = []
} = {}) {
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).join('\n')
    : '(no prior questions)';

  const claims = blockAResult?.claims || [];
  const claimsStr = claims.length
    ? claims.map((c) => `- id=${c.id} type=${c.claim_type} raw_span="${c.raw_span}" value="${c.value || ''}"`).join('\n')
    : '(no anchored claims)';

  const gaps = blockBResult?.missing_evidence || [];
  const gapsStr = gaps.length
    ? gaps.map((g, i) => `${i + 1}. competency=${g.competency} type=${g.evidence_type} why="${g.why_missing}"`).join('\n')
    : '(no missing evidence flagged)';

  const overclaims = blockBResult?.overclaim_flags || [];
  const overclaimsStr = overclaims.length
    ? overclaims.map((o, i) => `${i + 1}. resume="${o.resume_claim}" verbal="${o.verbal_claim}" delta="${o.delta}"`).join('\n')
    : '(none)';

  const contradictions = blockBResult?.contradictions || [];
  const contradictionsStr = contradictions.length
    ? contradictions.map((c, i) => `${i + 1}. A="${c.claim_a}" B="${c.claim_b}" why="${c.why_contradicts}"`).join('\n')
    : '(none)';

  const nextComp = blockCResult?.next_competency_target || 'technical-depth';
  const shouldPivot = blockCResult?.should_pivot ? 'YES — open a new topic' : 'NO — drill the current topic';

  return `Role: You are the QUESTION-POOL block. Produce EXACTLY 5 follow-up question candidates for the interviewer. Diversity is mandatory: at least 3 distinct question_types across the 5 candidates. You do NOT rank — that is the next block's job. Your two jobs: (1) diversity, (2) anchoring.

[Block A claims]
${claimsStr}

[Block B missing evidence]
${gapsStr}

[Block B overclaim flags]
${overclaimsStr}

[Block B contradictions]
${contradictionsStr}

[Block C next competency target]
${nextComp}

[Block C pivot directive]
${shouldPivot}

[Candidate answer — for verbatim quoting in anchors]
\`\`\`
${candidateAnswer}
\`\`\`

[Resume excerpt — for verbatim quoting when probing overclaims]
\`\`\`
${resumeChunk || '(no resume excerpt)'}
\`\`\`

[Job description]
\`\`\`
${jobDescription || '(no JD)'}
\`\`\`

[Prior questions — do NOT repeat or paraphrase]
${history}

Required output — strict JSON only, no markdown fences, no prose.
{
  "candidates": [
    {
      "id": "q1",
      "question": "<one interviewer-speakable sentence ending in ?. Must quote at least one anchor in single quotes verbatim from candidate answer OR resume.>",
      "question_type": ${asJsonList(QUESTION_TYPES)},
      "anchors": ["<exact substring quoted in the question — must literally appear in the question above>"],
      "fills_evidence_gap": "<the missing_evidence competency this question targets, or 'pivot' if Block C signaled pivot, or 'overclaim' / 'contradiction' if probing B's flags>",
      "expected_yield": "<one phrase: the specific data the candidate would have to produce to answer well, e.g. 'a numeric p99 in ms', 'a named alternative considered', 'who actually wrote the code'>"
    }
  ]
}

Hard rules — violations cause Block E to score 0 and trigger a single repair:
1. EXACTLY 5 candidates. Not 4. Not 6.
2. At least 3 DISTINCT question_type values across the 5. Use the diversity to attack the gap from different angles — e.g. metric-pin + named-entity-pin + action-attribution + counterfactual + chain-of-decisions for a single competency.
3. Every question must contain at least one anchor (3+ contiguous words) quoted in single-quotes from either the candidate answer or the resume. The anchors array must list those exact spans.
4. If Block C said pivot=YES, AT LEAST 2 candidates must open a new topic (use the JD + an undrilled resume topic as anchor). The other candidates may still probe gaps from prior questions for the interviewer to choose between drilling and pivoting.
5. If Block B emitted overclaim_flags, AT LEAST 1 candidate must be question_type="resume-contradiction-pin" anchored on a resume_claim substring.
6. If Block B emitted contradictions, AT LEAST 1 candidate must surface the contradiction with both sides quoted.
7. Forbidden framings (these invite qualitative dodges): "what factors", "what signals", "what set them apart", "how did you decide" (without a forced specific), "what was your approach", "tell me more". A question must demand ONE OF: (a) a NUMBER / order-of-magnitude commitment; (b) a NAMED person / tool / library / dataset; (c) a DATE / version / commit / PR id; (d) a COUNTERFACTUAL ("what would have happened if X"); (e) a TRADEOFF ("what did you choose NOT to do and why").
8. expected_yield is concrete: "a numeric latency in ms", not "details about the system".
9. Never repeat or paraphrase a prior question.

Style:
- Speakable by an interviewer: <=35 words per question, conversational tone.
- No "now let's switch" preamble. Open by quoting the anchor, then ask.

Self-check before emitting (silent):
- Count question_types — must be >=3 distinct.
- For each candidate, find its anchor substring in either the answer or the resume. If even one fails, fix that candidate.
- If pivot=YES, count pivot-opening candidates — must be >=2.

Emit only the JSON object.`;
}

module.exports = { buildBlockD };
