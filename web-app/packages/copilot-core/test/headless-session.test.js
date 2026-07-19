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

test('fast-mode model follows the session config and can change mid-session', async () => {
  const requestedModels = [];
  const session = createHeadlessSession({
    apiKey: 'test-key',
    config: { mode: 'fast', interviewerModel: 'deepseek-v4-pro' }
  });

  const restore = stubFetchAnthropic((body) => {
    requestedModels.push(body.model);
    return JSON.stringify({ score: 0, pivot_signal: false, concrete_hooks: [] });
  });

  try {
    await session.analyze({
      candidateAnswer: 'This answer is deliberately long enough to reach the configured fast model.',
      requestId: 'model-pro'
    });
    session.configure({ interviewerModel: 'qwen3-vl-plus' });
    await session.analyze({
      candidateAnswer: 'This second answer verifies that switching models affects the next request.',
      requestId: 'model-qwen'
    });
  } finally {
    restore();
  }

  assert.deepStrictEqual(requestedModels, ['deepseek-v4-pro', 'qwen3-vl-plus']);
  assert.strictEqual(session.getState().dashscopeAiModel, 'qwen3-vl-plus');
});

test('unsupported fast-mode model falls back to the safe default', () => {
  const session = createHeadlessSession({
    apiKey: 'test-key',
    config: { mode: 'fast', interviewerModel: 'not-a-real-model' }
  });
  assert.strictEqual(session.getState().dashscopeAiModel, 'deepseek-v4-flash');
});

test('headless fast-mode analyze passes outputLanguage into the Stage 2 prompt', async () => {
  const prompts = [];
  const session = createHeadlessSession({
    apiKey: 'test-key',
    config: { mode: 'fast', outputLanguage: 'zh' }
  });

  const restore = stubFetchAnthropic((body) => {
    prompts.push(body.messages[0].content);
    return body.max_tokens === 600
      ? JSON.stringify({
          score: 5,
          pivot_signal: false,
          concrete_hooks: ['async queue'],
          missing_star_element: 'A',
          recommended_direction: 'technical-depth'
        })
      : JSON.stringify({
          questions: [{ question: '请继续追问 async queue。', rationale: '验证候选人的取舍判断。' }]
        });
  });

  try {
    await session.analyze({
      candidateAnswer: 'We built an async queue to decouple the workers and it scaled well under load.',
      questionHistory: [],
      requestId: 'r-lang'
    });
  } finally {
    restore();
  }

  const stage2Prompt = prompts[1] || '';
  assert.ok(stage2Prompt.includes('OUTPUT LANGUAGE'), 'Stage 2 receives a language directive');
  assert.ok(stage2Prompt.includes('Simplified Chinese') || stage2Prompt.includes('简体中文'));
});
