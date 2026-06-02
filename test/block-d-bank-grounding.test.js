const test = require('node:test');
const assert = require('node:assert');

// Block D's OPTIONAL question-bank grounding. The hard invariant: with no
// bankQuestions the prompt is byte-identical to today (this is what keeps the
// equivalence + prompt-body tests green); with bankQuestions a single grounding
// section appears, capped + truncated, as direction hints only.

const { buildBlockD } = require('../src/services/ai/interviewer-prompts/expert/block-d-question-pool');

const GROUNDING_HEADER = 'REAL HIGH-FREQUENCY INTERVIEW QUESTIONS IN THIS AREA';

const FIXED_ARGS = {
  blockAResult: { claims: [{ id: 'c1', claim_type: 'action', raw_span: 'async queue', value: '' }] },
  blockBResult: { missing_evidence: [], overclaim_flags: [], contradictions: [] },
  blockCResult: { next_competency_target: 'technical-depth', should_pivot: false },
  candidateAnswer: 'We built an async queue to decouple the workers.',
  resumeChunk: 'Staff engineer.',
  jobDescription: 'Backend reliability role.',
  questionHistory: ['Tell me about a project you owned.']
};

test('buildBlockD injects the grounding header + questions when bankQuestions provided', () => {
  const out = buildBlockD({ ...FIXED_ARGS, bankQuestions: ['Q1 design a rate limiter', 'Q2 explain consistent hashing'] });

  assert.ok(out.includes(GROUNDING_HEADER), 'grounding header present');
  assert.ok(out.includes('Q1 design a rate limiter'), 'first bank question present');
  assert.ok(out.includes('Q2 explain consistent hashing'), 'second bank question present');
  // Rendered as a numbered list.
  assert.ok(/1\. Q1 design a rate limiter/.test(out), 'questions numbered');
  // Grounding sits before the candidate-answer section (direction hints precede generation input).
  assert.ok(out.indexOf(GROUNDING_HEADER) < out.indexOf('[Candidate answer'), 'grounding precedes candidate answer');
});

test('buildBlockD WITHOUT bankQuestions has no grounding header', () => {
  const noArg = buildBlockD(FIXED_ARGS);
  const emptyArr = buildBlockD({ ...FIXED_ARGS, bankQuestions: [] });

  assert.ok(!noArg.includes(GROUNDING_HEADER), 'no header when bankQuestions absent');
  assert.ok(!emptyArr.includes(GROUNDING_HEADER), 'no header when bankQuestions empty');
});

test('buildBlockD with empty bankQuestions is byte-identical to the no-arg call', () => {
  // This is the regression guard mirroring the equivalence test's expectation:
  // the default (no grounding) prompt must not change at all.
  const baseline = buildBlockD(FIXED_ARGS);
  const emptyArr = buildBlockD({ ...FIXED_ARGS, bankQuestions: [] });
  const explicitUndefined = buildBlockD({ ...FIXED_ARGS, bankQuestions: undefined });

  assert.strictEqual(emptyArr, baseline, 'empty array == no-arg');
  assert.strictEqual(explicitUndefined, baseline, 'undefined == no-arg');
});

test('buildBlockD caps the bank list at 8 and truncates each to ~160 chars', () => {
  const many = Array.from({ length: 20 }, (_v, i) => `bank question number ${i + 1}`);
  const longQ = 'X'.repeat(400);
  const out = buildBlockD({ ...FIXED_ARGS, bankQuestions: [longQ, ...many] });

  // Only 8 items: the list ends at "8." and never reaches "9.".
  assert.ok(/\n8\. /.test(out), 'has an 8th item');
  assert.ok(!/\n9\. /.test(out), 'does not exceed 8 items');
  // The 400-char question is truncated (the full 400-char run must not appear).
  assert.ok(!out.includes('X'.repeat(400)), 'over-long question truncated');
  assert.ok(out.includes('X'.repeat(160)), 'truncated to the 160-char budget');
});
