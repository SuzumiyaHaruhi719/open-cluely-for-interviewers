import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@open-cluely/contract';
import { createApp } from '../src/app';
import { attachWebSocket } from '../src/ws';

// Anthropic-shape response factory for the one-call realtime Expert path.
function anthropicResponse(text: string, model = 'stub-model'): Response {
  const body = {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 },
    model
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const EXPERT_JSON = JSON.stringify({
  should_ask: true,
  primary_question: 'Which design decision did you personally make to achieve the p99 latency reduction?',
  rationale_for_interviewer: 'The result is stated, but the candidate ownership and decision boundary are not yet clear.',
  anchor_quotes: ['p99 latency'],
  expected_evidence_yield: 'A concrete personal decision, tradeoff, and measurable validation.'
});

function installFetchStub(): () => void {
  const original = global.fetch;
  global.fetch = (async () => anthropicResponse(EXPERT_JSON)) as typeof global.fetch;
  return () => {
    global.fetch = original;
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

test('WS analyze yields ready, progress, and one realtime Expert result', async () => {
  const restoreFetch = installFetchStub();
  const { port, close } = await startServer();

  const messages: ServerMessage[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

  // Resolve once we have collected a result (or reject on timeout/error).
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for result')), 10000);

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'configure', config: { mode: 'expert', outputLanguage: 'en' } }));
      ws.send(
        JSON.stringify({
          type: 'analyze',
          requestId: 'req-1',
          candidateAnswer: 'I built a distributed cache to cut p99 latency on our checkout path.',
          questionHistory: []
        })
      );
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      messages.push(msg);
      if (msg.type === 'result' || (msg.type === 'error' && 'requestId' in msg)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    await done;
  } finally {
    ws.close();
    await close();
    restoreFetch();
  }

  // ready (with a sessionId).
  const ready = messages.find((m) => m.type === 'ready');
  assert.ok(ready, 'expected a ready message');
  assert.equal(typeof (ready as { sessionId: string }).sessionId, 'string');

  // at least one progress event.
  const progress = messages.filter((m) => m.type === 'progress');
  assert.ok(progress.length >= 1, 'expected at least one progress message');

  // result with the synthesized realtime Expert follow-up.
  const result = messages.find((m) => m.type === 'result');
  assert.ok(result, `expected a result message; got: ${JSON.stringify(messages)}`);
  if (result && result.type === 'result') {
    assert.equal(result.requestId, 'req-1');
    assert.equal(result.trigger, 'manual');
    assert.equal(result.mode, 'expert');
    assert.equal(
      result.output.primary_question,
      'Which design decision did you personally make to achieve the p99 latency reduction?'
    );
    assert.equal(result.shouldShowFollowUps, true);
  }
});
