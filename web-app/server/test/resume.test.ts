import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';

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

test('POST /api/resume/extract decodes a .txt upload to its text', async () => {
  await withServer(async (base) => {
    const original = 'Jane Doe\nSenior Engineer\nSkills: TypeScript, Node.js';
    const contentBase64 = Buffer.from(original, 'utf8').toString('base64');

    const res = await fetch(`${base}/api/resume/extract`, post({ filename: 'resume.txt', contentBase64 }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { text: string };
    assert.equal(body.text, original);
  });
});

test('POST /api/resume/extract decodes a .md upload to its text', async () => {
  await withServer(async (base) => {
    const original = '# Resume\n\n- Point one\n- Point two';
    const contentBase64 = Buffer.from(original, 'utf8').toString('base64');

    const res = await fetch(`${base}/api/resume/extract`, post({ filename: 'cv.md', contentBase64 }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { text: string };
    assert.equal(body.text, original);
  });
});

test('POST /api/resume/extract rejects an unknown extension with 400', async () => {
  await withServer(async (base) => {
    const contentBase64 = Buffer.from('anything', 'utf8').toString('base64');
    const res = await fetch(`${base}/api/resume/extract`, post({ filename: 'resume.rtf', contentBase64 }));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.length > 0);
  });
});

test('POST /api/resume/extract 400s on a missing filename', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/resume/extract`, post({ contentBase64: 'aGk=' }));
    assert.equal(res.status, 400);
  });
});
