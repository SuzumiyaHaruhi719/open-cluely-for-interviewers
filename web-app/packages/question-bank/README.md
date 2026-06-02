# @open-cluely/question-bank

A self-contained Node.js package that scrapes a public interview-question API,
builds a semantic-search index with text embeddings, and exposes a retriever for
nearest-neighbour question lookup.

No runtime dependencies. CommonJS, Node 24, built-in global `fetch`, and the
built-in `node:test` runner.

## What it does

1. **Scrape** — pulls interview questions for a fixed list of companies from the
   public [osjobs.net](https://osjobs.net) JSON API, dedups them across companies,
   and writes `data/bank.raw.json`.
2. **Build embeddings** — embeds each question with Alibaba DashScope's
   OpenAI-compatible `text-embedding-v4` model (512-dim) and writes a binary
   vector matrix (`data/vectors.bin`) plus aligned metadata (`data/bank.json`).
3. **Retrieve** — `createRetriever()` loads the index lazily and returns the
   top-k most similar questions for a query string via cosine similarity.

## Data source

osjobs.net exposes a clean public JSON REST API (no auth, no anti-bot). Endpoints used:

| Endpoint | Purpose |
| --- | --- |
| `GET /topk/api/category.json` | List all companies (used only to log companies we are NOT scraping). |
| `GET /topk/api/subcategory.json?category=<COMPANY>` | Subcategories for a company. |
| `GET /topk/api/question.json?category=<COMPANY>&sub_category=<ID>` | Questions for a company + subcategory. |

Company names are Chinese and sent URL-encoded (`encodeURIComponent`).
Every request sends `User-Agent: Mozilla/5.0`, waits ~150ms between calls, and
retries up to 3 times with exponential backoff. A single company/subcategory
failure is logged and skipped — never fatal.

`difficulty`: `1` = easy, `2` = medium, `3` = hard.

Companies scraped: 谷歌, 脸书, 苹果, 亚马逊, 腾讯, 阿里, 字节跳动, Shopee, 美团, 滴滴, 百度, 京东, 快手, 拼多多.

## Usage

### 1. Scrape the question bank (network required)

```bash
npm run scrape
```

Writes `data/bank.raw.json` and prints total / deduped / per-company counts.
It also logs any company in `category.json` that is not in the scrape list.

### 2. Build the embedding index (requires an API key)

```bash
DASHSCOPE_API_KEY=sk-xxxx npm run build-embeddings
```

On Windows PowerShell:

```powershell
$env:DASHSCOPE_API_KEY="sk-xxxx"; npm run build-embeddings
```

Without `DASHSCOPE_API_KEY`, the script prints
`DASHSCOPE_API_KEY not set — skipping embedding build. Run with the key to produce vectors.bin.`
and exits cleanly (0) without writing any fake data.

### 3. Run the tests

```bash
npm test    # === node --test
```

## Data file formats

### `data/bank.raw.json`

```jsonc
{
  "scrapedAt": "2026-06-02T00:00:00.000Z",
  "count": 1234,
  "items": [
    {
      "question": "1048. Longest String Chain",
      "companies": ["谷歌", "脸书"],
      "subcategories": ["Ω 算法"],
      "difficulty": 2,            // 1=easy, 2=medium, 3=hard
      "vote": 29,
      "url": "https://leetcode.com/problems/longest-string-chain/",
      "refs": ["https://..."]    // non-empty resource1/2/3 links
    }
  ]
}
```

Dedup rule (across companies, keyed by exact `question` text): keep the **max**
`vote`, the **union** of `companies` and `subcategories`, the **first non-empty**
`url`, and the **union** of non-empty resources in `refs`.

### `data/vectors.bin`

Raw `Float32Array`, `N` rows × `512` dims, **row-major, little-endian**. No
header. Row `i` is the embedding of `items[i].question` in `bank.json`. Read it
back with:

```js
const buf = fs.readFileSync('data/vectors.bin');
const floats = buf.byteLength / 4;            // N * 512
const matrix = new Float32Array(floats);
for (let i = 0; i < floats; i++) matrix[i] = buf.readFloatLE(i * 4);
```

### `data/bank.json`

```jsonc
{
  "dim": 512,
  "model": "text-embedding-v4",
  "count": 1234,
  "builtAt": "2026-06-02T00:00:00.000Z",
  "items": [ /* same item objects as bank.raw, index-aligned with vector rows */ ]
}
```

## Retriever API

```js
const { createRetriever } = require('@open-cluely/question-bank');

const retriever = createRetriever({
  dataDir,           // default: ../data relative to src/
  apiKey,            // default: process.env.DASHSCOPE_API_KEY
  embedQuery,        // optional: (text) => Promise<Float32Array|number[]>
});

retriever.isReady();  // boolean — true if bank.json + vectors.bin loaded OK

const hits = await retriever.retrieve({ queryText: 'dynamic programming on strings', topK: 5 });
// → [{ question, companies, subcategories, difficulty, vote, url, score }, ...]
```

### Behaviour guarantees

- `bank.json` + `vectors.bin` are loaded **lazily** on the first `retrieve`/`isReady`
  call and cached.
- If either file is missing or corrupt (size mismatch), the retriever is **not ready**
  and `retrieve` returns `[]`.
- The default `embedQuery` calls the DashScope embeddings endpoint with a single
  input (dim 512). You can inject a custom `embedQuery` (e.g. for tests).
- The embed call is wrapped in a **5s timeout** (`AbortController`); on timeout it
  returns `[]`.
- `retrieve` **never throws** — on any error (no key, no embedder, embed failure,
  timeout, invalid query) it resolves to `[]`.

## Module layout

| File | Responsibility |
| --- | --- |
| `scripts/scrape.js` | Scrape + dedup → `data/bank.raw.json`. |
| `scripts/build-embeddings.js` | Embed questions → `data/vectors.bin` + `data/bank.json`. |
| `src/cosine.js` | Pure vector math: `dot`, `norm`, `cosineSimilarity`, `topK`. |
| `src/retriever.js` | `createRetriever()` — lazy load + query + rank. |
| `test/cosine.test.js` | Unit tests for vector math. |
| `test/retriever.test.js` | Retriever tests against an in-test fixture. |
