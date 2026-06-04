import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamppDiarizer } from '../src/campp-diarizer';

type FetchArgs = { url: string; init?: RequestInit };

function recordingFetch(handler: (args: FetchArgs) => Response | Promise<Response>) {
  const calls: FetchArgs[] = [];
  const fn = (async (input: any, init?: RequestInit) => {
    const args = { url: String(input), init };
    calls.push(args);
    return handler(args);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('diarize returns the integer spk on a 200 response', async () => {
  const { fn, calls } = recordingFetch(
    () => new Response(JSON.stringify({ spk: 0, score: -1, n: 1 }), { status: 200 })
  );
  const d = createCamppDiarizer({ url: 'http://x:10097', session: 's1', fetchFn: fn });

  const spk = await d.diarize(Buffer.from([1, 2, 3, 4]));

  assert.equal(spk, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/diarize\?session=s1$/);
  assert.equal(calls[0].init?.method, 'POST');
});

test('diarize returns null on a non-OK response (422 too_short)', async () => {
  const { fn } = recordingFetch(
    () => new Response(JSON.stringify({ error: 'too_short' }), { status: 422 })
  );
  const d = createCamppDiarizer({ url: 'http://x', session: 's', fetchFn: fn });
  assert.equal(await d.diarize(Buffer.from([0, 0])), null);
});

test('diarize returns null when the body has no numeric spk', async () => {
  const { fn } = recordingFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const d = createCamppDiarizer({ url: 'http://x', session: 's', fetchFn: fn });
  assert.equal(await d.diarize(Buffer.from([0, 0])), null);
});

test('diarize returns null when the sidecar is unreachable', async () => {
  const { fn } = recordingFetch(() => {
    throw new Error('ECONNREFUSED');
  });
  const d = createCamppDiarizer({ url: 'http://x', session: 's', fetchFn: fn });
  assert.equal(await d.diarize(Buffer.from([0, 0])), null);
});

test('reset posts to /reset for the session', async () => {
  const { fn, calls } = recordingFetch(() => new Response('{}', { status: 200 }));
  const d = createCamppDiarizer({ url: 'http://x/', session: 's2', fetchFn: fn });
  d.reset();
  // reset is fire-and-forget; give the microtask a tick to run
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/reset\?session=s2$/);
  assert.equal(calls[0].init?.method, 'POST');
});
