'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { dot, norm, cosineSimilarity, topK } = require('../src/cosine');

test('dot product computes correctly', () => {
  assert.strictEqual(dot([1, 2, 3], [4, 5, 6]), 32); // 4 + 10 + 18
});

test('norm computes L2 length', () => {
  assert.strictEqual(norm([3, 4]), 5);
});

test('orthogonal vectors have cosine similarity 0', () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.strictEqual(cosineSimilarity(a, b), 0);
});

test('identical vectors have cosine similarity ~1', () => {
  const a = [0.2, 0.5, 0.9];
  const sim = cosineSimilarity(a, a);
  assert.ok(Math.abs(sim - 1) < 1e-6, `expected ~1, got ${sim}`);
});

test('parallel (scaled) vectors have cosine similarity ~1', () => {
  const a = [1, 2, 3];
  const b = [2, 4, 6];
  const sim = cosineSimilarity(a, b);
  assert.ok(Math.abs(sim - 1) < 1e-6, `expected ~1, got ${sim}`);
});

test('opposite vectors have cosine similarity ~ -1', () => {
  const a = [1, 0];
  const b = [-1, 0];
  assert.ok(Math.abs(cosineSimilarity(a, b) - -1) < 1e-6);
});

test('cosine similarity returns 0 when one norm is 0', () => {
  assert.strictEqual(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
  assert.strictEqual(cosineSimilarity([1, 2, 3], [0, 0, 0]), 0);
});

test('topK returns correct indices and order on a 4x3 matrix', () => {
  // 4 rows, 3 dims, row-major flat matrix.
  const matrix = Float32Array.from([
    1, 0, 0, // row 0 - matches query exactly
    0, 1, 0, // row 1 - orthogonal
    0.9, 0.1, 0, // row 2 - very close to query
    -1, 0, 0, // row 3 - opposite
  ]);
  const query = [1, 0, 0];

  const result = topK(query, matrix, 4, 2);
  assert.strictEqual(result.length, 2);
  // Best match is row 0 (identical), then row 2 (closest non-identical).
  assert.strictEqual(result[0].index, 0);
  assert.strictEqual(result[1].index, 2);
  // Scores descending.
  assert.ok(result[0].score >= result[1].score);
  assert.ok(Math.abs(result[0].score - 1) < 1e-6);
});

test('topK clamps k to number of rows', () => {
  const matrix = Float32Array.from([1, 0, 0, 1]); // 2 rows x 2 dims
  const result = topK([1, 0], matrix, 2, 10);
  assert.strictEqual(result.length, 2);
});

test('topK infers dim from matrix.length / n', () => {
  // 3 rows x 4 dims = 12 entries. If dim inference is wrong this throws/misranks.
  const matrix = Float32Array.from([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
  ]);
  const query = [0, 0, 1, 0];
  const result = topK(query, matrix, 3, 1);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].index, 2); // the [0,0,1,0] row
  assert.ok(Math.abs(result[0].score - 1) < 1e-6);
});

test('topK returns empty array for empty matrix or non-positive args', () => {
  assert.deepStrictEqual(topK([1, 2], Float32Array.from([]), 0, 5), []);
  assert.deepStrictEqual(topK([1, 2], Float32Array.from([1, 2]), 1, 0), []);
});
