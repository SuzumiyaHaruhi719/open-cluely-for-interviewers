# Open-Cluely Web

The browser edition of the Open-Cluely **interviewer copilot**: it listens to an interview,
and after each candidate answer suggests a sharp follow-up question for the interviewer. It
reuses the desktop app's proven interviewer "brain" and adds a real interview-question bank.

This is an npm-workspaces monorepo. The desktop Electron app (in the repo's `../src`) is
untouched and ships separately.

## What works today (verified live)

- **Live Copilot (text-driven):** paste the candidate's answer → the Expert 7-block pipeline
  returns a primary + alternative follow-up with rationale (~25s). Streamed progress over WebSocket.
- **Question bank:** 792 real, deduped interview questions across 14 companies, browsable and
  **semantically searchable** (DashScope `text-embedding-v4`).
- **RAG grounding:** each analysis retrieves the top-6 most-similar real questions and feeds
  them into Block D as direction hints (additive; off = identical to the desktop pipeline).
- **One server** serves the API, the copilot WebSocket, and the React SPA.
- **Live audio (interviewee + interviewer):** browser capture → Paraformer ASR relay →
  live transcript. (Connectivity verified with the DashScope key; full speech-to-text needs
  a real mic / shared-tab audio in a Chromium browser.)
- **Offline speaker partitioning:** iFlytek supplies native acoustic clusters when selected;
  DeepSeek v4 Flash maps them to interviewer/candidate after enough evidence, with a semantic
  final-pass fallback for text-only ASR providers. No local speaker model is required.

## Layout

```
packages/contract       shared WS/HTTP protocol (types + constants)
packages/copilot-core   headless façade over the Electron-free brain (re-exports ../../../src)
packages/question-bank  scrape + embed + semantic retriever (+ committed data)
server                  Express + ws + zod: DashScope proxy, copilot WS, QB API, serves SPA
web                     React + TS + Vite SPA: Live Copilot + Question Bank
Dockerfile, DEPLOY.md   single-image deploy
```

## Setup

```bash
cp .env.example .env       # then put your DashScope key in DASHSCOPE_API_KEY
npm install                # from web-app/ (workspaces)
```

The DashScope key is used for both chat (Anthropic-shape endpoint) and embeddings
(`text-embedding-v4`, native endpoint). It stays server-side; the browser never sees it.

## Develop

```bash
npm run dev                # server (:8787) + web (vite dev, proxies /api and /ws)
```

## Test

```bash
npm test                   # contract/copilot-core/question-bank (node:test) + server (tsx) + web (vitest)
```

41+ tests. (Note: run tests via `npm test`, not a bare repo-root `node --test`, which would
also sweep the web's vitest files.)

## Build & run (production)

```bash
npm run build              # web → web/dist, server → server/dist
npm start                  # node server serving API + WS + SPA on :8787
```

## Deploy

Single Docker image — see [DEPLOY.md](./DEPLOY.md). Build from the **repo root** so the brain
in `../src` is in the context.

## Rebuild the question bank (optional)

```bash
cd packages/question-bank
npm run scrape                                  # osjobs.net → data/bank.raw.json (no key)
DASHSCOPE_API_KEY=... npm run build-embeddings  # → data/vectors.bin + data/bank.json
```

## Notes

- **Use Expert mode** for real follow-ups. Fast mode inherits a known desktop-brain gate bug
  and produces no question.
- Interviewee audio in the browser uses `getDisplayMedia` (Chrome/Edge; tick "share tab audio") —
  the browser cannot do the desktop app's per-process loopback capture.
