# Deploying Open-Cluely Web

One Node process serves everything: the JSON API, the WebSocket copilot stream, and
the React SPA. Target is a single Docker image you can hand to a company.

## What's in the image

- `src/` — the interviewer brain (pipeline, prompts, runtime), re-exported by `@open-cluely/copilot-core`.
- `web-app/` — the monorepo: built SPA (`web/dist`), bundled server (`server/dist`), `node_modules`, and the committed question-bank corpus (`packages/question-bank/data/`).
- The server listens on `PORT` (default **8787**) and serves the SPA at `/`, the API at `/api/*`, and the copilot WebSocket at `/ws`.

The DashScope key is **never** baked in — supply it at runtime.

## Build & run (plain Docker)

Build from the **repo root** (the Dockerfile needs both `src/` and `web-app/`):

```bash
docker build -f web-app/Dockerfile -t open-cluely-web:latest .
docker run --rm -p 8787:8787 -e DASHSCOPE_API_KEY=sk-xxxx open-cluely-web:latest
# open http://localhost:8787
```

## Build & run (compose)

```bash
cd web-app
# DASHSCOPE_API_KEY is read from web-app/.env or the shell environment
docker compose up --build
```

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | **yes** | — | DashScope key. `x-api-key` for chat (Anthropic-shape) + `Authorization: Bearer` for `text-embedding-v4` (native). |
| `PORT` | no | `8787` | HTTP/WS port. |
| `XFYUN_APP_ID` / `XFYUN_API_KEY` / `XFYUN_API_SECRET` | no | — | Enables iFlytek realtime ASR with native acoustic speaker clusters; recommended for offline single-mic interviews. |

## Offline speaker partitioning

Offline interview mode records one room microphone. With iFlytek selected, one ASR stream
returns text plus native acoustic cluster IDs; DeepSeek v4 Flash maps those IDs to
interviewer/candidate from speech acts after enough evidence. With a text-only provider
(Paraformer or the current Doubao integration), Flash partitions finalized turns by semantics.
The last audio stop always requests a final pass. No local model, sidecar, extra port, or
speaker-order heuristic is required; manual corrections remain sticky.

## Health check

```bash
curl http://localhost:8787/api/health
# {"ok":true,"version":"0.1.0","questionBankReady":true,"hasKey":true}
```

## Verify the copilot (no browser)

The server is verified end-to-end: an Expert-mode analysis over the WebSocket returns a
real follow-up question (~25s, ~10k tokens) and the question-bank semantic search returns
relevant questions. See `GET /api/question-bank/search?q=...` and the `/ws` protocol in
`packages/contract`.

## Notes

- **Live audio is wired.** Browser `getDisplayMedia`/`getUserMedia` streams PCM over WS to
  iFlytek, Volcengine, Paraformer, or the simulation harness.
- **Rebuild the question bank** (optional) after a re-scrape: `npm run scrape && DASHSCOPE_API_KEY=... npm run build-embeddings` in `packages/question-bank`, then rebuild the image.
- The desktop Electron app is unaffected by this deployment; it lives in `src/` and ships separately.
