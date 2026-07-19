import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERT_QUESTION_MODEL,
  EXPERT_QUESTION_TIMEOUT_MS,
  EXPERT_QUESTION_VERSION,
  generateExpertQuestion
} from '../src/expert-question';

const INPUT = {
  candidateAnswer:
    '我负责三万平方米园区，先重排巡检路线，再用消防盲演验证响应时间，最后将平均到场时间从八分钟降到五分钟。',
  focusHint: '追问盲演如何发现真实风险',
  jobDescription: '物业经理：负责园区安全、消防、巡检和突发事件处理。',
  interviewGuide: [
    '15%｜突发事件应对与复盘｜可验证证据：指挥链路与事后整改｜警示信号：只背预案'
  ],
  resumeText: '候选人有五年园区物业管理经验。',
  questionHistory: ['请介绍你管理过的园区规模。'],
  outputLanguage: 'zh'
} as const;

test('one Flash call performs expert gap analysis and emits one evidence-anchored question', async () => {
  const calls: any[] = [];
  const result = await generateExpertQuestion(INPUT, {
    chat: async (options) => {
      calls.push(options);
      return JSON.stringify({
        should_ask: true,
        primary_question: '你提到“平均到场时间从八分钟降到五分钟”，这三分钟改善中哪个关键决策是你亲自做出的？',
        rationale_for_interviewer: '结果已经量化，但候选人的个人决策与责任边界还不清楚。',
        anchor_quotes: ['平均到场时间从八分钟降到五分钟'],
        expected_evidence_yield: '个人决策、取舍依据和责任边界'
      });
    },
    now: (() => {
      const times = [1_000, 4_140];
      return () => times.shift() ?? 4_140;
    })()
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, EXPERT_QUESTION_MODEL);
  assert.equal(calls[0].thinking, false);
  assert.equal(calls[0].timeoutMs, EXPERT_QUESTION_TIMEOUT_MS);
  assert.equal(calls[0].maxRetries, 0);
  assert.match(calls[0].system, /证据缺口/);
  assert.match(calls[0].system, /责任边界/);
  assert.match(calls[0].messages[0].content, /平均到场时间/);
  assert.match(calls[0].messages[0].content, /物业经理/);
  assert.match(calls[0].messages[0].content, /结构化面试评分表/);
  assert.match(calls[0].messages[0].content, /突发事件应对与复盘/);
  assert.match(calls[0].messages[0].content, /已问问题/);
  assert.equal(result.output.primary_question.includes('？'), true);
  assert.equal((result.output.primary_question.match(/[？?]/g) ?? []).length, 1);
  assert.deepEqual(result.output.anchor_quotes, ['平均到场时间从八分钟降到五分钟']);
  assert.equal(result.elapsedMs, 3_140);
  assert.equal(result.fellBack, false);
  assert.equal(result.output.iteration_version, EXPERT_QUESTION_VERSION);
});

test('rejects generic low-signal model output and falls back to a concrete Chinese question', async () => {
  const result = await generateExpertQuestion(INPUT, {
    chat: async () => JSON.stringify({
      should_ask: true,
      primary_question: '能详细说说吗？',
      rationale_for_interviewer: '想让候选人多说一些。',
      anchor_quotes: [],
      expected_evidence_yield: '更多信息'
    })
  });

  assert.equal(result.fellBack, true);
  assert.match(result.output.primary_question, /具体|量化|决策|证据/);
  assert.equal((result.output.primary_question.match(/[？?]/g) ?? []).length, 1);
});

test('rejects accidental English clauses in Chinese mode while allowing source acronyms', async () => {
  const mixed = await generateExpertQuestion(INPUT, {
    chat: async () => JSON.stringify({
      should_ask: true,
      primary_question: 'What was the hardest decision and how did you validate it?',
      rationale_for_interviewer: 'This checks ownership and evidence quality.',
      anchor_quotes: ['消防盲演'],
      expected_evidence_yield: 'Decision quality and measurable impact.'
    })
  });

  assert.equal(mixed.fellBack, true);
  assert.doesNotMatch(mixed.output.primary_question, /[A-Za-z]{2,}/);
  assert.doesNotMatch(mixed.output.rationale_for_interviewer, /[A-Za-z]{2,}/);
  assert.doesNotMatch(mixed.output.expected_evidence_yield, /[A-Za-z]{2,}/);
});

test('trims compound questions to exactly one decision-ready question', async () => {
  const result = await generateExpertQuestion(INPUT, {
    chat: async () => JSON.stringify({
      should_ask: true,
      primary_question: '盲演中你亲自做了哪个关键决策？整改后又怎么验证？',
      rationale_for_interviewer: '候选人给出了结果，但个人决策和验证链路仍不清楚。',
      anchor_quotes: ['消防盲演'],
      expected_evidence_yield: '关键决策和个人责任边界'
    })
  });

  assert.equal(result.output.primary_question, '盲演中你亲自做了哪个关键决策？');
  assert.equal((result.output.primary_question.match(/[？?]/g) ?? []).length, 1);
});
