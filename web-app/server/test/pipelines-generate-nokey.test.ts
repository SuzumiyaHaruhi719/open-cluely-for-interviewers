import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

// This file proves the no-key 503 branch of POST /api/pipelines/generate.
// config.ts freezes DASHSCOPE_API_KEY at module load, so we must clear it BEFORE
// the app (and its transitive config import) loads. We set it to '' rather than
// deleting it: config.ts calls dotenv.config() which loads web-app/.env, and
// dotenv (override:false) only fills keys ABSENT from process.env — a key that
// is present but empty is left empty, so config.dashscopeApiKey stays ''. Node's
// test runner isolates each file in its own process, so this cannot affect the
// other suites (which set their own key before their own require).
process.env.DASHSCOPE_API_KEY = '';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('../src/app') as typeof import('../src/app');

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

test('POST /api/pipelines/generate 503s when no DashScope key is configured', async () => {
  await withServer(async (base) => {
    // The key guard runs before body validation, so even a valid prompt 503s.
    const res = await fetch(`${base}/api/pipelines/generate`, post({ prompt: 'Hire a backend engineer' }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'no key' });
  });
});
