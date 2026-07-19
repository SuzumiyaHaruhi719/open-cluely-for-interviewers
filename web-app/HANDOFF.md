# Agent Handoff — Open-Cluely Web (Interviewer Copilot)

Web edition: a React SPA + Node server (one process) that reuses the desktop app's
interviewer brain. Generates follow-up questions for the **interviewer**, gated to
the **candidate's** speech.

---

## ▶ How to start the web app

**Prerequisites:** Node ≥ 20 and npm.

```bash
cd web-app
npm install                 # installs all workspaces (contract, copilot-core, question-bank, server, web)
```

**1. Configure secrets** — create `web-app/.env` (gitignored):

```ini
# Required: DashScope key (used for the LLM brain AND the Paraformer ASR fallback)
DASHSCOPE_API_KEY=sk-xxxxxxxx

# Optional: Doubao / Volcengine ASR defaults (better Chinese transcription than Paraformer-8k).
# If omitted, you can still type them into Settings → "Doubao API (豆包语音)" in the UI.
VOLC_APP_ID=...
VOLC_ACCESS_TOKEN=...
VOLC_RESOURCE_ID=volc.bigasr.sauc.duration   # 1.0 model; the 2.0 (seedasr) needs separate account enablement

# Optional but recommended for offline interviews: native speaker clusters.
XFYUN_APP_ID=...
XFYUN_API_KEY=...
XFYUN_API_SECRET=...
```

**2a. Run (production-like — build once, serve):**

```bash
npm run build               # tsc -b + vite build for web + server
npm start                   # node server/dist/index.js
# → open http://localhost:8787   (SPA at /, JSON API at /api/*, copilot WebSocket at /ws)
```

**2b. Run (development — hot reload):**

```bash
npm run dev                 # vite dev server + server in watch, in parallel
```

**Health check:** `curl http://localhost:8787/api/health` → `{"ok":true,...,"hasKey":true}`

---

## Online vs offline interview modes

- **Online** (default, two channels): candidate via shared-tab/system audio, interviewer
  via mic. Just `npm start` + open the page. ASR = Paraformer (DashScope key) or Doubao
  (creds), iFlytek, or the simulation provider.
- **Offline** (single room mic): one microphone captures the room. iFlytek is recommended
  because `role_type=2` returns native acoustic speaker clusters. DeepSeek v4 Flash maps
  clusters to interviewer/candidate after enough conversational evidence and re-checks on
  stop. Paraformer/Doubao have no native cluster in the current integration, so Flash
  partitions their finalized turns semantically and performs a final pass at interview end.

---

## Current state (what works)

- Online + offline ASR; provider selectable (Paraformer / Doubao) in both modes.
- Native iFlytek speaker clusters plus DeepSeek v4 Flash automatic role mapping; semantic
  fallback for text-only providers; one-tap manual correction always wins.
- **Add note to context** — folds the interviewer's manual note into the candidate context
  the autonomous trigger watches (auto + manual Generate-Q both see it); shows a 📝 Note line.
- **Per-interview isolation** — new chat starts clean; switching chats restores each chat's
  own transcript (offline segments persisted with the session).
- Live/partial transcript shows "输入中…" until finalized.
- Question-bank semantic search + pagination; room-mic test in Settings.

## Pending / next steps

- **Panels / over-clustering:** Flash may map several native cluster IDs to interviewer;
  preserve raw IDs and monitor confidence rather than folding them by first-seen order.
- **Doubao floods identical partials** (~150×/utterance before advancing) — consider partial de-dup.

## 🔐 Security note

`web-app/.env` holds live Volcengine ASR creds that were pasted in chat earlier. They were
written ONLY to the gitignored `.env` (never committed, never logged). **Rotate them** —
the chat is auto-archived to a GitHub-backed Obsidian vault.

## Key entry points

- `server/src/ws.ts` — WS protocol, `dispatch()`, per-connection `feedCandidateAnswer` seam, `applyAsrConfig`.
- `server/src/asr-relay.ts` — ASR provider routing and native speaker-id forwarding.
- `server/src/speaker-partitioner.ts` — Flash role classifier, evidence thresholds, final pass.
- `server/src/auto-trigger.ts` — autonomous Generate-Q gate.
- `web/src/desktop/Shell.tsx` — session lifecycle (`onClearSession`/`onNewInterview`/`onSelectSession`), persistence effects, `onAddNote`.
- `web/src/lib/useCopilotSocket.ts` — socket hook (`analyze`, `addContextNote`, `resetTranscripts`, `speakerSegments`).
- `web/src/desktop/TranscriptStream.tsx` — lanes, speaker bubbles, NoteLine, "输入中…" live label.
