import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_MONITOR_MODEL,
  AUTO_MONITOR_TIMEOUT_MS,
  evaluateAutoMonitor
} from '../src/auto-monitor';
import type { ChatOptions } from '../src/dashscope';
import { EXPERT_QUESTION_TIMEOUT_MS } from '../src/expert-question';

const ANSWER =
  '我负责园区消防整改，先核对巡检记录，再协调工程团队修复，但最终复检耗时和故障复发率还没有说明。';

test('sentinel gets a viable network window while the sequential hard budget stays below 10s', () => {
  assert.ok(AUTO_MONITOR_TIMEOUT_MS >= 2_800);
  assert.ok(AUTO_MONITOR_TIMEOUT_MS + EXPERT_QUESTION_TIMEOUT_MS <= 9_800);
});

test('Flash sentinel asks on a concrete evidence gap with bounded low-latency options', async () => {
  const calls: ChatOptions[] = [];
  const decision = await evaluateAutoMonitor(
    {
      candidateAnswer: `${'早期背景。'.repeat(800)}${ANSWER}`,
      jobDescription: `${'物业经理职责。'.repeat(300)}`,
      interviewGuide: ['消防应急', '现场团队管理']
    },
    {
      chat: async (received) => {
        calls.push(received);
        received.onUsage?.({ input: 123, output: 17 });
        return JSON.stringify({
          action: 'ask',
          gap: '没有可验证的复检结果',
          focusHint: '追问复检耗时、复发率和候选人本人承担的责任'
        });
      }
    }
  );

  assert.equal(decision.shouldGenerate, true);
  assert.equal(decision.reason, '没有可验证的复检结果');
  assert.match(decision.focusHint, /复检耗时/);
  assert.deepEqual(decision.tokensUsed, { input: 123, output: 17, total: 140 });
  const options = calls[0];
  assert.ok(options);
  assert.equal(options.model, AUTO_MONITOR_MODEL);
  assert.equal(options.thinking, false);
  assert.equal(options.timeoutMs, AUTO_MONITOR_TIMEOUT_MS);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.temperature, 0);
  assert.ok((options.messages[0]?.content.length ?? 0) < 4_500, 'prompt remains bounded');
  assert.match(options.messages[0]?.content ?? '', /消防应急/);
  assert.match(options.messages[0]?.content ?? '', /故障复发率/);
});

test('Flash sentinel returns wait for explicit wait, malformed JSON, and provider failure', async () => {
  const explicit = await evaluateAutoMonitor(
    { candidateAnswer: ANSWER },
    { chat: async () => '{"action":"wait","gap":"","focusHint":""}' }
  );
  assert.equal(explicit.shouldGenerate, false);

  const malformed = await evaluateAutoMonitor(
    { candidateAnswer: ANSWER },
    { chat: async () => 'I would ask something now.' }
  );
  assert.equal(malformed.shouldGenerate, false);

  const failed = await evaluateAutoMonitor(
    { candidateAnswer: ANSWER },
    {
      chat: async () => {
        throw new Error('timeout');
      }
    }
  );
  assert.equal(failed.shouldGenerate, false);
});

test('Flash sentinel refuses an ask without both a real gap and a useful focus hint', async () => {
  for (const payload of [
    { action: 'ask', gap: '', focusHint: '追问结果' },
    { action: 'ask', gap: '缺少量化结果', focusHint: '' },
    { action: 'maybe', gap: '缺少量化结果', focusHint: '追问量化结果' }
  ]) {
    const decision = await evaluateAutoMonitor(
      { candidateAnswer: ANSWER },
      { chat: async () => JSON.stringify(payload) }
    );
    assert.equal(decision.shouldGenerate, false);
  }
});
