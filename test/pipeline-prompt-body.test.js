const test = require('node:test');
const assert = require('node:assert');

// The frame/body split: a custom promptBody replaces ONLY the instruction body;
// the input injection + output JSON schema + hard rules (the frame) stay intact,
// so a customized block still emits the validated shape.

const { buildBlockD } = require('../src/services/ai/interviewer-prompts/expert/block-d-question-pool');
const { buildBlockE } = require('../src/services/ai/interviewer-prompts/expert/block-e-rank-score');

test('promptBody overrides the body but keeps the frame', () => {
  const args = { candidateAnswer: 'we shipped X', resumeChunk: 'r', jobDescription: 'jd', questionHistory: [] };

  const def = buildBlockD(args);
  const custom = buildBlockD({ ...args, promptBody: 'CUSTOM-ROLE: ask only about leadership.' });

  // Body changed.
  assert.ok(def.includes('THE MISSION'), 'default contains the default mission');
  assert.ok(custom.includes('CUSTOM-ROLE: ask only about leadership.'), 'custom body present');
  assert.ok(!custom.includes('THE MISSION'), 'default mission replaced by custom body');

  // Frame preserved (input injection + output schema markers + hard rules).
  for (const marker of ['[Block A claims]', '"candidates"', 'question_type', 'Hard rules', 'EXACTLY 5 candidates']) {
    assert.ok(custom.includes(marker), `frame marker preserved: ${marker}`);
  }
});

test('promptBody is per-block (E frame intact too)', () => {
  const args = { candidateAnswer: 'a', resumeChunk: 'r', jobDescription: 'jd', questionHistory: [] };
  const custom = buildBlockE({ ...args, promptBody: 'CUSTOM RANKER.' });
  assert.ok(custom.includes('CUSTOM RANKER.'));
  for (const marker of ['"ranked"', 'top_2_ids', 'depth', 'non_triviality']) {
    assert.ok(custom.includes(marker), `E frame marker preserved: ${marker}`);
  }
});
