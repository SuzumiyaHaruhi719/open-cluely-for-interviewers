const test = require('node:test');
const assert = require('node:assert');

// Stub global.fetch BEFORE requiring the orchestrator so dashscopeChat uses it.
// Returning `{}` makes every block fail schema validation → repair → fallback.
// Progress must still advance through all 6 phases regardless of block success.
function stubFetchAlways(text) {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }], usage: null, model: 'stub' })
  });
}

const { runExpertChain } = require('../src/main-process/features/interviewer/expert-orchestrator');

const EXPECTED_PHASES = ['answer', 'gaps', 'pool', 'rank', 'safety', 'render'];

test('emits start+done for all 6 phases in order, even when blocks fall back', async () => {
  stubFetchAlways('{}');
  const events = [];
  await runExpertChain({
    apiKey: 'test-key',
    candidateAnswer: 'I led the migration and cut latency a lot.',
    onProgress: (e) => events.push(e)
  });

  // Each phase fires exactly one 'start' then one 'done', in declared order.
  const starts = events.filter((e) => e.status === 'start').map((e) => e.phase);
  const dones = events.filter((e) => e.status === 'done').map((e) => e.phase);
  assert.deepStrictEqual(starts, EXPECTED_PHASES);
  assert.deepStrictEqual(dones, EXPECTED_PHASES);

  // index/total are consistent.
  for (const e of events) {
    assert.strictEqual(e.total, 6);
    assert.strictEqual(e.index, EXPECTED_PHASES.indexOf(e.phase) + 1);
  }

  // 'start' of phase N precedes 'done' of phase N precedes 'start' of phase N+1.
  const seq = events.map((e) => `${e.phase}:${e.status}`);
  assert.deepStrictEqual(seq, EXPECTED_PHASES.flatMap((p) => [`${p}:start`, `${p}:done`]));
});

test('a throwing onProgress never breaks the chain', async () => {
  stubFetchAlways('{}');
  const result = await runExpertChain({
    apiKey: 'test-key',
    candidateAnswer: 'I led the migration and cut latency a lot.',
    onProgress: () => { throw new Error('boom'); }
  });
  assert.ok(result && result.output, 'chain still resolves with an output');
});
