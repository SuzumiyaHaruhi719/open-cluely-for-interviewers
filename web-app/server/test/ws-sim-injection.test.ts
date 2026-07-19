import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@open-cluely/contract';

// config.ts freezes DASHSCOPE_API_KEY at module load, so set it before requiring
// app/ws. The DashScope calls below are fetch-stubbed; the key only unlocks the
// local no-key guard.
process.env.DASHSCOPE_API_KEY = 'test-key-sim-injection';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../src/app') as typeof import('../src/app');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attachWebSocket } = require('../src/ws') as typeof import('../src/ws');

const DASHSCOPE_MARKER = 'apps/anthropic';

const ORDER_QUESTION =
  '你提到“订单状态同步延迟很高”，当时怎么验证根因确实在轮询而不是下游消费？';
const EXPERIMENT_QUESTION =
  '你提到“实验组转化率提高”，当时用哪个关键验证信号排除了偶然波动？';

function anthropicResponse(text: string, model = 'stub-model'): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function blockReply(prompt: string): string {
  const isOrder = prompt.includes('订单状态同步延迟很高');
  const primary = isOrder ? ORDER_QUESTION : EXPERIMENT_QUESTION;
  const anchor = isOrder ? '订单状态同步延迟很高' : '实验组转化率提高';
  const frame = isOrder ? 'diagnostic-debug' : 'evidence-verification';
  const expected = isOrder
    ? '改造同步链路前的真实根因验证方法'
    : '扩大实验前的结果验证依据';

  if (prompt.includes('[候选人最新回答]')) {
    return JSON.stringify({
      should_ask: true,
      primary_question: primary,
      rationale_for_interviewer: isOrder
        ? '候选人说明了改造动作，但根因判断的验证链路还不清楚。'
        : '候选人说明了暂缓扩大实验，但排除偶然波动的决策依据还不清楚。',
      anchor_quotes: [anchor],
      expected_evidence_yield: expected
    });
  }

  if (prompt.includes('ANATOMY block')) {
    return JSON.stringify({
      claims: [{ id: 'c1', raw_span: anchor, claim_type: 'action', subject: 'project', value: anchor }],
      star_coverage: { S: true, T: true, A: true, R: true },
      answer_quality_label: 'concrete',
      language_register: 'professional'
    });
  }
  if (prompt.includes('STATE-UPDATE block')) {
    return JSON.stringify({
      topic_just_drilled: isOrder ? 'order status sync' : 'experiment rollout',
      next_competency_target: isOrder ? 'technical-depth' : 'numbers-fluency',
      depth_remaining_on_current_topic: 'deep-vein',
      should_pivot: false,
      drilled_topics_after: [{ topic: isOrder ? 'order status sync' : 'experiment rollout', depth: 1 }]
    });
  }
  if (prompt.includes('EVIDENCE-GAP block')) {
    return JSON.stringify({
      missing_evidence: [
        {
          competency: isOrder ? 'technical-depth' : 'numbers-fluency',
          evidence_type: isOrder ? 'failure-handling' : 'metric',
          why_missing: isOrder ? 'root-cause verification is not yet established' : 'experiment validation is not yet established',
          verifier_check: 'Block A anchored the outcome but not the verification path.'
        }
      ],
      overclaim_flags: [],
      contradictions: []
    });
  }
  if (prompt.includes('QUESTION-POOL block')) {
    const alt = isOrder
      ? "你说'幂等写入'，上线后怎么验证它没有引入重复更新?"
      : "你提到'扩大实验'，当时最像真的反对理由是什么?";
    return JSON.stringify({
      candidates: [
        {
          id: 'q1',
          followup_frame: frame,
          question: primary,
          question_type: isOrder ? 'failure-mode' : 'metric-pin',
          anchors: [anchor],
          fills_evidence_gap: isOrder ? 'technical-depth' : 'numbers-fluency',
          expected_yield: expected
        },
        {
          id: 'q2',
          followup_frame: isOrder ? 'evidence-verification' : 'tradeoff-alternative',
          question: alt,
          question_type: isOrder ? 'metric-pin' : 'tradeoff-articulation',
          anchors: [isOrder ? '幂等写入' : '扩大实验'],
          fills_evidence_gap: isOrder ? 'technical-depth' : 'judgement-tradeoffs',
          expected_yield: 'a second distinct follow-up angle'
        },
        {
          id: 'q3',
          followup_frame: 'tradeoff-alternative',
          question: `围绕'${anchor}'，当时最有吸引力的替代方案是什么，为什么没有选?`,
          question_type: 'tradeoff-articulation',
          anchors: [anchor],
          fills_evidence_gap: 'judgement-tradeoffs',
          expected_yield: 'tradeoff reasoning'
        },
        {
          id: 'q4',
          followup_frame: 'failure-learning',
          question: `关于'${anchor}'，哪次判断后来被证明不完整，你改了什么?`,
          question_type: 'failure-mode',
          anchors: [anchor],
          fills_evidence_gap: 'failure-handling',
          expected_yield: 'learning from wrong assumptions'
        },
        {
          id: 'q5',
          followup_frame: 'collaboration-ownership',
          question: `在'${anchor}'这段经历里，你负责的边界和别人交接的边界怎么划?`,
          question_type: 'action-attribution',
          anchors: [anchor],
          fills_evidence_gap: 'ownership',
          expected_yield: 'personal contribution boundary when needed'
        }
      ]
    });
  }
  if (prompt.includes('SAFETY-AUDIT block')) {
    return JSON.stringify({ verdict: 'pass', violations: [], regex_hits: [], soft_rule_findings: [] });
  }
  if (prompt.includes('FINAL-RENDER block')) {
    return JSON.stringify({
      primary_question: primary,
      alternative_question: '',
      rationale_for_interviewer: `This probes ${expected}.`,
      anchor_quotes: [anchor],
      expected_evidence_yield: expected,
      iteration_version: 'expert_v1_2026-05-29'
    });
  }
  if (prompt.includes('SESSION CONSOLIDATOR')) {
    return JSON.stringify({
      drilled_topics: [isOrder ? 'order status sync' : 'experiment rollout'],
      competencies_covered: [isOrder ? 'technical-depth' : 'numbers-fluency'],
      open_gaps: [],
      candidate_profile_summary: 'Stub state.',
      asked_questions: [primary]
    });
  }
  return JSON.stringify({ ok: true });
}

function installFetchStub(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.includes(DASHSCOPE_MARKER)) {
      return new Response('stubbed non-chat endpoint', { status: 404 });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      model?: string;
      messages?: Array<{ content?: string }>;
    };
    const prompt = String(body.messages?.[0]?.content ?? '');
    return anthropicResponse(blockReply(prompt), body.model ?? 'stub-model');
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

async function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(createApp());
  attachWebSocket(server);
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function runInjectedScript(port: number, text: string): Promise<{ result: ServerMessage; transcripts: string[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const transcripts: string[] = [];

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for sim result')), 12000);

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'configure',
          config: {
            mode: 'expert',
            asrProvider: 'sim',
            autoAnalyzeDisplay: true,
            simScript: [{ speakerId: 1, text }]
          }
        })
      );
      ws.send(JSON.stringify({ type: 'audio-control', action: 'start', source: 'display' }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === 'transcript' && msg.isFinal) transcripts.push(msg.text);
      if (msg.type === 'result' || (msg.type === 'error' && 'requestId' in msg)) {
        clearTimeout(timer);
        ws.close();
        resolve({ result: msg, transcripts });
      }
    });
  });
}

test('sim injection scripts drive different Expert follow-up frames through the websocket path', async () => {
  const restoreFetch = installFetchStub();
  const { port, close } = await startServer();
  try {
    const order = await runInjectedScript(
      port,
      '候选人：订单状态同步延迟很高，我把五分钟轮询改成消息队列，并加了幂等写入。'
    );
    const experiment = await runInjectedScript(
      port,
      '候选人：实验组转化率提高后，我没有立刻扩大实验，而是先看分层样本和回访质量。'
    );

    assert.deepEqual(order.transcripts, [
      '候选人：订单状态同步延迟很高，我把五分钟轮询改成消息队列，并加了幂等写入。'
    ]);
    assert.deepEqual(experiment.transcripts, [
      '候选人：实验组转化率提高后，我没有立刻扩大实验，而是先看分层样本和回访质量。'
    ]);

    assert.equal(order.result.type, 'result');
    assert.equal(experiment.result.type, 'result');
    if (order.result.type === 'result' && experiment.result.type === 'result') {
      assert.equal(order.result.trigger, 'manual');
      assert.equal(experiment.result.trigger, 'manual');
      assert.equal(order.result.output.primary_question, ORDER_QUESTION);
      assert.equal(experiment.result.output.primary_question, EXPERIMENT_QUESTION);
      assert.notEqual(order.result.output.primary_question, experiment.result.output.primary_question);
      assert.ok(!order.result.output.primary_question.includes('你个人'));
      assert.ok(!experiment.result.output.primary_question.includes('你个人'));
    }
  } finally {
    await close();
    restoreFetch();
  }
});
