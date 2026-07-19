import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@open-cluely/contract';
import type { ExpertQuestionResult } from '../src/expert-question';
import { runExpertQuestionAndEmit } from '../src/ws';

function fakeSocket(messages: ServerMessage[]): any {
  return {
    OPEN: 1,
    readyState: 1,
    send(raw: string) {
      messages.push(JSON.parse(raw) as ServerMessage);
    }
  };
}

const GENERATED = {
  output: {
    primary_question: '你提到“消防盲演”，当时暴露的最高风险点是什么？',
    alternative_question: '',
    rationale_for_interviewer: '验证真实处置经验。',
    anchor_quotes: ['消防盲演'],
    expected_evidence_yield: '风险判断和处置证据',
    iteration_version: 'expert_flash_v2'
  },
  model: 'deepseek-v4-flash',
  elapsedMs: 920,
  fellBack: false,
  shouldAsk: true
} satisfies ExpertQuestionResult;

test('automatic question emits one under-10s Expert result', async () => {
  const messages: ServerMessage[] = [];
  const calls: any[] = [];

  await runExpertQuestionAndEmit(
    fakeSocket(messages),
    {
      requestId: 'auto-1',
      candidateAnswer: '我用消防盲演检查园区响应时间。',
      focusHint: '追问盲演发现的风险',
      jobDescription: '物业经理',
      resumeText: '',
      outputLanguage: 'zh',
      questionHistory: [],
      trigger: 'auto',
      isStale: () => false
    },
    {
      generate: async (input) => {
        calls.push(input);
        return GENERATED;
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].focusHint, '追问盲演发现的风险');
  assert.deepEqual(
    messages.map((message) => message.type),
    ['progress', 'progress', 'result']
  );
  const result = messages.at(-1);
  assert.equal(result?.type, 'result');
  if (result?.type === 'result') {
    assert.equal(result.trigger, 'auto');
    assert.equal(result.mode, 'expert');
    assert.equal(result.elapsedMs, 920);
    assert.equal(result.output.primary_question, GENERATED.output.primary_question);
    assert.deepEqual(result.ranked, []);
  }
});

test('manual Generate Q uses the same Expert Flash path as automatic generation', async () => {
  const messages: ServerMessage[] = [];

  await runExpertQuestionAndEmit(
    fakeSocket(messages),
    {
      requestId: 'manual-1',
      candidateAnswer: '我用消防盲演检查园区响应时间。',
      focusHint: '',
      jobDescription: '物业经理',
      resumeText: '',
      outputLanguage: 'zh',
      questionHistory: ['你管理过多大的园区？'],
      trigger: 'manual',
      isStale: () => false
    },
    { generate: async () => GENERATED }
  );

  const result = messages.at(-1);
  assert.equal(result?.type, 'result');
  if (result?.type === 'result') {
    assert.equal(result.trigger, 'manual');
    assert.equal(result.mode, 'expert');
    assert.equal(result.iterationVersion, 'expert_flash_v2');
  }
});

test('a reset during Flash generation suppresses the stale completion and result', async () => {
  const messages: ServerMessage[] = [];
  let stale = false;

  await runExpertQuestionAndEmit(
    fakeSocket(messages),
    {
      requestId: 'auto-old',
      candidateAnswer: '旧面试回答',
      trigger: 'auto',
      isStale: () => stale
    },
    {
      generate: async () => {
        stale = true;
        return GENERATED;
      }
    }
  );

  assert.deepEqual(messages.map((message) => message.type), ['progress']);
});
