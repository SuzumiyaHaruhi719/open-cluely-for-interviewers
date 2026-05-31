const test = require('node:test');
const assert = require('node:assert');

const { summarizeExpertRun } = require('../src/main-process/features/interviewer/expert-run-logger');

// A representative trace: B repaired once (2 attempts), E fell back.
const TRACE = [
  { block: 'A', attempt: 1, ms: 1200, ok: true, model: 'deepseek-v4-flash', usage: { input_tokens: 850, output_tokens: 420 } },
  { block: 'C', attempt: 1, ms: 950, ok: true, model: 'deepseek-v4-flash', usage: { input_tokens: 700, output_tokens: 210 } },
  { block: 'B', attempt: 1, ms: 1100, ok: false, errors: ['bad'], model: 'deepseek-v4-flash', usage: { input_tokens: 900, output_tokens: 380 } },
  { block: 'B', attempt: 2, ms: 600, ok: true, model: 'deepseek-v4-flash', usage: { input_tokens: 950, output_tokens: 300 }, repair: true },
  { block: 'D', attempt: 1, ms: 1800, ok: true, model: 'deepseek-v4-flash', usage: { input_tokens: 1200, output_tokens: 650 } },
  { block: 'E', attempt: 1, ms: 15000, ok: false, errors: ['timeout'], model: 'deepseek-v4-pro', usage: null },
  { block: 'F', attempt: 1, ms: 800, ok: true, model: 'deepseek-v4-flash', usage: { input_tokens: 300, output_tokens: 80 } },
  { block: 'G', attempt: 1, ms: 900, ok: true, model: 'deepseek-v4-flash', usage: { input_tokens: 500, output_tokens: 200 } }
];

test('summarizes per-block model, purpose, duration, ok, attempts, tokens', () => {
  const { record, text } = summarizeExpertRun({
    requestId: '3',
    trace: TRACE,
    fallbackTriggered: ['E'],
    elapsedMs: 23456
  });

  assert.strictEqual(record.requestId, '3');
  assert.strictEqual(record.elapsedMs, 23456);
  assert.deepStrictEqual(record.fallbackTriggered, ['E']);

  // Blocks reported in logical A..G order.
  assert.deepStrictEqual(record.blocks.map((b) => b.block), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);

  const byId = Object.fromEntries(record.blocks.map((b) => [b.block, b]));
  assert.strictEqual(byId.A.purpose, 'answer-anatomy');
  assert.strictEqual(byId.A.model, 'deepseek-v4-flash');
  assert.strictEqual(byId.A.ms, 1200);
  assert.strictEqual(byId.A.ok, true);
  assert.strictEqual(byId.A.attempts, 1);

  // B aggregates both attempts: ms summed, final ok = true, attempts = 2.
  assert.strictEqual(byId.B.ms, 1700);
  assert.strictEqual(byId.B.attempts, 2);
  assert.strictEqual(byId.B.ok, true);
  assert.strictEqual(byId.B.inputTokens, 1850);
  assert.strictEqual(byId.B.outputTokens, 680);

  // E used the Pro model, fell back, null usage tolerated.
  assert.strictEqual(byId.E.model, 'deepseek-v4-pro');
  assert.strictEqual(byId.E.fallback, true);
  assert.strictEqual(byId.E.ok, false);
  assert.strictEqual(byId.E.inputTokens, 0);

  // text is a non-empty human-readable summary mentioning the request + a block.
  assert.match(text, /req#3/);
  assert.match(text, /rank-score/);
  assert.match(text, /deepseek-v4-pro/);
});

test('tolerates empty trace without throwing', () => {
  const { record, text } = summarizeExpertRun({ requestId: null, trace: [], fallbackTriggered: [], elapsedMs: 0 });
  assert.strictEqual(record.blocks.length, 0);
  assert.ok(typeof text === 'string');
});
