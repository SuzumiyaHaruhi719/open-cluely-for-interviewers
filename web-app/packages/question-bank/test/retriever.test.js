'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRetriever } = require('../src/retriever');

/**
 * Build a temp data dir with a 3-item bank.json and a matching 3x3 vectors.bin.
 * Returns the dir path. Caller is responsible for cleanup.
 */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbank-fixture-'));
  const dim = 3;
  const items = [
    { question: 'apple item', companies: ['谷歌'], subcategories: ['算法'], difficulty: 1, vote: 5, url: 'https://a' },
    { question: 'banana item', companies: ['脸书'], subcategories: ['系统设计'], difficulty: 2, vote: 9, url: 'https://b' },
    { question: 'cherry item', companies: ['苹果'], subcategories: ['非技术'], difficulty: 3, vote: 1, url: 'https://c' },
  ];
  const bank = { dim, model: 'test', count: items.length, builtAt: new Date().toISOString(), items };
  fs.writeFileSync(path.join(dir, 'bank.json'), JSON.stringify(bank));

  // Row vectors: 3 orthonormal basis vectors so similarity is unambiguous.
  const matrix = Float32Array.from([
    1, 0, 0, // apple
    0, 1, 0, // banana
    0, 0, 1, // cherry
  ]);
  fs.writeFileSync(
    path.join(dir, 'vectors.bin'),
    Buffer.from(matrix.buffer, matrix.byteOffset, matrix.byteLength)
  );
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('retrieve ranks the nearest item first with an injected embedQuery', async () => {
  const dir = makeFixture();
  try {
    // Inject a deterministic embedder: query vector aligns with the "banana" row.
    const embedQuery = async () => Float32Array.from([0, 1, 0]);
    const retriever = createRetriever({ dataDir: dir, apiKey: 'unused', embedQuery });

    assert.strictEqual(retriever.isReady(), true);

    const results = await retriever.retrieve({ queryText: 'anything', topK: 3 });
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].question, 'banana item');
    assert.strictEqual(results[0].companies[0], '脸书');
    assert.strictEqual(results[0].difficulty, 2);
    assert.ok(Math.abs(results[0].score - 1) < 1e-6);
    // Descending scores.
    assert.ok(results[0].score >= results[1].score);
    assert.ok(results[1].score >= results[2].score);
  } finally {
    cleanup(dir);
  }
});

test('retrieve respects topK limit', async () => {
  const dir = makeFixture();
  try {
    const embedQuery = async () => Float32Array.from([1, 0, 0]);
    const retriever = createRetriever({ dataDir: dir, apiKey: 'unused', embedQuery });
    const results = await retriever.retrieve({ queryText: 'q', topK: 1 });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].question, 'apple item');
  } finally {
    cleanup(dir);
  }
});

test('retrieve returns [] when data dir is empty/missing', async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbank-empty-'));
  try {
    const embedQuery = async () => Float32Array.from([1, 0, 0]);
    const retriever = createRetriever({ dataDir: emptyDir, apiKey: 'unused', embedQuery });
    assert.strictEqual(retriever.isReady(), false);
    const results = await retriever.retrieve({ queryText: 'q', topK: 5 });
    assert.deepStrictEqual(results, []);
  } finally {
    cleanup(emptyDir);
  }
});

test('retrieve returns [] (does not throw) when embedQuery rejects', async () => {
  const dir = makeFixture();
  try {
    const embedQuery = async () => {
      throw new Error('embedding service down');
    };
    const retriever = createRetriever({ dataDir: dir, apiKey: 'unused', embedQuery });
    assert.strictEqual(retriever.isReady(), true);
    const results = await retriever.retrieve({ queryText: 'q', topK: 5 });
    assert.deepStrictEqual(results, []);
  } finally {
    cleanup(dir);
  }
});

test('retrieve returns [] when no apiKey and no injected embedQuery', async () => {
  const dir = makeFixture();
  try {
    const retriever = createRetriever({ dataDir: dir, apiKey: undefined, embedQuery: null });
    // Data is present, so it is ready...
    assert.strictEqual(retriever.isReady(), true);
    // ...but with no way to embed the query, retrieve yields [].
    const results = await retriever.retrieve({ queryText: 'q', topK: 5 });
    assert.deepStrictEqual(results, []);
  } finally {
    cleanup(dir);
  }
});

test('retrieve returns [] for empty/invalid queryText', async () => {
  const dir = makeFixture();
  try {
    const embedQuery = async () => Float32Array.from([1, 0, 0]);
    const retriever = createRetriever({ dataDir: dir, apiKey: 'unused', embedQuery });
    assert.deepStrictEqual(await retriever.retrieve({ queryText: '' }), []);
    assert.deepStrictEqual(await retriever.retrieve({}), []);
  } finally {
    cleanup(dir);
  }
});

test('retrieve returns [] on corrupt vectors.bin (size mismatch)', async () => {
  const dir = makeFixture();
  try {
    // Truncate vectors.bin so byteLength no longer matches count*dim*4.
    fs.writeFileSync(path.join(dir, 'vectors.bin'), Buffer.from([0, 1, 2, 3]));
    const embedQuery = async () => Float32Array.from([1, 0, 0]);
    const retriever = createRetriever({ dataDir: dir, apiKey: 'unused', embedQuery });
    assert.strictEqual(retriever.isReady(), false);
    assert.deepStrictEqual(await retriever.retrieve({ queryText: 'q' }), []);
  } finally {
    cleanup(dir);
  }
});
