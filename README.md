# Open-Cluely

Open-Cluely is an Electron desktop copilot for live interviews and meetings. **This fork pivots it into an interviewer-side copilot**: it transcribes the candidate's answer in real time and proposes the single sharpest follow-up question to ask next — anchored to a phrase the candidate actually said, and chosen to surface the evidence they're glossing over. The original candidate-side answer tools (Ask AI / Screen AI / Suggest / Notes) remain available as secondary helpers.

All hosted AI runs through **Aliyun DashScope** (DeepSeek V4 + Qwen 3.x) on a single API key; speech-to-text is **pluggable** (Paraformer, AssemblyAI, iFlytek RTASR, or offline Vosk). Compact, always-on-top, with an optional mobile companion.

Use it only in environments where recording, transcription, screenshots, and AI assistance are allowed and disclosed as your context requires.

## Looks

<img width="1137" height="1014" alt="image" src="https://github.com/user-attachments/assets/b9250f36-5623-45da-ab8e-8265ee079e92" />
<img width="1137" height="1019" alt="image" src="https://github.com/user-attachments/assets/68c14d18-fcb3-4ee5-9f98-d137b744156e" />

---

## Features

- **Interviewer copilot** — generates the next high-value follow-up question from the candidate's latest answer, in **Fast** (2-stage) or **Expert** (7-block) mode. See [Interviewer Copilot](#interviewer-copilot-the-pivot) below.
- **Dual-source live transcription** for host/system audio and microphone input, with per-source toggles and a live monitor. Pick the exact mic and system-audio source — virtual loopback cable, Windows per-process loopback, or a screen source — in **Settings → Audio devices**.
- **Pluggable speech-to-text** via an ASR router: Paraformer (DashScope), AssemblyAI, iFlytek RTASR, or offline Vosk.
- **One DashScope key for all hosted AI** — DeepSeek V4 (`pro`/`flash`) + Qwen 3.x (including `qwen3-vl-*` for screenshots), through Aliyun DashScope's Anthropic-shape endpoint. Gemini and Ollama have been removed.
- **Candidate-side answer tools** (Ask AI / Screen AI / Suggest / Notes / Insights) retained under a **More ▾** menu, each with per-message `AI` / `Off` context toggles so you control exactly what goes into the next prompt.
- **Prompt training & evaluation harness** — a 1000-fixture diversity corpus plus scripts to evaluate each block and the full chain. See [Prompt Training & Evaluation](#prompt-training--evaluation).
- Session state persists to `cache/app-state.json`; screenshot retention is bounded by `MAX_SCREENSHOTS`.
- **Mobile companion** — a built-in web server exposes a mobile-optimised chat interface on port `7823` (setup details below).

## Interviewer Copilot (the pivot)

The headline feature of this fork. Instead of answering *for* the candidate, it helps the **interviewer**: it reads the candidate's most recent answer (plus the resume, job description, and question history) and proposes the single best **follow-up question** to ask next — one anchored to a verbatim phrase the candidate actually said, chosen to surface the evidence they're dodging.

It runs in one of two modes, selected in **Settings → Interviewer mode** (default `fast`):

### Fast mode (default) — 2-stage Flash chain

- **Stage 1** detects the weak / unsubstantiated "hooks" in the answer (vague metrics, team-credit-only ownership, timeline gaps).
- **Stage 2** generates a grounded follow-up that quotes one hook verbatim.
- ~1.5–3 s on `deepseek-v4-flash`. Best when live-interview latency matters.

### Expert mode — 7-block deep pipeline

A DAG of seven specialized blocks (`A∥C → B → D → E → F → G`):

| Block | Role |
|-------|------|
| **A** · Answer Anatomy | extract claims, each tagged with a `raw_span` (a verbatim substring of the answer) |
| **C** · State Update | track drilled topics + next competency target (runs in parallel with A) |
| **B** · Evidence Gap | what's missing, over-claimed, or contradictory |
| **D** · Question Pool | 5 candidate questions, ≥3 distinct question-types, each anchored to a `raw_span` |
| **E** · Rank & Score | rank candidates on a 6-dimension rubric (`deepseek-v4-pro`) |
| **F** · Safety Audit | regex + LLM check on the top-2 (bias / illegal / off-limits) |
| **G** · Final Render | emit the chosen question + interviewer rationale |

Every block validates against a JSON schema, retries once on failure, and falls back to a schema-compliant placeholder if it can't converge — so a slow or failed block **degrades gracefully instead of crashing the chain**. Expert mode trades ~4–8 s of latency for materially better-anchored, harder-to-dodge questions. Full design + tuning history is in [`PROMPT_TRAINING_LOG.md`](./PROMPT_TRAINING_LOG.md).

> **Models:** the interviewer copilot uses `deepseek-v4-flash` by default (Block E uses `deepseek-v4-pro`). Set the default in `DEFAULT_INTERVIEWER_MODEL` / `BLOCK_MODELS`.

---

## Candidate-side answer tools (secondary)

> These are the original Open-Cluely answer buttons. After the interviewer-copilot pivot they are secondary and live under the **More ▾** menu in the top bar. Each sends a different slice of context to the AI for a different moment in the workflow.

### Ask AI

The full-context answer button. Use this when you want a complete, thorough response.

**What it sends:** all enabled transcript messages + all enabled screenshots + full conversation history.

**What it does:** reads the entire context as one unified thread, silently corrects speech-to-text recognition errors, identifies the actual question being asked (even across fragmented or imperfect transcript messages), and produces a complete answer.

**Output:**
- **Understanding** — one sentence confirming what it understood the question to be
- **Answer** — full response, as deep as the question requires
- For coding and algorithmic questions: **Approach → Full solution code → Time/Space complexity → Key points**

Use Ask AI when you need the complete answer, not just the opening move.

---

### Screen AI

The screenshot interpreter. Use this when the question or problem is visible on screen.

**What it sends:** only the screenshots currently enabled in context.

**What it does:** reads all visible text in the screenshot (constraints, function signatures, error messages, sample I/O), identifies what type of content it is (LeetCode problem, stack trace, terminal output, UI layout, architecture diagram), and responds accordingly.

**Output (for coding/debugging):**
- **Understanding → Approach → Complexity → Full runnable solution code → Explanation** (only if it adds value)

**Output (for non-coding screenshots — UI, architecture, docs):**
- **What I see → Answer → Key Points**

Use Screen AI when the problem is on your screen and you want a direct solution without needing to describe it in words.

---

### Suggest

The opening-move button. Use this when you want something ready to say right now, without the full depth of Ask AI.

**What it sends:** only the enabled transcript messages.

**What it does:** reads the full conversation flow, identifies where the discussion stands, and generates a concise spoken response — something you can say out loud immediately, not a written essay.

**Output:**
- **Best response (say this)** — 2–4 sentences, natural spoken language, technically accurate but not exhaustive
- **Key points** — 2–3 short anchor concepts to hold in mind and expand on if pushed
- **Optional follow-ups** — questions or angles the other person is likely to raise next

Use Suggest to open confidently. Use Ask AI when the interviewer pushes deeper and you need the full answer.

---

### Notes

The structured record button. Use this at any point to capture what has happened in the session.

**What it sends:** all enabled transcript messages and context.

**What it does:** organizes the conversation into a clean, topic-grouped document — correcting for STT noise throughout. Does not add inferences or assumptions not grounded in the actual conversation.

**Output (always all five sections, even if empty):**
- **Key Discussion Points** — main topics covered
- **Decisions Made** — with owner if mentioned
- **Action Items** — checkboxed, with owner and deadline if mentioned
- **Open Questions / Unresolved Items** — what was raised but not resolved
- **Next Steps** — what happens next based on the conversation

Use Notes to produce a shareable record at the end of a meeting or interview debrief.

## Installation

### Requirements

- Windows 10/11 is the primary development target for this repo.
- Node.js `20.x`+ is recommended (the environment was prepared around `20.20.1`; the eval scripts also run under Node 24).
- npm `10+`
- One **Aliyun DashScope** API key — powers all hosted AI (DeepSeek V4 + Qwen 3.x on the Anthropic-shape endpoint); configured in the in-app Settings UI.
- A key for whichever speech-to-text provider you enable — Paraformer (DashScope key), AssemblyAI, or iFlytek RTASR. Offline **Vosk** needs no key (see [`SETUP-VOSK.md`](./SETUP-VOSK.md)).

### Setup

```powershell
nvm install 20.20.1
nvm use 20.20.1
npm ci
Copy-Item .env.example .env
```

API keys are configured from the in-app Settings panel after launch.

Start the app:

```powershell
npm start
```

Useful variants:

```powershell
npm run dev
npm run start:hidden
```

### Recommended For Windows Use

For day-to-day use on Windows, prefer building the portable app and running the generated `.exe` instead of launching from source every time.

```powershell
npm run build:win
```

This creates:

```text
dist/GoogleChrome.exe
```

You can then run the packaged app directly by double-clicking `dist/GoogleChrome.exe`.

### Native Windows Build Tools

This app depends on native modules. If `npm ci` fails with `node-gyp` or Visual Studio toolchain errors, install the C++ build tools and Python:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --accept-package-agreements --accept-source-agreements --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## Configuration

### Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `HIDE_FROM_SCREEN_CAPTURE` | No | Defaults to `true`. Controls `BrowserWindow.setContentProtection(...)`. |
| `START_HIDDEN` | No | Defaults to `false`. Also available at runtime via `npm run start:hidden` or `--start-hidden`. |
| `MAX_SCREENSHOTS` | No | Defaults to `50`. Old screenshots are deleted when the limit is exceeded. |
| `SCREENSHOT_DELAY` | No | Defaults to `300` ms. Delay used while briefly hiding the window before capture. |
| `NODE_ENV` | No | Defaults to `production`. `development` opens DevTools automatically. |
| `NODE_OPTIONS` | No | Defaults to `--max-old-space-size=4096`. |

### Source-Of-Truth Config

[`src/config.js`](./src/config.js) defines the app's configurable lists and defaults:

- `DASHSCOPE_AI_MODELS` and `DASHSCOPE_BASE_URL` — hosted models on the DashScope Anthropic-shape endpoint (`deepseek-v4-pro` default, `deepseek-v4-flash`, `qwen3.6-*` / `qwen3.7-max`, `qwen3-vl-*` for screenshots).
- `DEFAULT_INTERVIEWER_MODEL` — model for the interviewer copilot's Fast 2-stage chain (`deepseek-v4-flash`).
- Programming-language options for code-oriented prompts
- Global keyboard shortcuts

The first item in each model/language list is treated as the default. ASR provider selection is handled separately by [`src/services/asr-router.js`](./src/services/asr-router.js).

### Persisted Files

- In development, state is written to `cache/app-state.json` at the repo root. Portable builds create the same `cache/app-state.json` structure next to the executable.
- Development screenshots are stored in `.stealth_screenshots/`. Packaged builds store screenshots under the app's user-data path.
- Saving settings from the UI writes API-key values and selection state to `cache/app-state.json`.

## Mobile Companion

When the app starts, a lightweight HTTP + WebSocket server starts automatically on port `7823`, bound to all interfaces. Open the **Network** URL printed at startup (e.g. `http://192.168.1.42:7823`) on a phone that shares the same network as the PC. USB tethering, Wi-Fi hotspot from the phone, or both being on the same Wi-Fi all work — no app install required.

### Setup (one time)

1. Make sure the phone and PC can reach each other over the network. Any of these works:
   - **USB tethering** — plug your phone into your PC and enable tethering. On Android: **Settings → Network → Hotspot & Tethering → USB Tethering**. On iOS: **Settings → Personal Hotspot** (then connect via USB).
   - **Phone Wi-Fi hotspot** — turn on the phone's hotspot and connect the PC to it.
   - **Same Wi-Fi** — connect both devices to the same Wi-Fi network.
2. Look at the Electron app's terminal output for lines like `[MobileServer] Network: http://192.168.1.42:7823  (Wi-Fi)`.
3. Open one of those Network URLs in your phone's browser.

### Mobile interface

| Button | What it does |
|--------|-------------|
| **Screenshot** | Triggers a stealth desktop capture. A badge shows the current count. |
| **Ask AI** | Sends the typed context (and any captured screenshots) to the AI; response streams in real time. |
| **Auto-scroll** | Toggles whether new messages snap the view to the bottom. |
| **Clear** | Clears the Gemini conversation history. |

The text input above the toolbar lets you type a question or extra context before pressing **Ask AI** or the send button. The desktop view always shows the live transcript; the mobile view receives finalised transcripts and AI streams in sync.

The desktop top bar shows a **Mobile** pill with the LAN URL and connected-client count. Click it to copy the URL — handy for typing into the phone browser.

### If the URL doesn't work on a phone

If the phone shows `connection refused` or just times out while loading the URL, **Windows Firewall is almost always the cause**. Allow inbound TCP 7823 once, from an elevated PowerShell prompt:

```powershell
New-NetFirewallRule -DisplayName "Open-Cluely Mobile" -Direction Inbound -LocalPort 7823 -Protocol TCP -Action Allow -Profile Any
```

`-Profile Any` is important: rules created without it default to Domain/Private profiles only. A phone hotspot or unknown public Wi-Fi is usually classified as **Public**, which the default rule does not cover. This is the most common reason "other tools on ports 5000/5500 work but ours doesn't" — VS Code's Live Server and similar dev tools often add a `Profile=Any` rule the first time they prompt.

To remove the rule later:

```powershell
Remove-NetFirewallRule -DisplayName "Open-Cluely Mobile"
```

Other things to check:

- The **Mobile** pill in the desktop top bar must be lit (green or amber). Grey means the server is not running.
- Use a **non-virtual** LAN URL. Docker, WSL, VMware, Hyper-V, Tailscale, and similar tools add IPv4 interfaces that the phone cannot route to. The startup log and the pill tooltip flag these with `[virtual — phone probably cannot reach]`; pick a different URL.
- The phone must be on a network that can route to the PC. Public Wi-Fi (especially café/hotel) often blocks peer-to-peer traffic; switch to USB tethering or a phone hotspot.
- A VPN client on the PC sometimes hijacks LAN routing. Disconnect it, or add the LAN range to its split-tunnel exceptions.

Quick test (one-liner, from any shell on the PC) to confirm whether the firewall is the blocker:

```powershell
Test-NetConnection -ComputerName <your-LAN-IP> -Port 7823
```

If `TcpTestSucceeded : True` from the PC but the phone still cannot connect, the firewall rule is missing or wrong-profile. If `TcpTestSucceeded : False` even from the PC itself, the server isn't really listening (check the **Mobile** pill).

> The server binds to `0.0.0.0`. Anyone who can reach the host on port 7823 can drive the assistant — only run the app on networks you trust, or pair this with a firewall rule that allows only your phone's IP.

---

## Basic Workflow

1. Launch the app and confirm your DashScope key, models, ASR provider, and **Interviewer mode** (`fast` or `expert`) in Settings.
2. Start transcription and enable whichever sources you need: `Host` (the candidate's audio), `Mic`, or both. As the candidate answers, the **interviewer copilot** surfaces the next follow-up question to ask.
3. Take screenshots when visual context is needed — a problem statement, error, or UI.
4. For the secondary candidate-side tools, use the right **More ▾** button for the moment:
   - **Suggest** to get a quick, speakable opening response from the transcript
   - **Ask AI** when you need the full, complete answer from all context
   - **Screen AI** when the problem is on your screen and you want a direct solution
   - **Notes** to capture a structured record of what was discussed and decided
5. Toggle noisy messages to `Off` before the next AI call so the prompt stays focused on what matters.
6. Optionally use the **mobile companion** on your phone for discreet control — trigger screenshots, ask AI, or run the mic without touching the desktop.

## Prompt Training & Evaluation

The interviewer-copilot prompts are tuned against a **1000-fixture diversity corpus** under `fixtures/expert-interview/` — synthetic interview snapshots spanning 16 industries × 7 seniority levels × zh/en/mixed language × 14 answer-qualities (vague-empty, inflated-metrics, defensive-hostile, team-credit-only, …) × edge cases (cites-NDA, reverses-question, multi-task-in-one-answer, …). Each fixture carries ground-truth `top_question_traits` so a generated follow-up can be scored automatically. Tooling lives in `scripts/train-prompts/`:

| Script | Purpose |
|--------|---------|
| `next-slots.js` | allocate the next unfilled fixture slots into per-author assignment chunks |
| `authoring-spec.md` | the fixture-authoring contract (schema, hard invariants, diversity rules) |
| `validate-fixtures.js` | schema + tag-consistency check (corpus is `1000/1000 PASS`) |
| `local-dedup.js` | no-API MinHash near-duplicate check (`0` pairs at Jaccard ≥ 0.7) |
| `eval-block.js --block A\|C` | per-block metrics (e.g. Block A `raw_span_pass_rate`) |
| `eval-e2e.js --limit N` | full 7-block chain: yield, per-block fallback rate, latency |
| `blind-compare.js --n N` | Fast vs Expert, position-bias-swapped, LLM-judged |

Eval scripts resolve the DashScope key from `cache/app-state.json` (or the `DASHSCOPE_API_KEY` env var). On hosts where Node's `fetch` is slow/flaky against DashScope, set `DASHSCOPE_TRANSPORT=curl` to route LLM calls through `curl`. See [`PROMPT_TRAINING_LOG.md`](./PROMPT_TRAINING_LOG.md) for the iteration history, results, and known environment limits (notably: full-corpus E2E is latency-bound in some environments).

## Project Structure (Brief)

- `src/main-process/` is the Electron control plane (startup flow, window behavior, global shortcuts, and IPC registration).
- `src/main-process/features/mobile-server/` is the mobile companion — HTTP + WebSocket server (`server.js`) and the mobile UI (`mobile.html`).
- `src/services/` contains reusable domain logic (DashScope AI prompts/runtime + interviewer-copilot Fast/Expert prompt builders, the pluggable ASR router and its STT providers, persisted app-state).
- `src/main-process/features/interviewer/` holds the interviewer-copilot runtime and the Expert-mode 7-block orchestrator.
- `src/windows/assistant/preload/` is the renderer-safe API boundary (`window.electronAPI` invoke + event wrappers).
- `src/windows/assistant/renderer/features/` contains modular UI logic (chat, listeners, settings, transcription, context bundling, layout).
- `src/windows/legacy/` contains old experiments and is not part of the active runtime path.

Detailed, file-by-file ownership is documented in [`notes.md`](./notes.md).

```text
src/
  bootstrap/             Environment loading, validation, and persistence
  main-process/          Startup orchestration, IPC wiring, window control, assistant runtime
    features/
      interviewer/       Interviewer-copilot runtime + Expert-mode 7-block orchestrator
      mobile-server/     Mobile companion HTTP+WS server and mobile UI HTML
  services/
    ai/                  DashScope service + interviewer Fast/Expert prompt builders (expert/ blocks, schemas)
    asr-router.js        Pluggable STT router: paraformer/, xfyun-rtasr/, assembly-ai, vosk
    state/               App-state load/save helpers
  windows/
    assistant/
      preload/           `window.electronAPI` invoke/listener bridge
      renderer/features/ Renderer feature modules (chat, listeners, settings, transcription, AI context, layout)
      window.js          BrowserWindow creation/config
      renderer.js        Renderer composition root
    legacy/              Older experimental files kept out of the active flow
assets/                  Build icons and packaging assets
cache/                   Generated app state in development
.stealth_screenshots/    Session screenshots in development
dist/                    Packaged build output
repomix-output.txt       Single-file repository snapshot for AI/code review tooling
```

## Shortcuts

All keyboard shortcuts are customizable. Configure them in `src/config.js` to match your preference before building or running the app.

## Scripts

- `npm start` runs the app from source.
- `npm run start:hidden` launches it in background mode from source.
- `npm run dev` enables Electron logging.
- `npm run build:win` creates the portable Windows executable.
- `npm run build` runs the default `electron-builder` flow.

## Build

The recommended Windows build is the portable executable:

```powershell
npm run build:win
```

Expected output:

```text
dist/GoogleChrome.exe
```

Notes:

- This is the recommended way to use the app outside development because it gives you a standalone `.exe` to launch directly.
- `.env` is bundled as an extra resource during packaging.
- The current Windows build is configured as a portable `x64` target with:
  - Product name: `Google Chrome (2)`
  - Executable name: `GoogleChrome.exe`
  - App ID: `com.google.chrome`
  - Publisher name: `Google LLC`
- If the build fails with a symlink privilege error, enable Windows Developer Mode or run the build from an elevated terminal.
- The repo already includes [`assets/chrome.ico`](./assets/chrome.ico) for the Windows target. Add `assets/chrome.icns` and `assets/chrome.png` before relying on the macOS or Linux targets defined in `package.json`.

### Running The Built App

After building:

1. Open the `dist/` folder.
2. Run `GoogleChrome.exe`.
3. If you want background launch behavior, either set `START_HIDDEN=true` before building or launch with:

```powershell
.\dist\GoogleChrome.exe --start-hidden
```

### Build Checks

After packaging, verify:

- `dist/GoogleChrome.exe` exists
- the executable shows the Chrome icon
- the app launches correctly without needing `npm start`

For a build-focused walkthrough, see [`BUILD_INSTRUCTIONS.md`](./BUILD_INSTRUCTIONS.md).

## Good Practices

- Keep `src/config.js` as the single source of truth for model lists, programming languages, and keyboard shortcuts.
- When adding or changing environment variables, update all three places together: [`src/bootstrap/environment.js`](./src/bootstrap/environment.js), [`.env.example`](./.env.example), and this README.
- Preserve Electron boundaries: renderer code should go through `preload` and IPC, not import main-process modules directly.
- Keep cursor behavior stealth-safe: interactive controls intentionally do not switch to per-button pointer cursors. This prevents screen-sharing viewers from inferring user actions from cursor-shape changes while hidden mode is active.
- Add new UI logic under `src/windows/assistant/renderer/features/` and new domain logic under `src/services/` or `src/main-process/features/`.
- The mobile server (`src/main-process/features/mobile-server/`) binds to `0.0.0.0`. Anyone who can reach the host on port 7823 can drive the assistant — only run the app on networks you trust, or pair this with a firewall rule that allows only your phone's IP.
- Treat [`src/windows/legacy/`](./src/windows/legacy/) as reference material unless you are intentionally reviving an old experiment.
- Re-test both `npm start` and the relevant packaging path when changing startup flow, window behavior, screenshots, IPC, or global shortcuts.
- Keep real keys out of Git. Use `.env`, and rely on `.env.example` for the documented contract.

## Repomix Snapshot

To regenerate the packed repository snapshot:

```powershell
npx repomix . --style plain -o repomix-output.txt
```

If you want to exclude generated artifacts while experimenting:

```powershell
npx repomix . --style plain -o repomix-output.txt -i "repomix-output.txt,cache/**"
```
## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=shubhamshnd/Open-Cluely&type=Date)](https://star-history.com/#shubhamshnd/Open-Cluely&Date)
