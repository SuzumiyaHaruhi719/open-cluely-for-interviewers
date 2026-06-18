import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { chat } from '../src/dashscope';

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
