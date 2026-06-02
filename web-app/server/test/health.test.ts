import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';

test('GET /api/health returns ok:true with metadata', async () => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      ok: boolean;
      version: string;
      questionBankReady: boolean;
      hasKey: boolean;
    };

    assert.equal(body.ok, true);
    assert.equal(typeof body.version, 'string');
    assert.ok(body.version.length > 0);
    assert.equal(typeof body.questionBankReady, 'boolean');
    assert.equal(typeof body.hasKey, 'boolean');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
