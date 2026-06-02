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
| `FUNASR_WS_URL` | no | — | WebSocket URL of the FunASR streaming-SPK service. Required only when offline interview mode is used. When running via compose, this is wired automatically to `ws://funasr:10096`. |

## Offline speaker diarization (FunASR)

Offline interview mode performs single-room-mic speaker diarization using a self-hosted
FunASR streaming-SPK service. Online mode is unaffected and continues to use only
`DASHSCOPE_API_KEY`.

**Starting the service:** the `docker-compose.yml` includes a `funasr` service that the
server `depends_on`. Run `docker compose up` from `web-app/` and both containers start
together. `FUNASR_WS_URL` is automatically set to `ws://funasr:10096` inside the server
container — no manual wiring needed when using compose.

For plain-Docker deployments, start the FunASR container separately and pass
`FUNASR_WS_URL=ws://<host>:10096` to the server container.

**GPU recommended:** the streaming-SPK path (Paraformer + CAM++ speaker embedding) is
compute-intensive. A GPU gives low-latency per-turn speaker labels. On CPU the service
still works but expect higher per-turn label latency. To enable GPU in compose, uncomment
the `deploy.resources.reservations.devices` block in the `funasr` service.

> Speech recognition & speaker diarization in offline mode are powered by **FunASR** (Paraformer / CAM++ models), © Alibaba Group, used under the FunASR Model License (attribution + model names retained per the license).

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

- **Live audio (interviewee capture) is not wired yet.** The text-driven copilot (paste the
  candidate's answer) and the question bank are fully functional. Live audio needs browser
  `getDisplayMedia`/`getUserMedia` → WS → an ASR provider, and ASR provider credentials
  (Xfyun / Volcengine / Paraformer) which are separate from the DashScope key.
- **Rebuild the question bank** (optional) after a re-scrape: `npm run scrape && DASHSCOPE_API_KEY=... npm run build-embeddings` in `packages/question-bank`, then rebuild the image.
- The desktop Electron app is unaffected by this deployment; it lives in `src/` and ships separately.
