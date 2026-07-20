import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';

test('legacy assistant endpoints are not mounted', async () => {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    for (const path of ['ask', 'notes', 'insights']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/assistant/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'x', transcript: 'x' })
      });
      assert.equal(response.status, 404, path);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
