# Question-Bank RAG Grounding — Design

**Date:** 2026-06-02
**Status:** Approved (design); implementation pending
**Source:** https://github.com/resumejob/interview-questions → links to https://osjobs.net/topk/

## Problem

`resumejob/interview-questions` is **not** a structured question bank — the repo is a
README that links out to `osjobs.net/topk/<company>/`, a Vue SPA listing high-frequency
real interview questions per company. The actual content (question text, frequency vote,
difficulty, reference 面经 links) lives behind that site's backend API.

We want this corpus to **ground the interviewer-copilot's follow-up generation** so the
suggested follow-ups stay close to questions real interviewers actually ask. Approach:
**semantic-embedding RAG** feeding the Expert/Customize pipeline's question-pool stage.

## Non-Goals (YAGNI)

- No browsable question-bank UI/window in v1.
- No per-company runtime filtering in v1 (no explicit "target company" field exists; JD is
  the only hint). Company is stored in the data and can drive a filter later.
- No runtime scraping — the corpus is built offline and shipped as a static asset.

## Architecture

Three units, each independently testable:

### 1. Offline build — `scripts/build-question-bank.js`

One-shot script, run by a developer, not at app runtime. Produces `assets/question-bank/`.

Steps:
1. **Scrape** the 16 company pages under `osjobs.net/topk/<company>/` via the project's
   `/browse` headless daemon (the page is a Vue SPA; static fetch returns only template
   markup). Capture the underlying JSON the page's XHR loads. Each record:
   `{ company, question_text, vote, difficulty, refs: string[] }`.
   - **Reconnaissance gate:** the exact API endpoint/shape is unknown. Step 1 of
     implementation is to discover it with the browser before building the scraper. If the
     data proves un-scrapeable (hard auth, aggressive anti-bot), STOP and report.
2. **Dedup + clean** across companies: merge identical `question_text`, keep max `vote`,
   collect the set of source companies. Expected total: ~1–3k deduped questions.
3. **Embed** each `question_text` with DashScope `text-embedding-v4` (dim 512 to bound file
   size), batched. Same `DASHSCOPE_API_KEY`, but on the OpenAI-compat endpoint
   `https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings` (chat uses
   `/apps/anthropic`; embeddings are not on that surface).
4. **Write** two artifacts:
   - `assets/question-bank/vectors.bin` — Float32Array, row-major `[N × 512]` (~6 MB at N=3k).
   - `assets/question-bank/bank.json` — parallel metadata array, index i ↔ vector row i:
     `{ question, companies: string[], vote, difficulty, refs }`, plus a header
     `{ dim, count, model, builtAt }`.

### 2. Runtime retrieval — `src/services/ai/question-bank/retriever.js`

- On first use (lazy), load `vectors.bin` + `bank.json` into memory (resident, ~6 MB).
  In packaged app, read from `process.resourcesPath`/asar-aware path; in dev, from `assets/`.
- `async retrieve({ queryText, topK = 5, apiKey })`:
  1. Embed `queryText` once via `text-embedding-v4` (dim 512).
  2. Brute-force cosine similarity over the N rows (ms-scale at N≤3k).
  3. Return top-K `{ question, companies, vote, difficulty, score }`.
- **Graceful degradation:** any failure (missing asset, embedding API error/timeout)
  returns `[]` and never throws into the generation chain — mirrors the orchestrator's
  fallback philosophy. Bounded by a short timeout so it can't stall the pipeline.

### 3. Injection — Block D grounding

- In `runPipelineChain` (`src/main-process/features/interviewer/expert-orchestrator.js`),
  fire `retrieve({ queryText: candidateAnswer })` **in parallel with the A∥C blocks** so it
  adds no serial latency.
- Pass the resolved top-K as a new optional `bankQuestions` field into `buildBlockD(...)`.
  Block D's prompt gains a section: "real high-frequency interview questions in this area —
  use as direction hints for the follow-up, but you MUST anchor on the candidate's latest
  answer; do not copy these verbatim."
- Blocks A/B/C/E/F/G unchanged. If `bankQuestions` is empty, Block D behaves exactly as today.
- Latency: one extra embedding call (~100–300 ms) overlapped with A∥C → effectively free.

## Data Flow

```
[offline]  osjobs.net (browse daemon) → records → dedup → embed(v4,512) → vectors.bin + bank.json
[runtime]  candidateAnswer ─┐
                            ├─(parallel with A∥C)→ retriever.retrieve() → top-K bankQuestions
           buildBlockD(... bankQuestions) → candidate pool → E rank → F safety → G render
```

## Config / State

- Reuses `getApiKey()` (DashScope) — no new credential.
- New constant for the embeddings base URL + model id (add to `src/config.js`).
- No new `app-state.js` fields in v1.

## Error Handling

- Build script: per-company scrape failures are logged and skipped, not fatal; embedding
  failures abort the build with a clear message (don't ship a half-empty bank).
- Retriever: every failure path → `[]`. Asset-missing is a warn-once, not a crash.

## Testing

- `retriever` unit tests: cosine ranking correctness on a tiny fixture bank; empty-bank
  degradation; embedding-API-failure degradation; topK bounds.
- Block D injection test: `bankQuestions` present → prompt contains the grounding section;
  empty → prompt byte-identical to today (protects the existing equivalence oracle).
- Build script: a small fixture-driven dedup/merge unit test (no live network).

## Gotchas

- Embeddings are on `/compatible-mode/v1`, NOT the `/apps/anthropic` surface used for chat.
- Vue SPA → must use the headless browser to capture XHR JSON; raw HTML fetch is useless.
- The deduped high-frequency list is far smaller than "2200 面经" (those are raw posts).
- Asset path differs dev vs packaged (asar) — retriever must resolve both.
