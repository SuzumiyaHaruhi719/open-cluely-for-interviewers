// Block E · Rank & Score (Pro tier, prompt-level thinking)
// Six-dimension rubric, scored 1-5 per dim, integer-only. CoT reasoning is
// REQUIRED in the reasoning field — Block E runs on deepseek-v4-pro because
// the ranking is the highest-leverage decision in the chain. Top-2 ids are
// chosen by composite score with non-redundancy tie-break.
//
// DashScope's Anthropic-shape endpoint has no native reasoning_effort param,
// so we elicit deep reasoning purely through the prompt: an explicit thinking
// scaffold + a verifier round that re-checks each rubric assignment.

function buildBlockE({
  blockAResult = null,
  blockBResult = null,
  blockCResult = null,
  blockDResult = null,
  candidateAnswer = '',
  resumeChunk = '',
  jobDescription = '',
  questionHistory = []
} = {}) {
  const candidates = blockDResult?.candidates || [];
  const candidatesStr = candidates.length
    ? candidates.map((c, i) => `${i + 1}. id=${c.id} type=${c.question_type} fills=${c.fills_evidence_gap || 'n/a'}\n   Q: ${c.question}\n   anchors: ${JSON.stringify(c.anchors || [])}\n   expected_yield: ${c.expected_yield || ''}`).join('\n\n')
    : '(no candidates)';

  const gapsStr = (blockBResult?.missing_evidence || []).map((g, i) => `${i + 1}. ${g.competency} / ${g.evidence_type} — ${g.why_missing}`).join('\n') || '(none)';
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).join('\n')
    : '(none)';

  const nextComp = blockCResult?.next_competency_target || 'technical-depth';
  const pivot = blockCResult?.should_pivot ? 'YES' : 'NO';

  return `Role: You are the RANK-SCORE block — the Pro-tier reasoner of the chain. You score 5 follow-up candidates on a 6-dim rubric and pick the top 2 the interviewer should see. You are deliberately the slowest, deepest block.

You MUST think step-by-step in the reasoning field for each candidate. Do NOT skip reasoning. Your reasoning is the audit trail that downstream evaluators read.

[Job description — defines what evidence is valuable]
\`\`\`
${jobDescription || '(no JD)'}
\`\`\`

[Block C next_competency_target]
${nextComp}

[Block C should_pivot]
${pivot}

[Block B missing evidence — what gaps a good question should close]
${gapsStr}

[Candidate answer — to evaluate dodge risk]
\`\`\`
${candidateAnswer}
\`\`\`

[Resume excerpt — for overclaim probing]
\`\`\`
${resumeChunk || '(no resume excerpt)'}
\`\`\`

[Prior questions — penalize candidates that paraphrase these]
${history}

[5 question candidates from Block D]
${candidatesStr}

Six-dimension rubric — score EACH dim as integer 1-5 per candidate.

1. evidence_value (1=closes no gap; 5=closes a critical missing-evidence entry tied to next_competency_target)
2. specificity (1=open-ended "tell me more"; 5=demands a specific number / named entity / date / counterfactual)
3. non_redundancy (1=paraphrases a prior question or another candidate; 5=opens a wholly distinct angle)
4. interviewer_usability (1=clunky, hard to speak aloud, >35 words; 5=natural conversational sentence the interviewer can drop in)
5. risk_of_dodge_inverse (1=easy to dodge with "we focused on quality"; 5=structurally pinning — order-of-magnitude commitment, named-entity, contradiction-quote)
6. expected_signal_density (1=yields a vague qualitative answer; 5=yields a falsifiable, anchored data point in <30 seconds of candidate speech)

Required output — strict JSON only.
{
  "ranked": [
    {
      "id": "q1",
      "rubric": {
        "evidence_value": <1-5>,
        "specificity": <1-5>,
        "non_redundancy": <1-5>,
        "interviewer_usability": <1-5>,
        "risk_of_dodge_inverse": <1-5>,
        "expected_signal_density": <1-5>
      },
      "total": <sum of the 6 dims, integer 6-30>,
      "reasoning": "<3-5 sentence chain-of-thought: (a) which gap or pivot this candidate addresses; (b) which dim it scores highest on and why; (c) which dim it scores lowest on and why; (d) verifier sentence — re-state one rubric dim's score and confirm the score against the candidate text.>"
    }
  ],
  "top_2_ids": ["<best id>", "<second best id>"]
}

Hard rules:
1. ranked must contain ALL 5 candidates. No dropping.
2. total must equal the sum of the 6 dim scores exactly.
3. top_2_ids must contain TWO DISTINCT ids that exist in ranked[].id.
4. Tie-break for top-1: highest total wins. If tied, prefer higher non_redundancy. If still tied, prefer higher evidence_value.
5. Tie-break for top-2: among the remaining 4, highest total wins, with same non-redundancy / evidence-value tie-break, but PREFER a candidate with a different question_type than top-1 (gives the interviewer two angles, not two copies).
6. reasoning MUST include a verifier sentence — re-read one of your rubric scores and confirm against the candidate text. If on verification you change your mind, change the score before emitting.

Thinking scaffold (do this silently before emitting):
Step 1: For each candidate, list the gap or pivot it claims to address and check that against Block B / Block C.
Step 2: For each candidate, score the 6 dims. Do not anchor to other candidates — score absolutely against the rubric.
Step 3: Recompute totals. Sort. Apply tie-breaks.
Step 4: For the top-2, write the reasoning paragraph. Include the verifier sentence.
Step 5: Re-check that top_2_ids has 2 distinct ids and both exist in ranked.

Emit only the JSON object.`;
}

module.exports = { buildBlockE };
