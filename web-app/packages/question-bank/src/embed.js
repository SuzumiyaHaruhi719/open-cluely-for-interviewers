'use strict';

/**
 * DashScope text-embedding-v4 client (native API).
 *
 * IMPORTANT: this DashScope key is entitled to text-embedding-v4 ONLY, on the
 * NATIVE endpoint (not the OpenAI-compatible `/compatible-mode/v1/embeddings`,
 * which rejects this key's requests as "Required body invalid"). Native shape:
 *   POST /api/v1/services/embeddings/text-embedding/text-embedding
 *   Authorization: Bearer <key>
 *   { "model": "text-embedding-v4", "input": { "texts": [...] }, "parameters": { "dimension": 512 } }
 *   → { "output": { "embeddings": [ { "embedding": number[], "text_index": n }, ... ] }, "usage": {...} }
 *
 * Verified working from Node (UTF-8 Chinese + English, dim 512 and 1024).
 */

const EMBEDDINGS_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const MODEL = 'text-embedding-v4';
const DIM = 512;
// Native text-embedding-v4 accepts up to 10 texts per request.
const MAX_BATCH = 10;

/**
 * Embed an array of texts (<= MAX_BATCH) in a single call.
 * Returns number[][] in the SAME order as `texts` (native `text_index` is used
 * to restore order). Throws on HTTP error; 429/5xx surface as "retryable".
 *
 * @param {string[]} texts
 * @param {{ apiKey: string, dim?: number, signal?: AbortSignal }} opts
 * @returns {Promise<number[][]>}
 */
async function embedTexts(texts, { apiKey, dim = DIM, signal } = {}) {
  if (!apiKey) throw new Error('embedTexts: missing apiKey');
  if (!Array.isArray(texts) || texts.length === 0) return [];
  if (texts.length > MAX_BATCH) {
    throw new Error(`embedTexts: batch of ${texts.length} exceeds MAX_BATCH ${MAX_BATCH}`);
  }
  const res = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: { texts }, parameters: { dimension: dim } }),
    signal,
  });
  if (res.status === 429 || res.status >= 500) {
    throw new Error(`retryable HTTP ${res.status}`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`embeddings HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const arr = json && json.output && json.output.embeddings;
  if (!Array.isArray(arr) || arr.length !== texts.length) {
    throw new Error(`expected ${texts.length} embeddings, got ${arr ? arr.length : 'none'}`);
  }
  return arr
    .slice()
    .sort((a, b) => (a.text_index ?? 0) - (b.text_index ?? 0))
    .map((e) => e.embedding);
}

/**
 * Embed a single query string. Returns number[] (or throws).
 * @param {string} text
 * @param {{ apiKey: string, dim?: number, signal?: AbortSignal }} opts
 * @returns {Promise<number[]>}
 */
async function embedQuery(text, { apiKey, dim = DIM, signal } = {}) {
  const [vec] = await embedTexts([text], { apiKey, dim, signal });
  if (!Array.isArray(vec)) throw new Error('no embedding in response');
  return vec;
}

module.exports = { embedTexts, embedQuery, EMBEDDINGS_URL, MODEL, DIM, MAX_BATCH };
