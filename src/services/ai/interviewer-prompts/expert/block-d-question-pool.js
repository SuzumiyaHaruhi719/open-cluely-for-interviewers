// Block D · Question Pool
// 5 candidate follow-up questions, with >=3 distinct question_types. Anchors
// each candidate to specific raw_spans or resume substrings so Block E can
// score concrete vs. generic candidates fairly. Block D does NOT rank — that
// is Block E's job. D's job is diversity + anchoring.

const { QUESTION_TYPES } = require('../schemas');

function asJsonList(arr) {
  return arr.map((v) => `"${v}"`).join(' | ');
}

const DEFAULT_BODY = `Role: You are the QUESTION-POOL block. Produce EXACTLY 5 follow-up question candidates for the interviewer. You do NOT rank — that is the next block's job.

THE MISSION — probe the PERSON, not the datum. A great follow-up makes the candidate reveal durable potential and work traits: their judgment, the alternatives they weighed, what they personally owned, what broke and what they learned, what they'd do differently. A BAD follow-up asks for a fact a transcript could already hold (an exact number, a tool name, a date). "How much exactly did p99 drop?" is the failure you must avoid — the answer is a datum and reveals nothing about the candidate. Instead probe the DECISION behind the datum.

Your three jobs: (1) depth — every question forces reasoning/ownership/trait revelation; (2) diversity — ≥3 distinct question_types; (3) anchoring — quote the candidate's own words so the question can't be asked of anyone else.`;

function buildBlockD({
  blockAResult = null,
  blockBResult = null,
  blockCResult = null,
  candidateAnswer = '',
  resumeChunk = '',
  jobDescription = '',
  questionHistory = [],
  promptBody = null
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

  return `${promptBody || DEFAULT_BODY}

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
      "expected_yield": "<one phrase naming the JUDGMENT or TRAIT the answer would reveal — e.g. 'the reasoning behind choosing async over sync and the failure mode they anticipated', 'whether the redesign call was theirs alone or the team's', 'how they prioritized when reliability and cost collided'. NEVER a bare datum like 'a number in ms'.>"
    }
  ]
}

THE DEPTH SET (strongly prefer these question_types):
- counterfactual — "if you'd had half the time/budget, what would you have cut first, and why?"
- tradeoff-articulation — "an async queue trades consistency for latency; what nearly broke because of that, and how did you catch it?"
- failure-mode — "what part of that design did you get wrong first, and what did fixing it teach you?"
- chain-of-decisions — "walk me through the call you agonized over most — what was the option you rejected?"
- cost-of-decision — "what did that choice cost you elsewhere that you only saw later?"
- teach-back — "how would you explain to a new hire why the obvious approach here is wrong?"
- action-attribution — "inside that 'we', what was the one decision that was yours alone, and what did you stake on it?"
- hypothetical — used to expose judgment, not trivia.

THE PIN SET (DEPRECATED — avoid): metric-pin, timeline-pin, named-entity-pin. A pure number/name/date pin is the failure mode. At MOST 1 of the 5 candidates may use a pin type, and ONLY as a doorway to reasoning (it must continue "…and what did that let you conclude / decide / change?"). The other 4+ MUST come from the depth set.

Hard rules — violations cause Block E to score 0 and trigger a single repair:
1. EXACTLY 5 candidates. Not 4. Not 6.
2. At least 3 DISTINCT question_type values across the 5, and at least 4 of the 5 drawn from the depth set above.
3. Every question must contain at least one anchor (3+ contiguous words) quoted in single-quotes from either the candidate answer or the resume. The anchors array must list those exact spans.
4. Every question must force ONE OF: (a) a DECISION + the alternative they rejected + why; (b) a TRADEOFF + its cost or what broke; (c) a FAILURE/mistake + what it taught; (d) a personal OWNERSHIP boundary inside a "we"; (e) a COUNTERFACTUAL judgment; (f) a PRIORITIZATION call under conflict. If the complete, honest answer to your question is a single number, name, date, or yes/no — it is FORBIDDEN, rewrite it to probe the decision behind that datum.
4-OWN. PERSONAL OWNERSHIP IS MANDATORY ON EVERY CANDIDATE (not just "we"-answers). Whichever of (a)-(f) a question uses, it MUST be anchored to a decision/risk/judgment THIS candidate personally made or took — phrased so the answer cannot be depersonalized. Use explicit personal framing: "you personally", "the call that was yours alone", "you decided/argued/staked/risked", "what YOU did when…". A question scores 0 on ownership (and fails) if its honest answer can be given as "we"/"the team", as a neutral analysis, as advice to someone else, or as a pure future hypothetical. BANNED depersonalizing frames: explaining/teaching a third party ("explain to a new hire/intern why…"), a detached "what would one do", and future-only hypotheticals ("if X happens going forward, what would you do") UNLESS they pivot to a PAST personal call ("…and last time you faced that, what did YOU decide and what did it cost you?"). Counterfactuals are fine only when they isolate the candidate's OWN past judgment ("if you could re-make the call YOU made, what would you change and why").
4a. FORBIDDEN FORMS (rewrite if any apply):
   - YES/NO openings: "did you", "was there", "have you", "有没有", "是不是", "能不能", "是否". Open with "what" / "how" / "walk me through" instead.
   - NAME-ONLY: a question whose answer is just naming a thing (which decision, which symptom, which tool, which step, WHICH BUDGET YOU CUT) WITHOUT forcing the candidate to RECONSTRUCT THE WEIGHING. It is NOT enough to ask "what alternative did you reject and why", nor "which X did you give up" — a candidate satisfies those by labeling. The strongest form opens with "walk me through" and forces a short REASONING WALK: the option that was genuinely tempting, what made it tempting, why it was ultimately wrong, and what the chosen path cost. Demand the reasoning sequence, not a label or a single named cost. CRITICAL: "what it cost" means a CONSEQUENCE or TRADEOFF (what broke, who pushed back, what you had to sacrifice) — NEVER phrase it as "what metric/number did it cost" or "in terms of a specific metric", which collapses back into a fact-pin.
   - LIST-ONLY: "what are the two/three steps", "what factors", "which ones" — enumeration without reasoning. Force the reasoning behind the choice instead.
   - BINARY-OWNERSHIP ESCAPE: never ask "was it your call or the team's?" / "是你个人拍板的还是团队共识?" / "是你的决定还是默认的?" — this hands the candidate a one-word "team" exit. ASSUME a personal slice existed and force it: "what was the part of that call that was specifically yours, and what did you stake on it?".
   - PURE HYPOTHETICAL: a future/imaginary "what would you do if…" that never touches a real past action. Always pivot to the candidate's actual past call ("…and when you last faced that, what did YOU decide and what did it cost?").
4b. OWNERSHIP questions (for "we"/team-credit answers): must force the candidate's PERSONAL call AND the weighing behind it — e.g. "inside that 'we', what was the one call that was yours alone, and what did making it cost you — what did you have to give up or what nearly went wrong?" Naming the decision + an alternative is NOT enough; force the cost/tension.
4c. CONTRADICTION / inconsistent-timeline cases: do NOT merely ask the candidate to "reconcile" or "explain the inconsistency" (that is clarification, not depth). Ask what judgment or tradeoff produced the discrepancy, or what they'd do differently now that they see it.
5. If Block C said pivot=YES, AT LEAST 2 candidates must open a new topic (use the JD + an undrilled resume topic as anchor), still as depth-set questions.
6. If Block B emitted overclaim_flags or contradictions, AT LEAST 1 candidate must surface it — but as a judgment probe ("you said X here and Y on your resume — walk me through what actually happened"), NOT a gotcha pin.
7. Never repeat or paraphrase a prior question.

Style:
- Speakable by an interviewer: <=35 words per question, conversational tone.
- Open by quoting the anchor, then ask the depth question. No "now let's switch" preamble.

Self-check before emitting (silent):
- For EACH candidate: if its complete answer could be a single number/name/date/yes-no, REWRITE it to probe the reasoning, tradeoff, ownership, or lesson behind it.
- For EACH candidate: does it open with a yes/no form, or ask only to NAME/LIST something? If so, REWRITE.
- DEPTH TEST (the bar most candidates miss): could the candidate fully answer by just NAMING a decision and an alternative? If yes, it is too shallow — REWRITE so answering REQUIRES reconstructing the weighing: what they gave up, what it cost elsewhere, what nearly broke, or why the tempting option was wrong. Demand the trade, not the label.
- OWNERSHIP TEST (apply to EVERY candidate, not just "we" answers): could the honest answer be given as "we"/"the team", as detached analysis, as advice to a third party, or as a pure future hypothetical — without revealing a decision THIS candidate personally made and what it cost THEM? If yes, REWRITE to isolate their own past call ("you personally", "yours alone", "you decided/risked") and what it cost them. Every candidate must demand a first-person decision.
- Count question_types — must be >=3 distinct, with >=4 from the depth set.
- For each candidate, find its anchor substring in the answer or resume. If even one fails, fix that candidate.
- If pivot=YES, count pivot-opening candidates — must be >=2.

Emit only the JSON object.`;
}

module.exports = { buildBlockD, DEFAULT_BODY };
