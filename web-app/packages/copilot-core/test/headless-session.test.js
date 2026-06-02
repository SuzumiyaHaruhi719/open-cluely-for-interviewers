'use strict';

// Proves the headless facade runs the REAL desktop brain server-side with no
// Electron: fast-mode analyze threads through detectHooks + generateFollowUps,
// emits progress on the same channel the desktop renderer uses, and degrades
// when unconfigured. `fetch` is stubbed (Anthropic-shape) — deterministic, no network.

const test = require('node:test');
const assert = require('node:assert');
const { createHeadlessSession } = require('..');

function stubFetchAnthropic(handler) {
  const orig = global.fetch;
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const text = handler(body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          content: [{ type: 'text', text }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: body.model
        };
      },
      async text() {
        return '';
      }
    };
  };
  return () => {
    global.fetch = orig;
  };
}

test('headless fast-mode analyze runs the brain and emits progress', async () => {
  const events = [];
  const session = createHeadlessSession({
    apiKey: 'test-key',
    config: { mode: 'fast', jobDescription: 'Backend role', outputLanguage: '' },
    emit: (channel, payload) => events.push({ channel, payload })
  });

  assert.strictEqual(session.isConfigured(), true);
  assert.strictEqual(session.getMode(), 'fast');

  // detectHooks uses max_tokens 600; generateFollowUps uses 800.
  const restore = stubFetchAnthropic((body) =>
    body.max_tokens === 600
      ? JSON.stringify({
          score: 5,
          pivot_signal: false,
          concrete_hooks: ['async queue'],
          missing_star_element: 'R',
          recommended_direction: 'technical-depth'
        })
      : JSON.stringify({
          questions: [{ question: 'What did you personally own in the async queue?', rationale: 'probe ownership' }]
        })
  );

  try {
    const result = await session.analyze({
      candidateAnswer: 'We built an async queue to decouple the workers and it scaled well under load.',
      questionHistory: [],
      requestId: 'r1'
    });
    assert.strictEqual(result.mode, 'fast');
    assert.strictEqual(result.shouldShowFollowUps, true);
    assert.ok(result.stage2 && result.stage2.parsed.questions.length === 1);
    assert.ok(events.some((e) => e.channel === 'interviewer-progress'), 'should emit progress');
  } finally {
    restore();
  }
});

test('headless analyze skips with no api key', async () => {
  const session = createHeadlessSession({ apiKey: '', config: { mode: 'fast' } });
  const result = await session.analyze({ candidateAnswer: 'a sufficiently long answer here', requestId: 'r2' });
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'no-dashscope-key');
});

test('configure switches mode and isConfigured tracks the key', () => {
  const session = createHeadlessSession({ apiKey: 'k', config: { mode: 'fast' } });
  session.configure({ mode: 'expert', jobDescription: 'Staff SWE' });
  assert.strictEqual(session.getMode(), 'expert');
  assert.strictEqual(session.getState().jobDescription, 'Staff SWE');
  session.setApiKey('');
  assert.strictEqual(session.isConfigured(), false);
});
