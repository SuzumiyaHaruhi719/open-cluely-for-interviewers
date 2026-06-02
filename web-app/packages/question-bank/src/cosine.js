'use strict';

/**
 * Pure vector math helpers. No I/O, no side effects.
 * All functions operate over Float32Array or plain number[].
 */

/**
 * Dot product of two equal-length vectors.
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number}
 */
function dot(a, b) {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Euclidean (L2) norm of a vector.
 * @param {Float32Array|number[]} a
 * @returns {number}
 */
function norm(a) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * a[i];
  }
  return Math.sqrt(sum);
}

/**
 * Cosine similarity between two vectors.
 * Returns 0 if either vector has zero norm (avoids divide-by-zero / NaN).
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot(a, b) / (na * nb);
}

/**
 * Find the top-k most similar rows in a flat matrix to a query vector.
 *
 * @param {Float32Array|number[]} queryVec - query vector of length `dim`
 * @param {Float32Array|number[]} matrix - flat array of `n` rows x `dim` cols (row-major)
 * @param {number} n - number of rows in the matrix
 * @param {number} k - max number of results to return
 * @returns {{ index: number, score: number }[]} sorted descending by score, length <= k
 */
function topK(queryVec, matrix, n, k) {
  if (n <= 0 || k <= 0 || matrix.length === 0) {
    return [];
  }
  const dim = Math.floor(matrix.length / n);
  if (dim <= 0) {
    return [];
  }

  const queryNorm = norm(queryVec);
  const scores = new Array(n);
  for (let row = 0; row < n; row++) {
    const offset = row * dim;
    // Inline dot + row norm for one pass over each row.
    let dotProd = 0;
    let rowSumSq = 0;
    for (let j = 0; j < dim; j++) {
      const v = matrix[offset + j];
      dotProd += queryVec[j] * v;
      rowSumSq += v * v;
    }
    const rowNorm = Math.sqrt(rowSumSq);
    const denom = queryNorm * rowNorm;
    const score = denom === 0 ? 0 : dotProd / denom;
    scores[row] = { index: row, score };
  }

  scores.sort((x, y) => y.score - x.score);
  return scores.slice(0, k);
}

module.exports = { dot, norm, cosineSimilarity, topK };
