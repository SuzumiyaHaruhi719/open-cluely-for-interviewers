import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@open-cluely/contract';
import { createApp } from '../src/app';
import { attachWebSocket } from '../src/ws';

// Anthropic-shape response factory. The runtime calls fetch with max_tokens=600
// for hook detection (stage 1) and max_tokens=800 for follow-ups (stage 2).
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

const HOOK_JSON = JSON.stringify({
  score: 5,
  pivot_signal: false,
  concrete_hooks: ['x'],
  missing_star_element: 'R',
  recommended_direction: 'technical-depth'
});

const FOLLOWUP_JSON = JSON.stringify({
  questions: [{ question: 'Q?', rationale: 'r' }]
});

function installFetchStub(): () => void {
  const original = global.fetch;
  global.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    let maxTokens = 0;
    try {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { max_tokens?: number };
      maxTokens = Number(parsed.max_tokens ?? 0);
    } catch {
      maxTokens = 0;
    }
    return maxTokens === 600 ? anthropicResponse(HOOK_JSON) : anthropicResponse(FOLLOWUP_JSON);
  }) as typeof global.fetch;
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

test('WS analyze (fast mode) yields ready, progress, and a synthesized result', async () => {
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
      ws.send(JSON.stringify({ type: 'configure', config: { mode: 'fast' } }));
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

  // result with the synthesized fast-mode follow-up.
  const result = messages.find((m) => m.type === 'result');
  assert.ok(result, `expected a result message; got: ${JSON.stringify(messages)}`);
  if (result && result.type === 'result') {
    assert.equal(result.requestId, 'req-1');
    assert.equal(result.trigger, 'manual');
    assert.equal(result.output.primary_question, 'Q?');
    assert.equal(result.shouldShowFollowUps, true);
  }
});
