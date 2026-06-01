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

  return `Role: You are the RANK-SCORE block — the deep reasoner of the chain. You score 5 follow-up candidates on a 6-dim rubric and pick the top 2 the interviewer should see.

WHAT MAKES A QUESTION WIN: it forces the candidate to reveal durable POTENTIAL and WORK TRAITS — judgment, the alternatives they weighed, what they personally owned, what broke and what they learned. A question whose honest answer is a single number, name, or date is WEAK no matter how "specific" — pinning "how much did p99 drop" reveals nothing about the person. Reward depth and trait-revelation; punish fact-pins.

You MUST think step-by-step in the reasoning field for each candidate. Do NOT skip reasoning.

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

1. depth (1=answerable with a fact/yes-no; 5=cannot be answered without walking through real reasoning — a decision + the rejected alternative, a tradeoff + its cost, a failure + its diagnosis)
2. ownership (1=indifferent to who did what; 5=structurally forces a personal "I decided/did/risked" answer, not "we")
3. trait (1=reveals only information; 5=the answer is a window into a durable work trait — handling ambiguity, conflict, failure, prioritization, influence, judgment, learning)
4. anchoring (1=generic, askable of anyone; 5=tightly tied to a specific thing THIS candidate said, can't be answered with a canned story)
5. non_triviality (1=fundamentally a fact-pin — its answer is a number/name/date; 5=the value is in the reasoning, not any datum)
6. usability (1=clunky, >35 words, hard to speak; 5=natural conversational sentence the interviewer can drop in)

Required output — strict JSON only.
{
  "ranked": [
    {
      "id": "q1",
      "rubric": {
        "depth": <1-5>,
        "ownership": <1-5>,
        "trait": <1-5>,
        "anchoring": <1-5>,
        "non_triviality": <1-5>,
        "usability": <1-5>
      },
      "total": <sum of the 6 dims, integer 6-30>,
      "reasoning": "<3-5 sentence chain-of-thought: (a) what judgment/trait this question would reveal; (b) its strongest dim and why; (c) its weakest dim and why; (d) verifier sentence — re-state one rubric dim's score and confirm against the candidate text.>"
    }
  ],
  "top_2_ids": ["<best id>", "<second best id>"]
}

Hard rules:
1. ranked must contain ALL 5 candidates. No dropping.
2. total must equal the sum of the 6 dim scores exactly.
3. top_2_ids must contain TWO DISTINCT ids that exist in ranked[].id.
4. A candidate scoring non_triviality<=2 (a fact-pin) MUST NOT be top-1 unless every other candidate also scores non_triviality<=2. Never let "how much exactly"-style pins win.
5. SELECTION OBJECTIVE (this is what the interviewer actually values): top-1 is the candidate that best reveals the candidate's POTENTIAL — i.e. the HIGHEST (depth + trait) sum, among candidates with non_triviality>=3. depth and trait matter far more than usability or anchoring polish. Do NOT pick a smoother or better-anchored question over a meaningfully deeper one. Break ties by total, then by ownership.
6. Tie-break for top-2: among the remaining candidates, again highest (depth + trait) with non_triviality>=3, but PREFER a different question_type than top-1 so the interviewer gets two distinct angles.
7. reasoning MUST include a verifier sentence — re-read one rubric score and confirm against the candidate text. If you change your mind on verification, change the score before emitting.

Thinking scaffold (do this silently before emitting):
Step 1: For each candidate, ask "if the candidate answered honestly, would I learn how they THINK/DECIDE/OWN, or just a datum?" Score depth + non_triviality from that.
Step 2: Score all 6 dims absolutely against the rubric, not relative to other candidates.
Step 3: Recompute totals. Sort. Apply rule 4 (demote fact-pins), then tie-breaks.
Step 4: Write reasoning for the top-2 incl. the verifier sentence.
Step 5: Re-check top_2_ids has 2 distinct ids that exist in ranked.

Emit only the JSON object.`;
}

module.exports = { buildBlockE };
