import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_QUESTION_MODEL,
  AUTO_QUESTION_TIMEOUT_MS,
  generateAutoQuestion
} from '../src/auto-question';

const INPUT = {
  candidateAnswer: '我负责三万平方米园区，先重排巡检路线，再用消防盲演验证响应时间。',
  focusHint: '追问盲演如何发现真实风险',
  jobDescription: '物业经理：负责园区安全、消防和突发事件处理。',
  resumeText: '候选人有五年园区物业管理经验。',
  outputLanguage: 'zh'
} as const;

test('one Flash call produces an evidence-anchored auto question inside an 8s request budget', async () => {
  const calls: any[] = [];
  const result = await generateAutoQuestion(INPUT, {
    chat: async (options) => {
      calls.push(options);
      return JSON.stringify({
        primary_question: '你提到“消防盲演”，那次盲演暴露的最高风险点是什么？',
        rationale_for_interviewer: '验证候选人是否真的识别并处置过园区消防风险。',
        anchor_quotes: ['消防盲演'],
        expected_evidence_yield: '风险判断、处置动作与验证证据'
      });
    },
    now: (() => {
      const times = [1_000, 1_180];
      return () => times.shift() ?? 1_180;
    })()
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, AUTO_QUESTION_MODEL);
  assert.equal(calls[0].thinking, false);
  assert.equal(calls[0].timeoutMs, AUTO_QUESTION_TIMEOUT_MS);
  assert.equal(calls[0].maxRetries, 0, 'SLO path must never enter retry backoff');
  assert.match(calls[0].messages[0].content, /消防盲演/);
  assert.match(calls[0].messages[0].content, /物业经理/);
  assert.equal(result.output.primary_question, '你提到“消防盲演”，那次盲演暴露的最高风险点是什么？');
  assert.deepEqual(result.output.anchor_quotes, ['消防盲演']);
  assert.equal(result.elapsedMs, 180);
  assert.equal(result.fellBack, false);
});

test('invalid or failed model output degrades to an immediate anchored question, never an empty card', async () => {
  const result = await generateAutoQuestion(INPUT, {
    chat: async () => {
      throw new Error('timeout');
    }
  });

  assert.equal(result.model, AUTO_QUESTION_MODEL);
  assert.equal(result.fellBack, true);
  assert.ok(result.output.primary_question.length > 10);
  assert.match(result.output.primary_question, /园区|消防|盲演/);
  assert.ok(result.output.anchor_quotes.length >= 1);
  assert.equal(result.output.iteration_version, 'auto_flash_v1');
});

test('parser strips JSON fences and drops hallucinated anchor quotes', async () => {
  const result = await generateAutoQuestion(INPUT, {
    chat: async () =>
      '```json\n' +
      JSON.stringify({
        primary_question: '你如何证明重排巡检路线真的缩短了响应时间？',
        alternative_question: '如果再做一次，你会先改哪一处？',
        rationale_for_interviewer: '追问验证证据。',
        anchor_quotes: ['重排巡检路线', '简历里不存在的事实'],
        expected_evidence_yield: '基线、指标和复盘'
      }) +
      '\n```'
  });

  assert.deepEqual(result.output.anchor_quotes, ['重排巡检路线']);
  assert.equal(result.fellBack, false);
});

test('auto output is exactly one question even when the model returns a compound pair', async () => {
  const result = await generateAutoQuestion(INPUT, {
    chat: async () =>
      JSON.stringify({
        primary_question: '盲演发现了哪个最高风险点？整改后你怎么验证它已消除？',
        alternative_question: '如果重来一次你会改什么？',
        rationale_for_interviewer: '验证风险闭环。',
        anchor_quotes: ['盲演'],
        expected_evidence_yield: '具体风险'
      })
  });

  assert.equal(result.output.primary_question, '盲演发现了哪个最高风险点？');
  assert.equal(result.output.alternative_question, '');
  assert.equal((result.output.primary_question.match(/[？?]/g) ?? []).length, 1);
});
