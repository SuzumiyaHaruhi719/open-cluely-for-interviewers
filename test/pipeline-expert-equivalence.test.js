const test = require('node:test');
const assert = require('node:assert');

// Proves the generic pipeline engine, running the EXPERT_PRESET, reproduces the
// legacy hardcoded runExpertChain EXACTLY: identical per-block prompts (⇒ identical
// wiring + input threading), identical final output, identical fallback set, and
// the same 6-phase progress contract. Deterministic — fetch is stubbed.

const CANNED = {
  A: JSON.stringify({ claims: [{ id: 'c1', raw_span: 'async queue', claim_type: 'action' }], star_coverage: { S: true, T: true, A: true, R: false }, answer_quality_label: 'mixed', language_register: 'professional' }),
  B: JSON.stringify({ missing_evidence: [], overclaim_flags: [], contradictions: [] }),
  C: JSON.stringify({ topic_just_drilled: 't', next_competency_target: 'technical-depth', depth_remaining_on_current_topic: 'one-more', should_pivot: false, drilled_topics_after: [] }),
  D: JSON.stringify({ candidates: [
    { id: 'q1', question: "Walk me through 'async queue' — what alternative did you reject?", question_type: 'chain-of-decisions', anchors: ['async queue'], fills_evidence_gap: 'tradeoff-reasoning', expected_yield: 'reasoning' },
    { id: 'q2', question: "What tradeoff in the 'async queue' nearly broke?", question_type: 'tradeoff-articulation', anchors: ['async queue'], fills_evidence_gap: 'tradeoff-reasoning', expected_yield: 'cost' },
    { id: 'q3', question: "What did you get wrong first with the 'async queue'?", question_type: 'failure-mode', anchors: ['async queue'], fills_evidence_gap: 'failure-handling', expected_yield: 'lesson' },
    { id: 'q4', question: "Inside 'we', what was your call on the 'async queue'?", question_type: 'action-attribution', anchors: ['async queue'], fills_evidence_gap: 'owner-of-action', expected_yield: 'ownership' },
    { id: 'q5', question: "If half the time, what would you cut from the 'async queue'?", question_type: 'counterfactual', anchors: ['async queue'], fills_evidence_gap: 'tradeoff-reasoning', expected_yield: 'priority' }
  ] }),
  E: JSON.stringify({ ranked: [
    { id: 'q1', rubric: { depth: 5, ownership: 4, trait: 5, anchoring: 4, non_triviality: 5, usability: 4 }, total: 27, reasoning: 'r' },
    { id: 'q2', rubric: { depth: 4, ownership: 4, trait: 4, anchoring: 4, non_triviality: 4, usability: 4 }, total: 24, reasoning: 'r' },
    { id: 'q3', rubric: { depth: 4, ownership: 3, trait: 4, anchoring: 4, non_triviality: 4, usability: 4 }, total: 23, reasoning: 'r' },
    { id: 'q4', rubric: { depth: 3, ownership: 5, trait: 3, anchoring: 4, non_triviality: 3, usability: 4 }, total: 22, reasoning: 'r' },
    { id: 'q5', rubric: { depth: 4, ownership: 3, trait: 4, anchoring: 3, non_triviality: 4, usability: 4 }, total: 22, reasoning: 'r' }
  ], top_2_ids: ['q1', 'q2'] }),
  F: JSON.stringify({ verdict: 'pass', violations: [], regex_hits: [], soft_rule_findings: [] }),
  G: JSON.stringify({ primary_question: 'FINAL primary question?', alternative_question: 'alt?', rationale_for_interviewer: 'why', anchor_quotes: ['async queue'], expected_evidence_yield: 'yield', iteration_version: 'test_v1' })
};

function detectBlock(p) {
  if (/You are the ANATOMY/.test(p)) return 'A';
  if (/You are the EVIDENCE-GAP/.test(p)) return 'B';
  if (/You are the QUESTION-POOL/.test(p)) return 'D';
  if (/You are the RANK-SCORE/.test(p)) return 'E';
  if (/You are the SAFETY-AUDIT/.test(p)) return 'F';
  if (/You are the FINAL-RENDER/.test(p)) return 'G';
  if (/depth_remaining_on_current_topic/.test(p)) return 'C';
  return '?';
}

function installStub(record) {
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const prompt = body.messages[0].content;
    const block = detectBlock(prompt);
    if (block !== '?') { (record[block] = record[block] || []).push(prompt); }
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: CANNED[block] || '{}' }], usage: { input_tokens: 11, output_tokens: 22 } }) };
  };
}

const FIXTURE = {
  candidateAnswer: 'We introduced an async queue and p99 latency dropped a lot.',
  resumeChunk: 'Staff engineer. Led payments migration.',
  jobDescription: 'Backend role owning reliability.',
  questionHistory: ['Tell me about a recent project you owned.'],
  sessionState: { drilled_topics: ['scope'], current_competency_target: 'technical-depth', elapsed_minutes: 10 }
};

test('engine EXPERT_PRESET reproduces legacy runExpertChain prompts + output', async () => {
  const { runExpertChainLegacy } = require('../src/main-process/features/interviewer/expert-orchestrator');
  const { runPipeline } = require('../src/services/ai/pipeline/pipeline-engine');
  const { EXPERT_PRESET } = require('../src/services/ai/pipeline/presets');

  const legacyRec = {};
  installStub(legacyRec);
  const legacy = await runExpertChainLegacy({ apiKey: 'test', ...FIXTURE });

  const engineRec = {};
  const phases = [];
  installStub(engineRec);
  const engine = await runPipeline({
    pipeline: EXPERT_PRESET, apiKey: 'test', context: FIXTURE,
    onProgress: (e) => phases.push(`${e.phase}:${e.status}`)
  });

  // 1. Per-block prompts identical (⇒ identical wiring + input threading).
  for (const b of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    assert.ok(legacyRec[b] && legacyRec[b][0], `legacy produced a prompt for block ${b}`);
    assert.ok(engineRec[b] && engineRec[b][0], `engine produced a prompt for block ${b}`);
    assert.strictEqual(engineRec[b][0], legacyRec[b][0], `block ${b} prompt must be byte-identical`);
  }

  // 2. Identical final output.
  assert.deepStrictEqual(engine.output, legacy.output);

  // 3. Identical fallback set (both empty here).
  assert.deepStrictEqual(engine.fallbackTriggered.slice().sort(), (legacy.fallbackTriggered || []).slice().sort());

  // 4. 6-phase progress contract, in order.
  assert.deepStrictEqual(phases, ['answer:start', 'answer:done', 'gaps:start', 'gaps:done', 'pool:start', 'pool:done', 'rank:start', 'rank:done', 'safety:start', 'safety:done', 'render:start', 'render:done']);
});
