const test = require('node:test');
const assert = require('node:assert');

// Fast mode Stage-2 (follow-up generator) OPTIONAL question-bank grounding.
// Mirrors the Block D guard: with no bankQuestions the prompt is byte-identical
// to today; with bankQuestions a single grounding section appears (capped +
// truncated) as direction hints only — Stage 2 must still anchor on the answer.

const { buildFollowUpQuestionPrompt } = require('../src/services/ai/interviewer-prompts');

const GROUNDING_HEADER = '参考：该领域真实高频面试题';

const FIXED_ARGS = {
  concreteHooks: ['async queue', 'p99 latency'],
  missingStar: 'A',
  recommendedDirection: 'technical-depth',
  candidateAnswer: 'We built an async queue and p99 latency dropped a lot.',
  questionHistory: ['Tell me about a project you owned.'],
  resumeChunk: 'Staff engineer.',
  candidateEmotion: null
};

test('buildFollowUpQuestionPrompt injects the grounding header + questions when bankQuestions provided', () => {
  const out = buildFollowUpQuestionPrompt({ ...FIXED_ARGS, bankQuestions: ['Q1 design a rate limiter', 'Q2 explain consistent hashing'] });

  assert.ok(out.includes(GROUNDING_HEADER), 'grounding header present');
  assert.ok(out.includes('Q1 design a rate limiter'), 'first bank question present');
  assert.ok(out.includes('Q2 explain consistent hashing'), 'second bank question present');
  // Rendered as a numbered list.
  assert.ok(/1\. Q1 design a rate limiter/.test(out), 'questions numbered');
  // Grounding sits before the output instruction (direction hints precede the JSON contract).
  assert.ok(out.indexOf(GROUNDING_HEADER) < out.indexOf('Output strict JSON only'), 'grounding precedes output instruction');
});

test('buildFollowUpQuestionPrompt WITHOUT bankQuestions has no grounding header', () => {
  const noArg = buildFollowUpQuestionPrompt(FIXED_ARGS);
  const emptyArr = buildFollowUpQuestionPrompt({ ...FIXED_ARGS, bankQuestions: [] });

  assert.ok(!noArg.includes(GROUNDING_HEADER), 'no header when bankQuestions absent');
  assert.ok(!emptyArr.includes(GROUNDING_HEADER), 'no header when bankQuestions empty');
});

test('buildFollowUpQuestionPrompt with empty bankQuestions is byte-identical to the no-arg call', () => {
  // Regression guard: the default (no grounding) prompt must not change at all,
  // so the Fast prompt change can never affect existing behavior.
  const baseline = buildFollowUpQuestionPrompt(FIXED_ARGS);
  const emptyArr = buildFollowUpQuestionPrompt({ ...FIXED_ARGS, bankQuestions: [] });
  const explicitUndefined = buildFollowUpQuestionPrompt({ ...FIXED_ARGS, bankQuestions: undefined });

  assert.strictEqual(emptyArr, baseline, 'empty array == no-arg');
  assert.strictEqual(explicitUndefined, baseline, 'undefined == no-arg');
});

test('buildFollowUpQuestionPrompt caps the bank list at 8 and truncates each to ~160 chars', () => {
  const many = Array.from({ length: 20 }, (_v, i) => `bank question number ${i + 1}`);
  const longQ = 'X'.repeat(400);
  const out = buildFollowUpQuestionPrompt({ ...FIXED_ARGS, bankQuestions: [longQ, ...many] });

  // Only 8 items: the list reaches "8." but never "9.".
  assert.ok(/\n8\. /.test(out), 'has an 8th item');
  assert.ok(!/\n9\. /.test(out), 'does not exceed 8 items');
  // The 400-char question is truncated (the full 400-char run must not appear).
  assert.ok(!out.includes('X'.repeat(400)), 'over-long question truncated');
  assert.ok(out.includes('X'.repeat(160)), 'truncated to the 160-char budget');
});
