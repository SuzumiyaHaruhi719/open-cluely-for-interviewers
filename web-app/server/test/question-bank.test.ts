import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { QuestionBankHit } from '@open-cluely/contract';
import { createApp } from '../src/app';

interface CompaniesResponse {
  companies: { name: string; count: number }[];
}

interface QuestionsResponse {
  total: number;
  page: number;
  pageSize: number;
  items: QuestionBankHit[];
}

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /api/question-bank/companies returns a non-empty, count-desc list', async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/question-bank/companies`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as CompaniesResponse;
    assert.ok(Array.isArray(body.companies));
    assert.ok(body.companies.length > 0, 'expected at least one company');

    // Each entry has a name + positive count.
    for (const c of body.companies.slice(0, 5)) {
      assert.equal(typeof c.name, 'string');
      assert.ok(c.count > 0);
    }

    // Sorted by count descending.
    for (let i = 1; i < body.companies.length; i += 1) {
      assert.ok(body.companies[i - 1].count >= body.companies[i].count);
    }
  });
});

test('GET /api/question-bank/questions filters by q and paginates', async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/question-bank/questions?q=redis&pageSize=5`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as QuestionsResponse;
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 5);
    assert.ok(body.items.length <= 5, 'page must not exceed pageSize');
    assert.ok(body.total >= body.items.length);

    // Every returned question matches the case-insensitive substring filter.
    for (const item of body.items) {
      assert.ok(item.question.toLowerCase().includes('redis'), `"${item.question}" should contain redis`);
      assert.equal(item.score, 0, 'browse hits have score 0');
    }

    // Redis appears in the bank, so we expect at least one hit.
    assert.ok(body.total > 0, 'expected at least one redis question in the bank');
  });
});

test('GET /api/question-bank/questions clamps oversized pageSize to 100', async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/question-bank/questions?pageSize=9999`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as QuestionsResponse;
    assert.equal(body.pageSize, 100);
  });
});
