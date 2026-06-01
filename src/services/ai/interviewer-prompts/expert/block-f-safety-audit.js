// Block F · Safety Audit
// Two-layer audit:
//   Layer 1 (hard, regex) — runs in code before the LLM call. Catches
//     personal-protected-attr keywords, legally sensitive phrasings, and
//     hostile-tone tokens. Hard hits set verdict="block" immediately.
//   Layer 2 (soft, Flash LLM) — judges leading framing, condescension,
//     irrelevance-to-role, and private-personal-life probing. May escalate
//     to "rewrite" or "block".
//
// The orchestrator runs the regex first, then asks the LLM with the regex
// findings pre-loaded into the prompt. The LLM's job is to (a) confirm
// regex hits as real violations, (b) catch soft violations regex misses.

const { SAFETY_RULES, SAFETY_VERDICTS } = require('../schemas');

// Regex catalog — keep these conservative so we don't drown the system in
// false positives. Hits are surfaced to the LLM for confirmation rather than
// auto-blocked, except for the explicit-slur class which is always block.
const HARD_RULE_PATTERNS = [
  { rule: 'personal-protected-attr', pattern: /\b(married|spouse|kids|children|pregnan|religion|church|mosque|temple|disability|disabled|nationality|citizenship)\b/i },
  { rule: 'private-personal-life', pattern: /\b(dating|girlfriend|boyfriend|home address|where do you live)\b/i },
  { rule: 'legally-sensitive', pattern: /\b(criminal record|arrested|conviction|deportation|visa status)\b/i },
  { rule: 'hostile-tone', pattern: /\b(stupid|idiot|incompeten|liar|lying|nonsense|bullshit)\b/i },
  { rule: 'harassment', pattern: /\b(attractive|sexy|cute|hot|looks like|appearance)\b/i }
];

function runHardRules(question) {
  const text = String(question || '');
  const hits = [];
  for (const { rule, pattern } of HARD_RULE_PATTERNS) {
    const match = text.match(pattern);
    if (match) hits.push({ rule, evidence: match[0], span: match.index });
  }
  return hits;
}

function asJsonList(arr) {
  return arr.map((v) => `"${v}"`).join(' | ');
}

const DEFAULT_BODY = `Role: You are the SAFETY-AUDIT block. Two layers run on this audit: regex (already done — see findings below) and you (the soft-rule LLM). Your job: (a) confirm regex hits are real violations or downgrade them if context exonerates them; (b) catch soft violations regex misses (leading framing, condescension, irrelevance to role, private-personal-life probing without explicit keyword).`;

function buildBlockF({ candidateQuestions = [], regexHits = [], jobDescription = '', promptBody = null } = {}) {
  // candidateQuestions is the top-2 selected by Block E, in order
  const qStr = candidateQuestions.length
    ? candidateQuestions.map((q, i) => `${i + 1}. id=${q.id || `q${i + 1}`} type=${q.question_type || 'unknown'}\n   Q: ${q.question}`).join('\n\n')
    : '(no questions to audit)';

  const regexStr = regexHits.length
    ? regexHits.map((h, i) => `${i + 1}. rule=${h.rule} evidence="${h.evidence}"`).join('\n')
    : '(no regex hits)';

  return `${promptBody || DEFAULT_BODY}

[Job description — defines what is on-topic vs. irrelevant]
\`\`\`
${jobDescription || '(no JD)'}
\`\`\`

[Top-2 interview questions to audit]
${qStr}

[Regex hits from Layer 1 — confirm or exonerate]
${regexStr}

Required output — strict JSON only.
{
  "verdict": ${asJsonList(SAFETY_VERDICTS)},
  "violations": [
    {
      "rule": ${asJsonList(SAFETY_RULES)},
      "evidence": "<exact substring from the question that triggered>",
      "severity": "<info|warn|block>"
    }
  ],
  "regex_hits": ${JSON.stringify(regexHits.map((h) => h.rule))},
  "soft_rule_findings": [
    {
      "rule": "<one of: leading, condescension, irrelevant-to-role, private-personal-life, unprofessional>",
      "evidence": "<exact substring>"
    }
  ]
}

Verdict rules:
- "block": any violation with severity="block", OR any regex hit confirmed as a real protected-attribute / harassment / legally-sensitive probe.
- "rewrite": at least one violation with severity="warn" (leading framing, unprofessional phrasing, slightly off-topic) but no block-level issue. Downstream Block G will rephrase.
- "pass": no violations, no soft-rule findings. Empty violations + empty soft_rule_findings.

Soft-rule definitions:
- leading: question telegraphs the expected answer ("don't you think X is true?"). The remedy is neutral framing.
- condescension: tone treats the candidate as junior or ignorant when they are senior or expert per the JD/resume. (e.g. "do you know what a database index is?" to a Staff engineer.)
- irrelevant-to-role: question is off-topic relative to JD. (e.g. asking a backend role about UI animations without a real tie-in.)
- private-personal-life: question probes outside-of-work life without business justification.
- unprofessional: profanity, sarcasm, aggressive phrasing.

Regex confirmation rules:
- If regex hit on "married/kids/etc." but the question is a benign use ("how married is the candidate to this technical approach"), downgrade by NOT including the rule in violations and listing it in soft_rule_findings with rule="leading" or "unprofessional" if appropriate, otherwise simply omit. (regex_hits still echoes the original raw hit list — that field is a trace, not a verdict.)
- If regex hit AND the context confirms (e.g. "are you married" literally), include in violations with severity="block".

Emit only the JSON object.`;
}

module.exports = { buildBlockF, runHardRules, DEFAULT_BODY };
