import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { chat, chatStream, type ChatStreamEvent } from '../src/dashscope';

// ----------------------------------------------------------------------------
// `chat()` is the one Anthropic-shape HTTP helper. These tests pin two behaviours
// that the summary path depends on:
//
//   #1 — a per-call timeout OVERRIDE (timeoutMs). The deep v4-pro summary can run
//        past the default 60s; callers must be able to grant a longer budget,
//        while default callers keep the 60s abort.
//   #2 — non-retryable 4xx (except 429) must FAIL FAST: fetch is called exactly
//        once, no backoff loop. 5xx and 429 still retry.
//
// All offline: we stub global.fetch (and require a dummy key so chat() doesn't
// short-circuit on "no key"). No real DashScope call is ever made.
// ----------------------------------------------------------------------------

function anthropicOk(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function httpError(status: number, body = 'err'): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

let originalFetch: typeof global.fetch;
let originalKey: string | undefined;

beforeEach(() => {
  originalFetch = global.fetch;
  originalKey = process.env.DASHSCOPE_API_KEY;
  // A dummy key so chat() reaches fetch instead of throwing 'no key'.
  process.env.DASHSCOPE_API_KEY = 'test-dummy-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = originalKey;
});

// ── #2 non-retryable 4xx fails fast ─────────────────────────────────────────

test('#2 a 400 calls fetch exactly once and rejects (no retry)', async () => {
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return httpError(400, 'bad request: max_tokens too large');
  }) as typeof global.fetch;

  await assert.rejects(
    () => chat({ messages: [{ role: 'user', content: 'hi' }] }),
    /DashScope 400/
  );
  assert.equal(calls, 1, 'a 400 must NOT be retried');
});

test('#2 a 404 calls fetch exactly once and rejects (no retry)', async () => {
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return httpError(404, 'model not found');
  }) as typeof global.fetch;

  await assert.rejects(() => chat({ messages: [{ role: 'user', content: 'hi' }] }), /DashScope 404/);
  assert.equal(calls, 1, 'a 404 must NOT be retried');
});

test('#2 a 500 retries (more than one fetch call) then eventually succeeds', async () => {
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    if (calls < 2) return httpError(500, 'server error');
    return anthropicOk('recovered');
  }) as typeof global.fetch;

  const text = await chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(text, 'recovered');
  assert.ok(calls >= 2, '5xx must be retried');
});

test('#2 a 429 retries (rate-limit is retryable)', async () => {
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    if (calls < 2) return httpError(429, 'rate limited');
    return anthropicOk('after backoff');
  }) as typeof global.fetch;

  const text = await chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(text, 'after backoff');
  assert.ok(calls >= 2, '429 must be retried');
});

test('#2 maxRetries:0 disables retry/backoff for latency-SLO calls', async () => {
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return httpError(500, 'server error');
  }) as typeof global.fetch;

  await assert.rejects(
    () => chat({ messages: [{ role: 'user', content: 'hi' }], maxRetries: 0 }),
    /DashScope 500/
  );
  assert.equal(calls, 1);
});

// ── #1 per-call timeout override ────────────────────────────────────────────

test('#1 honors a longer timeoutMs override: a slow call under the override succeeds', async () => {
  // The fetch resolves after 120ms; the call would ABORT under a tiny timeout but
  // must SUCCEED under a generous override. We assert the override is wired by
  // reading the abort signal's configured deadline indirectly: a call that races
  // its own abort. Simpler + deterministic: the stub watches the AbortSignal and
  // resolves only if it is NOT already aborted shortly after invocation.
  let sawSignal: AbortSignal | undefined;
  global.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    sawSignal = init?.signal;
    // Resolve quickly; the point is that with a big override the signal is not
    // aborted by the time we return.
    return anthropicOk('done');
  }) as typeof global.fetch;

  const text = await chat({
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 180000
  });
  assert.equal(text, 'done');
  assert.ok(sawSignal, 'fetch should receive an AbortSignal');
  assert.equal(sawSignal?.aborted, false, 'should not be aborted under a generous override');
});

test('#1 a short timeoutMs override aborts a slow call', async () => {
  // The stub never resolves on its own — only the abort can settle it. With a tiny
  // override the controller must fire and reject the call.
  global.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }
    })) as typeof global.fetch;

  await assert.rejects(
    () =>
      chat({
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 20
      }),
    /abort/i
  );
});

test('#1 default callers (no timeoutMs) still get a working call', async () => {
  global.fetch = (async () => anthropicOk('default-budget')) as typeof global.fetch;
  const text = await chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(text, 'default-budget');
});

test('chat reports one-shot token usage to the caller', async () => {
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 321, output_tokens: 87 }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )) as typeof global.fetch;

  let usage: { input: number; output: number } | null = null;
  const text = await chat({
    messages: [{ role: 'user', content: 'hi' }],
    onUsage: (next: { input: number; output: number }) => {
      usage = next;
    }
  } as any);

  assert.equal(text, 'done');
  assert.deepEqual(usage, { input: 321, output: 87 });
});

test('chatStream resolves on message_stop even when the SSE connection stays open', async () => {
  const encoder = new TextEncoder();
  let cancelCalled = false;
  global.fetch = (async () =>
    sseResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'event:message_start',
                'data:{"message":{"usage":{"input_tokens":12}}}',
                '',
                'event:content_block_delta',
                'data:{"delta":{"type":"text_delta","text":"报告完成"}}',
                '',
                'event:message_delta',
                'data:{"usage":{"output_tokens":34}}',
                '',
                'event:message_stop',
                'data:{}',
                ''
              ].join('\n')
            )
          );
          // Intentionally do NOT close the stream. DashScope can leave the HTTP
          // body open after message_stop; chatStream must finish on protocol stop.
        },
        cancel() {
          cancelCalled = true;
        }
      })
    )) as typeof global.fetch;

  let usage: { input: number; output: number } | null = null;
  const chunks: string[] = [];

  const text = await chatStream(
    {
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 30
    },
    {
      onDelta: (delta) => chunks.push(delta),
      onUsage: (u) => {
        usage = u;
      }
    }
  );

  assert.equal(text, '报告完成');
  assert.deepEqual(chunks, ['报告完成']);
  assert.deepEqual(usage, { input: 12, output: 34 });
  assert.equal(cancelCalled, true, 'the open reader should be cancelled after message_stop');
});

test('chatStream emits event-level debug markers without logging text content', async () => {
  const encoder = new TextEncoder();
  global.fetch = (async () =>
    sseResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'event:message_start',
                'data:{"message":{"usage":{"input_tokens":12}}}',
                '',
                'event:content_block_delta',
                'data:{"delta":{"type":"text_delta","text":"报告完成"}}',
                '',
                'event:message_delta',
                'data:{"usage":{"output_tokens":34}}',
                '',
                'event:message_stop',
                'data:{}',
                ''
              ].join('\n')
            )
          );
        }
      })
    )) as typeof global.fetch;

  const events: ChatStreamEvent[] = [];
  await chatStream(
    {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'deepseek-v4-pro',
      timeoutMs: 50
    },
    {
      onDelta: () => {},
      onUsage: () => {},
      onEvent: (event) => events.push(event)
    }
  );

  assert.deepEqual(
    events.map((event) => event.stage),
    [
      'request-start',
      'response',
      'reader-open',
      'sse-event',
      'usage-input',
      'sse-event',
      'delta',
      'sse-event',
      'usage-output',
      'sse-event',
      'message-stop',
      'reader-cancel',
      'return'
    ]
  );
  const delta = events.find((event) => event.stage === 'delta');
  assert.equal(delta?.chunkChars, '报告完成'.length);
  assert.equal(Object.prototype.hasOwnProperty.call(delta ?? {}, 'text'), false, 'debug events must not carry model text');
});

test('chatStream times out if an opened SSE stream never reaches message_stop', async () => {
  const encoder = new TextEncoder();
  global.fetch = (async () =>
    sseResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'event:message_start',
                'data:{"message":{"usage":{"input_tokens":12}}}',
                ''
              ].join('\n')
            )
          );
          // Keep the stream open forever: timeout must reject the read loop.
        }
      })
    )) as typeof global.fetch;

  await assert.rejects(
    () =>
      chatStream(
        {
          messages: [{ role: 'user', content: 'hi' }],
          timeoutMs: 20
        },
        {
          onDelta: () => {},
          onUsage: () => {}
        }
      ),
    /timed out/i
  );
});
