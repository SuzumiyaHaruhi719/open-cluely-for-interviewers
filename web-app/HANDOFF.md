# Agent Handoff — Open-Cluely Web (Interviewer Copilot)

Web edition: a React SPA + Node server (one process) that reuses the desktop app's
interviewer brain. Generates follow-up questions for the **interviewer**, gated to
the **candidate's** speech.

---

## ▶ How to start the web app

**Prerequisites:** Node ≥ 20 and npm. (Offline speaker-labelling additionally needs
Docker — see the offline section.)

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

# Optional: CAM++ diarizer sidecar (offline mode only). Default below.
CAMPP_URL=http://localhost:10097
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
  (creds). No sidecar needed.
- **Offline** (single room mic): one microphone captures the whole room. Transcription stays
  on cloud Paraformer/Doubao; **speaker labels** (面试官 / 候选人) come from a local **CAM++
  sidecar**. The first voice heard = interviewer (cluster 0), the next distinct voice =
  candidate. Generate-Q is gated to candidate speech.

### Starting the CAM++ sidecar (offline only)

Easiest — compose runs server + sidecar together:

```bash
cd web-app
docker compose up --build   # CAMPP_URL is auto-wired to http://campp-sidecar:10097 inside the server
```

Server-outside-Docker / dev: run only the sidecar container (image built from
`deploy/campp-sidecar/`), publish `-p 10097:10097`, and set `CAMPP_URL=http://localhost:10097`.
If the sidecar is unreachable the interview still works — segments are just left unlabelled
(role `unknown`, never gated), so a momentarily-down sidecar never blocks anything.

> ⚠️ The sidecar here runs in **WSL2 Docker**. WSL2's idle-shutdown can kill the container;
> keep a keepalive (`wsl.exe ... sleep`) alive or `--restart unless-stopped` + a periodic ping.
> CPU is fine — per-utterance CAM++ embeddings are light, no GPU required.

---

## Current state (what works)

- Online + offline ASR; provider selectable (Paraformer / Doubao) in both modes.
- Offline CAM++ speaker diarization with one-tap role re-label per speaker bubble.
- **Add note to context** — folds the interviewer's manual note into the candidate context
  the autonomous trigger watches (auto + manual Generate-Q both see it); shows a 📝 Note line.
- **Per-interview isolation** — new chat starts clean; switching chats restores each chat's
  own transcript (offline segments persisted with the session).
- Live/partial transcript shows "输入中…" until finalized.
- Question-bank semantic search + pagination; room-mic test in Settings.

## Pending / next steps

- **Multiple interviewers (panel):** today CAM++ caps at 2 speakers (`CAMPP_MAX_SPEAKERS`).
  Proposed: raise the cap (or surface it in Settings) + default role heuristic
  "first = interviewer, second = candidate, rest = interviewer" + one-tap correction.
  Generate-Q already gates on candidate, so it generalizes once the cap is raised.
- **Doubao floods identical partials** (~150×/utterance before advancing) — consider partial de-dup.
- `DEPLOY.md`'s "live audio not wired yet" note is stale — live audio is wired now.
- The live dev sidecar at `C:\Users\Thomas\funasr-spike\campp_sidecar.py` still has `[diar]`
  debug prints; the committed `deploy/campp-sidecar/` copy is clean. Redeploy from the copy.

## 🔐 Security note

`web-app/.env` holds live Volcengine ASR creds that were pasted in chat earlier. They were
written ONLY to the gitignored `.env` (never committed, never logged). **Rotate them** —
the chat is auto-archived to a GitHub-backed Obsidian vault.

## Key entry points

- `server/src/ws.ts` — WS protocol, `dispatch()`, per-connection `feedCandidateAnswer` seam, `applyAsrConfig`.
- `server/src/asr-relay.ts` — text engine (paraformer|volc) + offline CAM++ diarize overlay.
- `server/src/campp-diarizer.ts` — HTTP client to the sidecar; `server/src/auto-trigger.ts` — autonomous Generate-Q gate.
- `web/src/desktop/Shell.tsx` — session lifecycle (`onClearSession`/`onNewInterview`/`onSelectSession`), persistence effects, `onAddNote`.
- `web/src/lib/useCopilotSocket.ts` — socket hook (`analyze`, `addContextNote`, `resetTranscripts`, `speakerSegments`).
- `web/src/desktop/TranscriptStream.tsx` — lanes, speaker bubbles, NoteLine, "输入中…" live label.
- `deploy/campp-sidecar/campp_sidecar.py` — the CAM++ diarizer sidecar (HTTP, stdlib).
