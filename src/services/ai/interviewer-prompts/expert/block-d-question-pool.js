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

THE MISSION — generate a varied set of useful interviewer follow-ups. A great pool gives the interviewer genuinely different ways to probe the latest answer: how the candidate diagnosed the situation, how they verified outcomes, what alternatives they weighed, what broke or changed their mind, and only when needed what their personal slice was. A BAD pool makes every question sound like the same template ("you said X, what did YOU personally decide and what did it cost?") regardless of what the candidate actually said. Keep depth, but vary the frame.

Your three jobs: (1) depth — questions reveal reasoning, evidence, judgment, or learning instead of bare facts; (2) FOLLOW-UP FRAME DIVERSITY — the 5 candidates cover meaningfully different interviewer intents; (3) anchoring — use the candidate's own words so the question cannot be asked of anyone else. Ownership is conditional: ask it when "we"/team-credit, missing owner-of-action, leadership, or influence is actually the best next gap, not on every candidate.`;

// Cap on how many bank questions to inject, and per-question char budget. The
// retriever returns a handful of high-frequency questions as DIRECTION HINTS
// only — they ground D toward the area without letting it copy verbatim.
const BANK_QUESTIONS_MAX = 8;
const BANK_QUESTION_CHARS = 160;

function buildBlockD({
  blockAResult = null,
  blockBResult = null,
  blockCResult = null,
  candidateAnswer = '',
  resumeChunk = '',
  jobDescription = '',
  questionHistory = [],
  bankQuestions = [],
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

  // OPTIONAL grounding: real high-frequency interview questions semantically
  // similar to the candidate's answer (from @open-cluely/question-bank). When
  // absent/empty the section is an EMPTY STRING, so the prompt is byte-identical
  // to today (verified by pipeline-prompt-body + equivalence tests). Direction
  // hints only — D must still anchor on the candidate's own words.
  const groundingSection = Array.isArray(bankQuestions) && bankQuestions.length
    ? `\n\nREAL HIGH-FREQUENCY INTERVIEW QUESTIONS IN THIS AREA (direction hints only — you MUST anchor on the candidate's latest answer; do NOT copy these verbatim):\n${bankQuestions
        .slice(0, BANK_QUESTIONS_MAX)
        .map((q, i) => {
          const text = String(q == null ? '' : q).replace(/\s+/g, ' ').trim();
          const clipped = text.length > BANK_QUESTION_CHARS ? text.slice(0, BANK_QUESTION_CHARS) : text;
          return `${i + 1}. ${clipped}`;
        })
        .join('\n')}`
    : '';

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
${shouldPivot}${groundingSection}

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
      "followup_frame": "diagnostic-debug" | "evidence-verification" | "tradeoff-alternative" | "failure-learning" | "collaboration-ownership",
      "question": "<one interviewer-speakable sentence ending in ?. Use at least one anchor naturally; do NOT force every question to start with the quote.>",
      "question_type": ${asJsonList(QUESTION_TYPES)},
      "anchors": ["<exact substring quoted in the question — must literally appear in the question above>"],
      "fills_evidence_gap": "<the missing_evidence competency this question targets, or 'pivot' if Block C signaled pivot, or 'overclaim' / 'contradiction' if probing B's flags>",
      "expected_yield": "<one phrase naming the JUDGMENT or TRAIT the answer would reveal — e.g. 'the reasoning behind choosing async over sync and the failure mode they anticipated', 'whether the redesign call was theirs alone or the team's', 'how they prioritized when reliability and cost collided'. NEVER a bare datum like 'a number in ms'.>"
    }
  ]
}

FOLLOW-UP FRAME DIVERSITY — cover at least 4 of these 5 frames across the pool:
- diagnostic-debug — how they identified the real cause, ruled out tempting wrong explanations, or debugged ambiguity.
- evidence-verification — how they proved the change worked, chose a success signal, guarded against regression, or knew the result was not luck.
- tradeoff-alternative — what credible alternative they considered, why it was tempting, why they rejected it, and what the chosen path gave up.
- failure-learning — what broke, what assumption was wrong, what they changed after seeing reality, or what they would now do differently.
- collaboration-ownership — the candidate's specific slice, influence, disagreement, or handoff boundary. Use this frame when the answer says "we"/team, Block B flags owner-of-action, or leadership/collaboration is the gap. Ownership is conditional; do not force it when another frame is more valuable.

QUESTION TYPE TOOLKIT:
- counterfactual — expose past judgment under a constraint ("if you had half the time, what would you change about the call you made?").
- tradeoff-articulation — expose a real cost or rejected alternative.
- failure-mode — expose diagnosis and learning from what went wrong.
- chain-of-decisions — reconstruct a reasoning path, not just a named decision.
- cost-of-decision — expose consequence, sacrifice, pushback, or operational cost.
- teach-back — use sparingly to test clarity about a real choice, not generic textbook knowledge.
- action-attribution — only for collaboration-ownership / unclear "we" answers.
- hypothetical — acceptable only when tied back to a past concrete choice.
- metric-pin / timeline-pin / named-entity-pin — allowed when the datum is needed to verify evidence, but it must continue into reasoning ("what did that let you conclude/change?").

Hard rules — violations cause Block E to score 0 and trigger a single repair:
1. EXACTLY 5 candidates. Not 4. Not 6.
1b. ORDER BEST-FIRST: candidate 1 (id "q1") MUST be the best next question for THIS answer — highest information gain, strongest fit to Block B/C, natural for an interviewer to ask now, and not a repeat of prior questions. Candidate 2 (id "q2") is your second-best with a DIFFERENT followup_frame and question_type when possible. The downstream renderer uses q1 as the primary follow-up and q2 as the alternative, so this ordering is the selection — get it right.
2. At least 3 DISTINCT question_type values across the 5, and at least 4 DISTINCT followup_frame values across the 5.
3. Every question must contain at least one anchor (3+ contiguous words) quoted in single-quotes from either the candidate answer or the resume. The anchors array must list those exact spans. The quote can appear anywhere natural in the sentence.
4. Every question must force ONE OF: (a) diagnosis / root-cause reasoning; (b) evidence verification / how they knew it worked; (c) a tradeoff + alternative + why; (d) a failure/mistake + what changed; (e) collaboration / ownership boundary when relevant; (f) prioritization under conflict. If the complete, honest answer to your question is a single number, name, date, or yes/no — it is FORBIDDEN, rewrite it to probe the judgment behind that datum.
4-OWN. Ownership is conditional, not universal. Use explicit personal framing ("you personally", "your part", "the call you owned") ONLY when the answer used "we"/team credit, Block B flags owner-of-action, the JD/resume makes leadership/collaboration the open gap, or no other frame would reveal the missing signal. A question should not score higher merely because it says "you personally"; a diagnostic, verification, tradeoff, or failure-learning question can be stronger.
4a. FORBIDDEN FORMS (rewrite if any apply):
   - YES/NO openings: "did you", "was there", "have you", "有没有", "是不是", "能不能", "是否". Open with "what" / "how" / "walk me through" instead.
   - NAME-ONLY: a question whose answer is just naming a thing (which decision, which symptom, which tool, which step, WHICH BUDGET YOU CUT) WITHOUT forcing the candidate to RECONSTRUCT THE WEIGHING. It is NOT enough to ask "what alternative did you reject and why", nor "which X did you give up" — a candidate satisfies those by labeling. The strongest form opens with "walk me through" and forces a short REASONING WALK: the option that was genuinely tempting, what made it tempting, why it was ultimately wrong, and what the chosen path cost. Demand the reasoning sequence, not a label or a single named cost. CRITICAL: "what it cost" means a CONSEQUENCE or TRADEOFF (what broke, who pushed back, what you had to sacrifice) — NEVER phrase it as "what metric/number did it cost" or "in terms of a specific metric", which collapses back into a fact-pin.
   - LIST-ONLY: "what are the two/three steps", "what factors", "which ones" — enumeration without reasoning. Force the reasoning behind the choice instead.
   - BINARY-OWNERSHIP ESCAPE: when using the collaboration-ownership frame, never ask "was it your call or the team's?" / "是你个人拍板的还是团队共识?" / "是你的决定还是默认的?" — this hands the candidate a one-word "team" exit. Ask for the concrete slice, boundary, or influence path instead.
   - PURE HYPOTHETICAL: a future/imaginary "what would you do if…" that never touches a real past action. Always pivot to the candidate's actual past call ("…and when you last faced that, what did YOU decide and what did it cost?").
4b. OWNERSHIP questions (for "we"/team-credit answers): must ask for the candidate's concrete slice AND the evidence of influence or decision quality. Naming the slice alone is NOT enough; follow it to the tension, tradeoff, or impact.
4c. CONTRADICTION / inconsistent-timeline cases: do NOT merely ask the candidate to "reconcile" or "explain the inconsistency" (that is clarification, not depth). Ask what judgment or tradeoff produced the discrepancy, or what they'd do differently now that they see it.
5. If Block C said pivot=YES, AT LEAST 2 candidates must open a new topic (use the JD + an undrilled resume topic as anchor), still following the frame-diverse depth rules above.
6. If Block B emitted overclaim_flags or contradictions, AT LEAST 1 candidate must surface it — but as a judgment probe ("you said X here and Y on your resume — walk me through what actually happened"), NOT a gotcha pin.
7. Never repeat or paraphrase a prior question.

Style:
- Speakable by an interviewer: <=35 words per question, conversational tone.
- Do NOT make every question start by quoting the anchor. Vary syntax: some questions may open with "How/What/Walk me through", some may place the quote mid-sentence, and some may use a short quoted anchor after the ask. No "now let's switch" preamble.

Self-check before emitting (silent):
- For EACH candidate: if its complete answer could be a single number/name/date/yes-no, REWRITE it to probe the reasoning, tradeoff, ownership, or lesson behind it.
- For EACH candidate: does it open with a yes/no form, or ask only to NAME/LIST something? If so, REWRITE.
- DEPTH TEST (the bar most candidates miss): could the candidate fully answer by just NAMING a decision, metric, alternative, or owner? If yes, it is too shallow — REWRITE so answering REQUIRES reconstructing the reasoning, verification, tradeoff, failure, or collaboration boundary.
- FRAME TEST: do the 5 candidates sound like variations of the same sentence skeleton? If yes, rewrite until at least 4 followup_frame values are truly different in intent and surface syntax.
- OWNERSHIP TEST (conditional): if the selected frame is collaboration-ownership, does it reveal the candidate's concrete slice and influence rather than allowing "the team" as an escape? If another frame would reveal more new signal, switch frames.
- Count question_types — must be >=3 distinct, with >=4 distinct followup_frame values.
- For each candidate, find its anchor substring in the answer or resume. If even one fails, fix that candidate.
- If pivot=YES, count pivot-opening candidates — must be >=2.

Emit only the JSON object.`;
}

module.exports = { buildBlockD, DEFAULT_BODY };
