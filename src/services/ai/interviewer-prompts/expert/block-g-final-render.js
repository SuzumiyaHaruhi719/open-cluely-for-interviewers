// Block G · Final Render
// Pure template — assembles the renderer-facing payload. Runs on Flash with a
// near-deterministic temperature because there is no creative content to add.
// If Block F's verdict was "rewrite", G is asked to rephrase neutrally; if
// "block", G drops to the alternative candidate (orchestrator handles this
// before calling G, but G's prompt still allows for a graceful rephrase).
//
// G is the ONLY block whose JSON is shown to the interviewer. All upstream
// blocks are internal.

const EXPERT_ITERATION_VERSION = 'expert_v1_2026-05-29';

function buildBlockG({
  primaryCandidate = null,
  alternativeCandidate = null,
  blockBResult = null,
  blockCResult = null,
  safetyVerdict = 'pass',
  candidateAnswer = '',
  resumeChunk = ''
} = {}) {
  const primary = primaryCandidate || { question: '(no primary candidate)', anchors: [], expected_yield: '', question_type: 'unknown' };
  const alt = alternativeCandidate || null;

  const gapsTop = (blockBResult?.missing_evidence || []).slice(0, 3)
    .map((g, i) => `${i + 1}. ${g.competency} / ${g.evidence_type}`)
    .join('; ') || '(no specific gap)';

  const nextComp = blockCResult?.next_competency_target || 'technical-depth';
  const rewriteHint = safetyVerdict === 'rewrite'
    ? 'IMPORTANT: Safety Audit flagged this question for rewrite — rephrase to remove leading/unprofessional framing while preserving the anchor and the demanded evidence.'
    : '';

  return `Role: You are the FINAL-RENDER block — pure template. You take the chosen primary question (and optional alternative) and emit the interviewer-facing JSON. No new content. No new analysis. ${rewriteHint}

[Primary candidate selected by ranker]
question: ${primary.question}
type: ${primary.question_type}
anchors: ${JSON.stringify(primary.anchors || [])}
expected_yield: ${primary.expected_yield}

[Alternative candidate (optional)]
${alt ? `question: ${alt.question}\ntype: ${alt.question_type}\nanchors: ${JSON.stringify(alt.anchors || [])}\nexpected_yield: ${alt.expected_yield}` : '(none)'}

[Block B top gaps — for the rationale_for_interviewer line]
${gapsTop}

[Block C next competency target]
${nextComp}

[Candidate answer — for the anchor verbatim check]
\`\`\`
${candidateAnswer}
\`\`\`

[Resume excerpt — for the anchor verbatim check]
\`\`\`
${resumeChunk || '(no resume excerpt)'}
\`\`\`

Required output — strict JSON only.
{
  "primary_question": "<the primary candidate's question, verbatim — unless safety_verdict='rewrite' in which case rephrase to neutral framing while preserving anchors>",
  "alternative_question": "<the alternative candidate's question, verbatim — or empty string if none>",
  "rationale_for_interviewer": "<ONE sentence teaching the interviewer what this question REVEALS about the candidate — e.g. 'This probes ${nextComp}: by forcing them to name the alternative they rejected, you learn whether the redesign reflected real judgment or luck.' Focus on the judgment/trait surfaced, NOT on extracting a datum.>",
  "anchor_quotes": ["<each substring quoted in primary_question, verbatim>"],
  "expected_evidence_yield": "<the primary candidate's expected_yield, copied verbatim>",
  "iteration_version": "${EXPERT_ITERATION_VERSION}"
}

Hard rules:
1. Do NOT add new content, anchors, or rationales. The only freedom you have is rephrasing under safety_verdict='rewrite'.
2. anchor_quotes must list the substrings actually present in primary_question, in order.
3. iteration_version must be exactly "${EXPERT_ITERATION_VERSION}".
4. If primaryCandidate is missing (orchestrator fallback case), emit primary_question="(no question available — Expert mode fallback to Fast mode)" with empty anchors and a rationale stating the fallback. The orchestrator handles the actual fallback to Fast mode; this branch is the schema-compliant placeholder.

Emit only the JSON object.`;
}

module.exports = { buildBlockG, EXPERT_ITERATION_VERSION };
