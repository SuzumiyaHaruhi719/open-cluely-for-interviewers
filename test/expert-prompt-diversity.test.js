const test = require('node:test');
const assert = require('node:assert');

const { buildFollowUpQuestionPrompt } = require('../src/services/ai/interviewer-prompts');
const { buildBlockD } = require('../src/services/ai/interviewer-prompts/expert/block-d-question-pool');
const { buildBlockE } = require('../src/services/ai/interviewer-prompts/expert/block-e-rank-score');

const FIXED_ARGS = {
  candidateAnswer: '我们把五分钟轮询改成消息队列，后来又加了幂等写入和告警。',
  resumeChunk: 'Built reliable order status synchronization.',
  jobDescription: 'Senior backend engineer',
  questionHistory: []
};

test('Fast follow-up prompt rewards varied evidence frames instead of fact-pin monoculture', () => {
  const prompt = buildFollowUpQuestionPrompt({
    concreteHooks: ['我们把五分钟轮询改成消息队列', '后来又加了幂等写入和告警'],
    missingStar: 'A',
    recommendedDirection: 'technical-depth',
    candidateAnswer: FIXED_ARGS.candidateAnswer,
    questionHistory: []
  });

  assert.ok(prompt.includes('EVIDENCE FRAME MIX'), 'Fast should explicitly offer multiple follow-up frames');
  assert.ok(prompt.includes('diagnostic/root-cause'), 'Fast should allow diagnostic reasoning as a first-class frame');
  assert.ok(prompt.includes('tradeoff/alternative'), 'Fast should allow tradeoff reasoning as a first-class frame');
  assert.ok(prompt.includes('failure/learning'), 'Fast should allow failure-learning as a first-class frame');
  assert.ok(prompt.includes('Do not make priority-1 default to a number/date/name pin'), 'Fast should demote fact pins by default');
  assert.ok(!prompt.includes('Hard demand on priority-1 question — MUST ask for ONE of these and ONLY these'));
  assert.ok(!prompt.includes('Forbidden framings (these invite qualitative dodges)'));
  assert.ok(!prompt.includes('"how did you decide"'));
});

test('Block D asks for diverse follow-up frames instead of mandatory ownership template', () => {
  const prompt = buildBlockD(FIXED_ARGS);

  assert.ok(prompt.includes('FOLLOW-UP FRAME DIVERSITY'), 'D should have an explicit frame-diversity section');
  assert.ok(prompt.includes('SURFACE FORM DIVERSITY'), 'D should guard against repeated sentence skeletons');
  assert.ok(
    prompt.includes('q1 and q2 must use different openings and different sentence skeletons'),
    'D should make the visible top pair differ in surface form'
  );
  for (const frame of [
    'diagnostic-debug',
    'evidence-verification',
    'tradeoff-alternative',
    'failure-learning',
    'collaboration-ownership'
  ]) {
    assert.ok(prompt.includes(frame), `D should name follow-up frame: ${frame}`);
  }

  assert.ok(prompt.includes('Ownership is conditional'), 'D should make ownership conditional, not mandatory');
  assert.ok(
    prompt.includes('Do NOT make every question start by quoting the anchor'),
    'D should prevent fixed quote-first syntax'
  );
  assert.ok(
    !prompt.includes('PERSONAL OWNERSHIP IS MANDATORY ON EVERY CANDIDATE'),
    'D must not keep the old ownership monoculture rule'
  );
  assert.ok(
    !prompt.includes('Open by quoting the anchor'),
    'D must not keep the old quote-first style rule'
  );
  assert.ok(
    !prompt.includes('ORDER BEST-FIRST: candidate 1 (id "q1") MUST be the best next question'),
    'D should not over-optimize q1 into a repeated best-first template'
  );
});

test('Block E ranks for novelty and frame diversity instead of ownership monoculture', () => {
  const prompt = buildBlockE({
    ...FIXED_ARGS,
    blockDResult: {
      candidates: [
        { id: 'q1', question: "你说'消息队列'，怎么定位根因?", question_type: 'chain-of-decisions' },
        { id: 'q2', question: "你说'幂等写入'，怎么验证它有效?", question_type: 'metric-pin' },
        { id: 'q3', question: "你说'五分钟轮询'，还考虑过什么方案?", question_type: 'tradeoff-articulation' },
        { id: 'q4', question: "你说'告警'，哪次判断后来错了?", question_type: 'failure-mode' },
        { id: 'q5', question: "你说'我们'，你个人负责哪段?", question_type: 'action-attribution' }
      ]
    }
  });

  assert.ok(prompt.includes('novelty'), 'E should score novelty / information gain');
  assert.ok(prompt.includes('frame_diversity'), 'E should score style/frame diversity');
  assert.ok(prompt.includes('top_2_ids MUST use two different followup_frame values'), 'E should require top-2 frame diversity');
  assert.ok(prompt.includes('top_2_ids MUST NOT share the same surface skeleton'), 'E should require top-2 surface diversity');
  assert.ok(prompt.includes('Do not let ownership framing win by default'), 'E should demote ownership-by-default');
  assert.ok(!prompt.includes('OWNERSHIP is weighted equally'), 'E must not keep the old ownership-weight rule');
  assert.ok(
    !prompt.includes('beats one that merely demands deep reasoning'),
    'E must not tell the ranker to prefer ownership over deeper non-ownership questions'
  );
});
