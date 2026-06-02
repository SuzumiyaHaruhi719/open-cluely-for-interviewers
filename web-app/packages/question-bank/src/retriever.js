'use strict';

/**
 * Semantic-search retriever over the embedded question bank.
 *
 * Loads data/bank.json (metadata) + data/vectors.bin (Float32 matrix) lazily
 * on first retrieve. Embeds the query via DashScope (or an injected embedder)
 * and returns the top-k most similar questions by cosine similarity.
 *
 * The public surface NEVER throws: any failure (missing data, no key, embed
 * error, timeout) resolves to an empty array.
 */

const fs = require('node:fs');
const path = require('node:path');
const { topK } = require('./cosine');
const { embedQuery: nativeEmbedQuery, DIM } = require('./embed');

const EMBED_TIMEOUT_MS = 5000;

/**
 * Default query embedder: calls DashScope text-embedding-v4 (native API) with a
 * single input. See ./embed.js for why the native endpoint is required.
 * @param {string} text
 * @param {string} apiKey
 * @param {AbortSignal} [signal]
 * @returns {Promise<number[]>}
 */
async function defaultEmbedQuery(text, apiKey, signal) {
  return nativeEmbedQuery(text, { apiKey, dim: DIM, signal });
}

/**
 * Create a retriever instance.
 *
 * @param {object} [opts]
 * @param {string} [opts.dataDir] directory containing bank.json + vectors.bin
 * @param {string} [opts.apiKey] DashScope API key (defaults to env)
 * @param {(text: string) => Promise<Float32Array|number[]>} [opts.embedQuery]
 *        custom query embedder (overrides the default DashScope call)
 * @returns {{ retrieve: Function, isReady: Function }}
 */
function createRetriever(opts = {}) {
  const {
    dataDir = path.join(__dirname, '..', 'data'),
    apiKey = process.env.DASHSCOPE_API_KEY,
    embedQuery = null,
  } = opts;

  /** @type {null | { dim, count, items, matrix }} */
  let cache = null;
  let loadAttempted = false;
  let ready = false;

  function load() {
    loadAttempted = true;
    try {
      const bankPath = path.join(dataDir, 'bank.json');
      const vectorsPath = path.join(dataDir, 'vectors.bin');
      if (!fs.existsSync(bankPath) || !fs.existsSync(vectorsPath)) {
        ready = false;
        return;
      }

      const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
      const dim = bank.dim;
      const items = bank.items || [];
      const count = typeof bank.count === 'number' ? bank.count : items.length;

      if (!dim || count <= 0 || items.length !== count) {
        ready = false;
        return;
      }

      const buf = fs.readFileSync(vectorsPath);
      const expectedFloats = count * dim;
      const expectedBytes = expectedFloats * Float32Array.BYTES_PER_ELEMENT;
      if (buf.byteLength !== expectedBytes) {
        // Corrupt / mismatched vectors file.
        ready = false;
        return;
      }

      // Copy into a fresh Float32Array so alignment is guaranteed.
      const matrix = new Float32Array(expectedFloats);
      for (let i = 0; i < expectedFloats; i++) {
        matrix[i] = buf.readFloatLE(i * Float32Array.BYTES_PER_ELEMENT);
      }

      cache = { dim, count, items, matrix };
      ready = true;
    } catch (_err) {
      cache = null;
      ready = false;
    }
  }

  function ensureLoaded() {
    if (!loadAttempted) load();
    return ready;
  }

  /**
   * @returns {boolean} whether the bank + vectors loaded successfully.
   */
  function isReady() {
    return ensureLoaded();
  }

  /**
   * Embed the query with a 5s timeout. Returns null on any failure/timeout.
   */
  async function embedWithTimeout(queryText) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    try {
      let vec;
      if (typeof embedQuery === 'function') {
        // Injected embedder: race it against the abort timeout.
        vec = await Promise.race([
          Promise.resolve(embedQuery(queryText)),
          new Promise((_resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error('embed timeout')), { once: true });
          }),
        ]);
      } else {
        vec = await defaultEmbedQuery(queryText, apiKey, controller.signal);
      }
      if (!vec || typeof vec.length !== 'number' || vec.length === 0) {
        return null;
      }
      return vec;
    } catch (_err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {object} args
   * @param {string} args.queryText
   * @param {number} [args.topK=5]
   * @returns {Promise<Array>} ranked results, or [] on any problem (never throws).
   */
  async function retrieve({ queryText, topK: k = 5 } = {}) {
    try {
      if (!queryText || typeof queryText !== 'string') return [];
      if (!ensureLoaded() || !cache) return [];
      // Need either an injected embedder or an api key for the default one.
      if (typeof embedQuery !== 'function' && !apiKey) return [];

      const queryVec = await embedWithTimeout(queryText);
      if (!queryVec) return [];

      const hits = topK(queryVec, cache.matrix, cache.count, k);
      return hits.map(({ index, score }) => {
        const item = cache.items[index];
        return {
          question: item.question,
          companies: item.companies,
          subcategories: item.subcategories,
          difficulty: item.difficulty,
          vote: item.vote,
          url: item.url,
          score,
        };
      });
    } catch (_err) {
      return [];
    }
  }

  return { retrieve, isReady };
}

module.exports = { createRetriever };
