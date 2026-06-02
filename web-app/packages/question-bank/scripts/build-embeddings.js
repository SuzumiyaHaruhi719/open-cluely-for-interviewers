'use strict';

/**
 * Reads data/bank.raw.json, embeds each question via DashScope's
 * OpenAI-compatible embeddings endpoint, and writes:
 *   - data/vectors.bin  (Float32Array, N x 512, row-major, little-endian)
 *   - data/bank.json    (metadata + items, index-aligned with vector rows)
 *
 * Requires DASHSCOPE_API_KEY. Without it, prints a message and exits 0
 * WITHOUT writing any fake data.
 *
 * Run: DASHSCOPE_API_KEY=... npm run build-embeddings
 */

const fs = require('node:fs');
const path = require('node:path');
const { embedTexts, MODEL, DIM, MAX_BATCH } = require('../src/embed');

const BATCH_SIZE = MAX_BATCH;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;
const DATA_DIR = path.join(__dirname, '..', 'data');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embed a batch of up to BATCH_SIZE strings via the native DashScope client.
 * Returns number[][] aligned to input order. Retries on 429/5xx (surfaced by
 * embedTexts as "retryable HTTP") with exponential backoff. Throws on persistent failure.
 */
async function embedBatch(apiKey, inputs) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await embedTexts(inputs, { apiKey, dim: DIM });
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(`  batch retry ${attempt}/${MAX_RETRIES - 1} after ${backoff}ms (${err.message})`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

async function main() {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  const rawPath = path.join(DATA_DIR, 'bank.raw.json');
  if (!fs.existsSync(rawPath)) {
    console.error(`Missing ${rawPath}. Run "npm run scrape" first.`);
    process.exit(1);
  }

  if (!apiKey) {
    console.log('DASHSCOPE_API_KEY not set — skipping embedding build. Run with the key to produce vectors.bin.');
    process.exit(0);
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const items = raw.items || [];
  const n = items.length;
  if (n === 0) {
    console.error('bank.raw.json has no items. Nothing to embed.');
    process.exit(1);
  }

  console.log(`Embedding ${n} questions with ${MODEL} (dim=${DIM}, batch=${BATCH_SIZE}) ...`);

  const vectors = new Float32Array(n * DIM);
  let written = 0;

  for (let start = 0; start < n; start += BATCH_SIZE) {
    const batchItems = items.slice(start, start + BATCH_SIZE);
    const inputs = batchItems.map((it) => it.question);
    const embeddings = await embedBatch(apiKey, inputs);

    for (let i = 0; i < embeddings.length; i++) {
      const emb = embeddings[i];
      if (emb.length !== DIM) {
        throw new Error(`embedding ${start + i} has dim ${emb.length}, expected ${DIM}`);
      }
      vectors.set(emb, (start + i) * DIM);
    }
    written += embeddings.length;
    process.stdout.write(`\r  embedded ${written}/${n}`);
  }
  process.stdout.write('\n');

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Write raw little-endian Float32 buffer. On all common platforms Node runs
  // (x64/arm64), the host is little-endian, so .buffer is already LE.
  const vectorsPath = path.join(DATA_DIR, 'vectors.bin');
  fs.writeFileSync(vectorsPath, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));

  const bank = {
    dim: DIM,
    model: MODEL,
    count: n,
    builtAt: new Date().toISOString(),
    items,
  };
  const bankPath = path.join(DATA_DIR, 'bank.json');
  fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2));

  console.log(`\nWrote ${vectorsPath} (${vectors.byteLength} bytes, ${n}x${DIM} float32)`);
  console.log(`Wrote ${bankPath} (${n} items)`);
}

main().catch((err) => {
  console.error('Fatal embedding build error:', err);
  process.exit(1);
});
