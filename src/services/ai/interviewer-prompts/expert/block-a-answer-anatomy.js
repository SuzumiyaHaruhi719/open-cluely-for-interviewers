// Block A · Answer Anatomy
// Goal: extract verifiable claims with raw_span anchoring so downstream blocks
// can cite exact substrings. raw_span is a contiguous substring of the
// candidate_last_answer field — never paraphrased, never the resume. Block B
// will reject claims whose raw_span is not a literal substring of the input,
// so the prompt is unambiguous about the anchor rule.

const { CLAIM_TYPES, ANSWER_QUALITY_LABELS } = require('../schemas');

function asJsonList(arr) {
  return arr.map((v) => `"${v}"`).join(' | ');
}

function buildBlockA({ candidateAnswer = '', resumeChunk = '', questionHistory = [], sessionState = null } = {}) {
  const history = Array.isArray(questionHistory) && questionHistory.length
    ? questionHistory.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : (q?.q || '')}`).join('\n')
    : '(no prior questions)';

  const stateLine = sessionState && typeof sessionState === 'object'
    ? `current_competency_target=${sessionState.current_competency_target || 'unspecified'}; drilled_topics=${(sessionState.drilled_topics || []).join(' | ') || '(none)'}`
    : '(no session state)';

  return `Role: You are the ANATOMY block of a 7-block interviewer copilot. You decompose a candidate's spoken answer into atomic, anchored claims so later blocks can probe gaps. You DO NOT generate questions.

Your one job: every claim you emit must point to a contiguous substring of the candidate's most recent answer via raw_span. raw_span MUST be present verbatim in the answer text below — same characters, same order, no paraphrase, no translation, no resume text.

[Candidate's most recent answer — raw_span MUST be a contiguous substring of this block, character for character]
\`\`\`
${candidateAnswer}
\`\`\`

[Resume excerpt — for context only. NEVER use as raw_span source.]
\`\`\`
${resumeChunk || '(no resume excerpt)'}
\`\`\`

[Prior questions in this interview — oldest first]
${history}

[Session state]
${stateLine}

Required output — strict JSON only, no markdown fences, no prose.
{
  "claims": [
    {
      "id": "c1",
      "raw_span": "<contiguous substring of the candidate answer above>",
      "claim_type": ${asJsonList(CLAIM_TYPES)},
      "subject": "<the project, system, person, or metric the claim is about>",
      "value": "<the asserted value: a number, a name, an action verb, etc.>"
    }
  ],
  "star_coverage": { "S": <bool>, "T": <bool>, "A": <bool>, "R": <bool> },
  "answer_quality_label": ${asJsonList(ANSWER_QUALITY_LABELS)},
  "language_register": "<professional | casual | defensive | nervous | hostile | rambling>"
}

Hard rules — violations cause Block B to reject your output and trigger a single repair pass:
1. EVERY raw_span MUST appear literally in the candidate answer. Quote, don't paraphrase. If you can't find a substring you'd anchor on, return claims=[] for that hole — never invent one.
2. Cover ALL substantive claims: metrics, named tools, owners-of-action ("I" vs "we"), timelines, outcomes, opinions. Aim for 3-8 claims for a real answer; 0-2 for a non-answer (silent, off-topic, single-word). Do NOT split one claim into many to inflate count.
3. claim_type "team-attribution" is used ONLY when the candidate said "we" or "the team" — the value field captures who actually did the work as the candidate stated it ("we shipped" → value: "we"; "the team built but I led" → value: "I led, team built").
4. star_coverage is per-element-presence in this single answer. S=situation given, T=task given, A=action given, R=result given. Be strict — vague gestures don't count.
5. answer_quality_label is your honest read. "concrete" requires at least one anchored metric/name; "evasive" means the candidate dodged the question; "over-packaged" means polished but content-empty.

Self-check before emitting (do this silently, do NOT include in output):
- For each claim, find its raw_span as a literal substring in the answer. If even one fails, drop or fix that claim.
- If the answer is empty or under 10 words, emit claims=[] and answer_quality_label="silent-then-recovered" or "off-topic" as appropriate.

Emit only the JSON object. No commentary. No markdown.`;
}

module.exports = { buildBlockA };
