const test = require('node:test');
const assert = require('node:assert');

const { buildFollowUpQuestionPrompt } = require('../src/services/ai/interviewer-prompts');
const { buildBlockD } = require('../src/services/ai/interviewer-prompts/expert/block-d-question-pool');
const { buildBlockE } = require('../src/services/ai/interviewer-prompts/expert/block-e-rank-score');
const { buildBlockG } = require('../src/services/ai/interviewer-prompts/expert/block-g-final-render');
const { runPipeline } = require('../src/services/ai/pipeline/pipeline-engine');
const { EXPERT_PRESET, EXPERT_FAST_PRESET } = require('../src/services/ai/pipeline/presets');

const FAST_ARGS = {
  concreteHooks: ['async queue'],
  missingStar: 'A',
  recommendedDirection: 'technical-depth',
  candidateAnswer: 'We built an async queue to decouple workers.',
  questionHistory: [],
  resumeChunk: 'Backend engineer.',
  candidateEmotion: null
};

const BLOCK_D_ARGS = {
  blockAResult: { claims: [{ id: 'c1', claim_type: 'action', raw_span: 'async queue', value: 'built async queue' }] },
  blockBResult: { missing_evidence: [], overclaim_flags: [], contradictions: [] },
  blockCResult: { next_competency_target: 'technical-depth', should_pivot: false },
  candidateAnswer: 'We built an async queue to decouple workers.',
  resumeChunk: 'Backend engineer.',
  jobDescription: 'Backend reliability role.',
  questionHistory: []
};

const BLOCK_E_ARGS = {
  ...BLOCK_D_ARGS,
  blockDResult: {
    candidates: [
      { id: 'q1', question: "You said 'async queue' — walk me through the tradeoff.", anchors: ['async queue'] }
    ]
  }
};

const BLOCK_G_ARGS = {
  primaryCandidate: {
    id: 'q1',
    question: "You said 'async queue' — walk me through the tradeoff.",
    question_type: 'tradeoff-articulation',
    anchors: ['async queue'],
    expected_yield: 'tradeoff reasoning'
  },
  alternativeCandidate: null,
  blockBResult: { missing_evidence: [] },
  blockCResult: { next_competency_target: 'technical-depth' },
  safetyVerdict: 'pass',
  candidateAnswer: 'We built an async queue to decouple workers.',
  resumeChunk: 'Backend engineer.'
};

const CANNED_BLOCKS = {
  A: JSON.stringify({
    claims: [{ id: 'c1', raw_span: 'async queue', claim_type: 'action' }],
    star_coverage: { S: true, T: true, A: true, R: false },
    answer_quality_label: 'mixed',
    language_register: 'professional'
  }),
  B: JSON.stringify({ missing_evidence: [], overclaim_flags: [], contradictions: [] }),
  C: JSON.stringify({
    topic_just_drilled: 'queue design',
    next_competency_target: 'technical-depth',
    depth_remaining_on_current_topic: 'one-more',
    should_pivot: false,
    drilled_topics_after: []
  }),
  D: JSON.stringify({
    candidates: [
      { id: 'q1', question: "Walk me through 'async queue' tradeoff.", question_type: 'chain-of-decisions', anchors: ['async queue'], fills_evidence_gap: 'tradeoff-reasoning', expected_yield: 'reasoning' },
      { id: 'q2', question: "How did you verify 'async queue' worked?", question_type: 'tradeoff-articulation', anchors: ['async queue'], fills_evidence_gap: 'metric', expected_yield: 'verification' },
      { id: 'q3', question: "What failed first in 'async queue'?", question_type: 'failure-mode', anchors: ['async queue'], fills_evidence_gap: 'failure-handling', expected_yield: 'learning' },
      { id: 'q4', question: "What was your slice of 'async queue'?", question_type: 'action-attribution', anchors: ['async queue'], fills_evidence_gap: 'owner-of-action', expected_yield: 'ownership' },
      { id: 'q5', question: "What would you cut from 'async queue'?", question_type: 'counterfactual', anchors: ['async queue'], fills_evidence_gap: 'cost-awareness', expected_yield: 'priority' }
    ]
  }),
  E: JSON.stringify({
    ranked: [
      { id: 'q1', rubric: { depth: 5, ownership: 4, trait: 5, anchoring: 4, non_triviality: 5, usability: 4 }, total: 27, reasoning: 'reasoning' },
      { id: 'q2', rubric: { depth: 4, ownership: 4, trait: 4, anchoring: 4, non_triviality: 4, usability: 4 }, total: 24, reasoning: 'reasoning' },
      { id: 'q3', rubric: { depth: 4, ownership: 3, trait: 4, anchoring: 4, non_triviality: 4, usability: 4 }, total: 23, reasoning: 'reasoning' },
      { id: 'q4', rubric: { depth: 3, ownership: 5, trait: 3, anchoring: 4, non_triviality: 3, usability: 4 }, total: 22, reasoning: 'reasoning' },
      { id: 'q5', rubric: { depth: 4, ownership: 3, trait: 4, anchoring: 3, non_triviality: 4, usability: 4 }, total: 22, reasoning: 'reasoning' }
    ],
    top_2_ids: ['q1', 'q2']
  }),
  F: JSON.stringify({ verdict: 'pass', violations: [], regex_hits: [], soft_rule_findings: [] }),
  G: JSON.stringify({
    primary_question: 'Final question?',
    alternative_question: 'Alternative?',
    rationale_for_interviewer: 'Why',
    anchor_quotes: ['async queue'],
    expected_evidence_yield: 'Yield',
    iteration_version: 'test_v1'
  })
};

function detectBlock(prompt) {
  if (/You are the ANATOMY/.test(prompt)) return 'A';
  if (/You are the EVIDENCE-GAP/.test(prompt)) return 'B';
  if (/You are the QUESTION-POOL/.test(prompt)) return 'D';
  if (/You are the RANK-SCORE/.test(prompt)) return 'E';
  if (/You are the SAFETY-AUDIT/.test(prompt)) return 'F';
  if (/You are the FINAL-RENDER/.test(prompt)) return 'G';
  if (/depth_remaining_on_current_topic/.test(prompt)) return 'C';
  return '?';
}

function installPipelineStub(record) {
  const original = global.fetch;
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const prompt = body.messages[0].content;
    const block = detectBlock(prompt);
    if (block !== '?') {
      (record[block] = record[block] || []).push(prompt);
    }
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: CANNED_BLOCKS[block] || '{}' }], usage: { input_tokens: 1, output_tokens: 1 } })
    };
  };
  return () => {
    global.fetch = original;
  };
}

function assertZhDirective(prompt, label) {
  assert.ok(prompt.includes('OUTPUT LANGUAGE'), `${label}: language section present`);
  assert.ok(prompt.includes('Simplified Chinese') || prompt.includes('简体中文'), `${label}: Chinese target named`);
  assert.ok(prompt.includes('questions') || prompt.includes('question'), `${label}: question fields covered`);
  assert.ok(prompt.includes('rationale') || prompt.includes('reasoning'), `${label}: rationale/reasoning fields covered`);
}

function assertEnDirective(prompt, label) {
  assert.ok(prompt.includes('OUTPUT LANGUAGE'), `${label}: language section present`);
  assert.ok(prompt.includes('English'), `${label}: English target named`);
  assert.ok(prompt.includes('questions') || prompt.includes('question'), `${label}: question fields covered`);
  assert.ok(prompt.includes('rationale') || prompt.includes('reasoning'), `${label}: rationale/reasoning fields covered`);
}

test('Fast Stage 2 prompt forces Chinese or English when outputLanguage is selected', () => {
  const zh = buildFollowUpQuestionPrompt({ ...FAST_ARGS, outputLanguage: 'zh' });
  const en = buildFollowUpQuestionPrompt({ ...FAST_ARGS, outputLanguage: 'en' });
  const auto = buildFollowUpQuestionPrompt({ ...FAST_ARGS, outputLanguage: '' });

  assertZhDirective(zh, 'fast zh');
  assertEnDirective(en, 'fast en');
  assert.ok(!auto.includes('OUTPUT LANGUAGE'), 'auto keeps the old free-language behavior');
});

test('Expert Block D prompt forces generated candidates and expected yield into the selected language', () => {
  const zh = buildBlockD({ ...BLOCK_D_ARGS, outputLanguage: 'zh' });
  const en = buildBlockD({ ...BLOCK_D_ARGS, outputLanguage: 'en' });
  const auto = buildBlockD({ ...BLOCK_D_ARGS, outputLanguage: '' });

  assertZhDirective(zh, 'block D zh');
  assert.ok(zh.includes('expected_yield'), 'block D zh: expected_yield covered');
  assertEnDirective(en, 'block D en');
  assert.ok(en.includes('expected_yield'), 'block D en: expected_yield covered');
  assert.ok(!auto.includes('OUTPUT LANGUAGE'), 'auto keeps the old Block D behavior');
});

test('Expert Block E prompt forces rubric reasoning into the selected language', () => {
  const zh = buildBlockE({ ...BLOCK_E_ARGS, outputLanguage: 'zh' });
  const en = buildBlockE({ ...BLOCK_E_ARGS, outputLanguage: 'en' });
  const auto = buildBlockE({ ...BLOCK_E_ARGS, outputLanguage: '' });

  assertZhDirective(zh, 'block E zh');
  assertEnDirective(en, 'block E en');
  assert.ok(!auto.includes('OUTPUT LANGUAGE'), 'auto keeps the old Block E behavior');
});

test('Expert Block G prompt still forces all final visible fields into the selected language', () => {
  const zh = buildBlockG({ ...BLOCK_G_ARGS, outputLanguage: 'zh' });
  const en = buildBlockG({ ...BLOCK_G_ARGS, outputLanguage: 'en' });

  assertZhDirective(zh, 'block G zh');
  assert.ok(zh.includes('expected_evidence_yield'), 'block G zh: expected_evidence_yield covered');
  assertEnDirective(en, 'block G en');
  assert.ok(en.includes('expected_evidence_yield'), 'block G en: expected_evidence_yield covered');
});

test('Expert 1.0 and 2.0 pipeline presets thread outputLanguage into visible block prompts', async () => {
  const context = {
    candidateAnswer: 'We built an async queue to decouple workers.',
    resumeChunk: 'Backend engineer.',
    jobDescription: 'Backend reliability role.',
    questionHistory: [],
    outputLanguage: 'en'
  };

  const expert1 = {};
  let restore = installPipelineStub(expert1);
  try {
    await runPipeline({ pipeline: EXPERT_PRESET, apiKey: 'test', context });
  } finally {
    restore();
  }
  assertEnDirective(expert1.D[0], 'expert 1.0 block D');
  assertEnDirective(expert1.E[0], 'expert 1.0 block E');
  assertEnDirective(expert1.G[0], 'expert 1.0 block G');

  const expert2 = {};
  restore = installPipelineStub(expert2);
  try {
    await runPipeline({ pipeline: EXPERT_FAST_PRESET, apiKey: 'test', context });
  } finally {
    restore();
  }
  assertEnDirective(expert2.D[0], 'expert 2.0 block D');
  assert.equal(expert2.E, undefined, 'expert 2.0 intentionally has no Block E');
  assertEnDirective(expert2.G[0], 'expert 2.0 block G');
});
