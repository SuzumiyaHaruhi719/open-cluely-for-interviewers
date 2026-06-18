// Block E · Rank & Score (Pro tier, prompt-level thinking)
// Six-dimension rubric, scored 1-5 per dim, integer-only. CoT reasoning is
// REQUIRED in the reasoning field — Block E runs on deepseek-v4-pro because
// the ranking is the highest-leverage decision in the chain. Top-2 ids are
// chosen by composite score with non-redundancy tie-break.
//
// DashScope's Anthropic-shape endpoint has no native reasoning_effort param,
// so we elicit deep reasoning purely through the prompt: an explicit thinking
// scaffold + a verifier round that re-checks each rubric assignment.

const DEFAULT_BODY = `Role: You are the RANK-SCORE block — the deep reasoner of the chain. You score 5 follow-up candidates on a 6-dim rubric and pick the top 2 the interviewer should see.

WHAT MAKES A QUESTION WIN: it reveals the highest-value next signal from THIS answer with a natural, non-repetitive follow-up frame. Reward depth, novelty, evidence value, trait-revelation, and frame_diversity. A question whose honest answer is a single number, name, or date is WEAK no matter how "specific" — pinning "how much did p99 drop" reveals little unless it continues into what the interviewer can conclude or probe next. Do not let ownership framing win by default; ownership is valuable only when the answer or Block B actually leaves personal contribution unclear.

You MUST think step-by-step in the reasoning field for each candidate. Do NOT skip reasoning.`;

function buildBlockE({
  blockAResult = null,
  blockBResult = null,
  blockCResult = null,
  blockDResult = null,
  candidateAnswer = '',
  resumeChunk = '',
  jobDescription = '',
  questionHistory = [],
  promptBody = null
} = {}) {
  const candidates = blockDResult?.candidates || [];
  const candidatesStr = candidates.length
    ? candidates.map((c, i) => `${i + 1}. id=${c.id} type=${c.question_type} frame=${c.followup_frame || 'n/a'} fills=${c.fills_evidence_gap || 'n/a'}\n   Q: ${c.question}\n   anchors: ${JSON.stringify(c.anchors || [])}\n   expected_yield: ${c.expected_yield || ''}`).join('\n\n')
    : '(no candidates)';

  const gapsStr = (blockBResult?.missing_evidence || []).map((g, i) => `${i + 1}. ${g.competency} / ${g.evidence_type} — ${g.why_missing}`).join('\n') || '(none)';
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).join('\n')
    : '(none)';

  const nextComp = blockCResult?.next_competency_target || 'technical-depth';
  const pivot = blockCResult?.should_pivot ? 'YES' : 'NO';

  return `${promptBody || DEFAULT_BODY}

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

1. depth (1=answerable with a fact/yes-no; 5=cannot be answered without walking through real reasoning — diagnosis, evidence verification, a tradeoff, a failure, or a collaboration boundary)
2. ownership (1=irrelevant or performative ownership demand; 3=neutral; 5=usefully clarifies personal contribution because the answer says "we"/team, Block B flags owner-of-action, or the open competency is leadership/collaboration)
3. trait (1=reveals only information; 5=the answer is a window into a durable work trait — handling ambiguity, conflict, failure, prioritization, influence, judgment, learning)
4. anchoring (1=generic, askable of anyone; 5=tightly tied to a specific thing THIS candidate said, can't be answered with a canned story)
5. non_triviality (1=fundamentally a fact-pin — its answer is a number/name/date; 5=the value is in the reasoning, not any datum)
6. usability (1=clunky, >35 words, hard to speak; 5=natural conversational sentence the interviewer can drop in)

Novelty / frame_diversity guard (applies after the numeric rubric):
- novelty means the question would uncover a new signal not already covered by prior questions, Block B/C, or another stronger candidate.
- frame_diversity means the top-2 should give the interviewer different follow-up intents when both are otherwise viable (e.g. diagnostic-debug vs evidence-verification, or tradeoff-alternative vs failure-learning).
- Do not reward a candidate just because it says "you personally"; if the answer did not create an ownership gap, treat repeated ownership framing as low novelty.

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
      "reasoning": "<ONE sentence: name the strongest + weakest dim, and re-confirm one score against the candidate text (verifier).>"
    }
  ],
  "top_2_ids": ["<best id>", "<second best id>"]
}

Hard rules:
1. ranked must contain ALL 5 candidates. No dropping.
2. total must equal the sum of the 6 dim scores exactly.
3. top_2_ids must contain TWO DISTINCT ids that exist in ranked[].id.
4. A candidate scoring non_triviality<=2 (a fact-pin) MUST NOT be top-1 unless every other candidate also scores non_triviality<=2. Never let "how much exactly"-style pins win.
5. SELECTION OBJECTIVE (this is what the interviewer actually values): top-1 is the candidate with the highest evidence value for THIS moment — depth + trait + non_triviality + novelty/current-gap fit, among candidates with non_triviality>=3. Ownership is a conditional bonus only when personal contribution is truly unresolved. Do not let ownership framing win by default, and do NOT pick a lower-information ownership question over a stronger diagnostic, verification, tradeoff, or failure-learning question.
6. Tie-break for top-2: among the remaining candidates, again maximize evidence value with non_triviality>=3, but PREFER a different followup_frame and question_type than top-1 so the interviewer gets two distinct angles.
7. reasoning MUST include a verifier sentence — re-read one rubric score and confirm against the candidate text. If you change your mind on verification, change the score before emitting.

Thinking scaffold (do this silently before emitting):
Step 1: For each candidate, ask "if the candidate answered honestly, would I learn new reasoning/evidence/judgment/learning/collaboration signal, or just a datum?" Score depth + non_triviality from that.
Step 2: Score all 6 dims absolutely against the rubric, not relative to other candidates. Treat ownership as conditional, not a universal virtue.
Step 3: Recompute totals. Sort. Apply rule 4 (demote fact-pins), then apply novelty + frame_diversity tie-breaks.
Step 4: Write reasoning for the top-2 incl. the verifier sentence.
Step 5: Re-check top_2_ids has 2 distinct ids that exist in ranked.

Emit only the JSON object.`;
}

module.exports = { buildBlockE, DEFAULT_BODY };
