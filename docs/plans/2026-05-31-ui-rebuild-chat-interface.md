# Plan — Full UI rebuild → chat-software interface (open-cluely)

> Generated with the `ui-ux-pro-max` + `frontend-design` skills. Backend core (ASR pipeline, DashScope AI, Fast/Expert interviewer orchestrators, mobile server, process-loopback, settings IPC) is **preserved**; this is a renderer rebuild + four feature additions + two backend extensions.

## 0. 中文摘要 (What you get)

- 全新「聊天软件」界面:左侧栏 = 每场面试的 chat history,中间 = 实时双声道转写 + AI 追问卡片,右侧 = 简历/JD/自动整理的上下文。
- 拖拽上传简历(.txt/.md/.pdf/.docx → 自动抽取文本 → 存入 `resumeText`)。
- 麦克风 + 电脑音频**同时**输入,**分两个独立的"框"**(电脑音频框=候选人声音=青色;麦克风框=你=琥珀色),各自有设备选择 + 实时电平 + 开关。
- Expert 工作流新增 **Block H「会话整理」**:每轮输出完问题后,自动总结本轮 + 更新会话状态(已挖掘话题/能力覆盖/候选人画像),喂给下一轮 Block C。
- 每场面试持久化为一个 session;左栏可切换历史面试,载入其完整转写 + 问题。
- 设置页**自动保存**(去掉手动保存按钮),改动即存,显示「已保存 ✓」。

## 1. Design direction (from the skills)

**Concept — "Broadcast Control Room."** A calm, high-signal dark studio where the two audio sources are two color-coded *channels* on a near-black console: monospace timestamps + live level meters give it a real-time broadcast character; an editorial grotesque display face keeps it polished. This is contextual (an interview = two-channel live audio), not a generic "AI chat" clone, and it inherits the product's discreet/stealth heritage.

**The one memorable thing:** the dual-channel live transcript rendered like a mixing console — teal lane (candidate / computer audio) and amber lane (you / mic), each with a live VU meter — with AI follow-up cards surfacing inline the moment the candidate (teal) finishes a thought.

### Style
Synthesis of ui-ux-pro-max **"Modern Dark (Cinema)"** (surfaces, radius, hairline borders, low-glow, `cubic-bezier(0.16,1,0.3,1)`) + **"Swiss Modernism 2.0"** (strict grid, 8px math spacing, single-purpose accents). No pure `#000` (OLED smear), no cyberpunk glitch/scanlines (too much for a pro tool), no excessive decoration (the generator's lone anti-pattern).

### Color tokens (dark; WCAG-checked pairs)
```css
--bg-deep:#0A0C10; --bg-base:#0E1117; --bg-elev:#161B22;
--surface:rgba(255,255,255,.04); --border:rgba(255,255,255,.08);
--fg:#E6EDF3; --fg-muted:#8B949E;
/* semantic channel + role colors (never color-alone: always icon+label too) */
--candidate:#2DD4BF;   /* teal  — computer audio / candidate's voice */
--interviewer:#F5A524; /* amber — microphone / you */
--ai:#7C8CF8;          /* indigo — AI coach + primary CTA, used sparingly */
--success:#3FB950; --danger:#F85149; --ring:#7C8CF8;
--radius:12px; --ease:cubic-bezier(.16,1,.3,1);
```
A light theme is derived later (design light+dark together per `dark-mode-pairing`); dark ships first.

### Typography (distinctive, NOT Inter/Roboto — per frontend-design)
- **Display / headings:** `Bricolage Grotesque` (700/800) — characterful modern grotesque.
- **UI / body / transcript text:** `Hanken Grotesk` (400/500/600) — clean, warm-precise, readable.
- **Mono (timestamps, channel labels, levels, tabular):** `JetBrains Mono` (400/500).
- **CJK fallback (transcripts are bilingual — Paraformer is Chinese):** `Noto Sans SC`. Stack: `'Hanken Grotesk','Noto Sans SC',sans-serif`. `font-display:swap`; self-host (Electron offline) rather than Google CDN.

### Motion & UX guardrails (from the skill's rule set)
150–250ms micro-interactions, `transform`/`opacity` only, staggered transcript-line entrance (30–50ms), `scale(.97)` press without layout shift, `prefers-reduced-motion` honored. Focus rings 2px `--ring`; contrast ≥4.5:1; every clickable has `cursor:pointer`; icon-only buttons get `aria-label`; SVG icons only (Lucide) — no emoji as structural icons; min 44px hit targets; `aria-live="polite"` for new transcript lines + the "Saved ✓" toast.

## 2. Layout / information architecture

Desktop three-pane shell (CSS Grid; right rail collapsible <1100px):
```
┌── SIDEBAR ─────┬── MAIN (live interview) ─────────────────────┬── RIGHT RAIL ──┐
│ + New interview│ topbar: title · Fast/Expert · ● REC · stealth│ Resume (drop)  │
│                │──────────────────────────────────────────────│ ───────────    │
│ ▸ Today        │ ▌teal  Candidate (computer)        ░░level    │ Job description│
│   • Acme · PM  │   12:03  "我负责了支付重构…"                   │ ───────────    │
│   • Stripe·BE  │ ▌amber You (microphone)            ░level     │ Session context│
│ ▸ Yesterday    │   12:04  "能展开说说 QPS 吗?"                 │ (auto-organized│
│   • …          │ ┌ 🎯 AI follow-up (indigo) ─────────────────┐│  after each Q) │
│                │ │ "你提到重构,具体迁移了哪些服务?"           ││  • drilled: …  │
│                │ └────────────────────────────────────────────┘│  • gaps: …     │
│ ⚙ Settings     │ composer: [▮▮ Computer ⏻] [▮▮ Mic ⏻]  type… ▷ │                │
└────────────────┴──────────────────────────────────────────────┴────────────────┘
```
The two **"框"** are the channel-control chips in the composer (`[▮▮ Computer ⏻]`, `[▮▮ Mic ⏻]`): each = live level meter + device `<select>` + on/off toggle, color-coded. Transcript lines stream into the main area color-coded by source. Toggling either channel is independent (both can run simultaneously).

## 3. Preserved vs rebuilt

| Preserved (reuse as-is) | Rebuilt / replaced | New |
|---|---|---|
| `asr-router`, `paraformer`/`xfyun` services, `process-loopback`, `audio-pipeline.js` + worklet, `source-state.js`, `transcript-buffer.js`, `dashscope-anthropic-service`, `interviewer-runtime` (Fast + Expert dispatch), `expert-orchestrator` blocks A–G, `mobile-server`, `app-state` core, settings IPC | `renderer.html`, `styles.css`, `renderer.js` (orchestration), `chat-ui-manager`, `settings-panel-manager` (auto-save only), window chrome (`window.js`/`window-controller`) | sidebar/history manager, session store + IPC, resume drop-zone + IPC, channel-control component, Expert **Block H**, right-rail context panel |

## 4. Workstreams

### P0 — Prerequisite bug fix (blocks dual-audio)
**Mic/renderer audio is currently dropped.** `src/services/asr-ipc.js:32` reads `payload.audio`; the renderer sends `{source,data}` (`preload/actions.js:87`). One-line fix `payload.audio → payload.data` (+ use it for the length cap). Without this, "麦克风…同时输入" cannot work for the renderer-captured mic. See [[known-issues]].

### A — App shell + chat UI rebuild (renderer)
- New `renderer.html` (3-pane grid) + `styles.css` (token system above). Self-host the 4 fonts under `src/windows/assistant/fonts/`.
- Keep the manager architecture (vanilla, no framework — per "keep core methods"). `chat-ui-manager` gains a **dual-lane renderer**: `renderLine({source, text, ts})` → teal/amber lane; keeps `formatResponse` escape-then-markdown (XSS — matters for LAN/mobile-sourced text). AI coach + question cards become an indigo `question-card` component with copy/anchor.
- Reuse `message-store` / `context-bundle` / `toggle-ui` unchanged (inclusion toggles still feed Ask AI).
- Window: replace the 900×400 frameless overlay with a resizable **1100×720** (min 960×640) custom-frameless chrome (drag region + traffic-light area). **Stealth retained as a toggle** (see Decisions): `setContentProtection`, opacity, emergency-hide, always-on-top stay wired in `window-controller.js`.

### B — Dual-channel audio (separate boxes)
- Backend already supports independent `mic`+`system` (`transcription-manager.startMicRecording` / `startSystemAudioRecording`, per-source state). After P0, both stream in parallel.
- New `channel-control.js` renderer component (×2): device `<select>` (from `getDesktopSources` / `enumerateDevices`), on/off → `startVoiceRecognition('mic'|'system')`, live level meter fed from the worklet RMS (small addition to `audio-pipeline.js` to post a level alongside frames).
- System source keeps the existing picker logic ([[system-audio-source-picker]]): default loopback / process / screen / macOS output.

### C — Drag-and-drop resume upload
- Renderer drop-zone in the right rail → on drop, send file path/bytes via new IPC **`resume-upload`**.
- Main handler extracts text by type: `.txt/.md` (read), `.pdf` (`pdf-parse`), `.docx` (`mammoth`) → writes `appState.resumeText` (existing field consumed by interviewer prompts) → returns a preview + char count. Graceful fallback: unknown type → ask user to paste.
- New deps: `pdf-parse`, `mammoth` (add to `package.json`, `asarUnpack` if needed). Resume is also stored on the active session (workstream D).

### D — Chat history & session persistence
- New `src/services/state/session-store.js`: one JSON per interview under `userData/cache/sessions/<id>.json` + a lightweight `sessions/index.json` (id, title, startedAt, mode, lastMessageAt). Session schema: `{ id, title, startedAt, mode, resumeText, jobDescription, interviewerSessionState, messages:[{role:'candidate'|'interviewer'|'coach'|'ai', source?, text, ts, emotion?}] }`.
- New IPC (registered like the others in `start-application.js`): `session-list`, `session-load`, `session-create`, `session-rename`, `session-delete`, `session-append`. Renderer `history-sidebar.js` renders grouped-by-day list (ChatGPT-style), active highlight (`nav-state-active`), new/rename/delete, empty state.
- "New interview" creates a session; transcripts/questions append live; switching loads a past session read-only (with a "resume this interview" affordance).

### E — Expert-mode auto context consolidation (new Block H)
- After `runExpertChain` renders the final question (`expert-orchestrator.js:390`, after Block G), run **`consolidateSessionState()`** (Flash, **non-blocking** — fires after the question is shown so latency is unaffected). It summarizes the just-finished Q/A round and updates `interviewerSessionState`: `{ drilled_topics[], competencies_covered[], open_gaps[], candidate_profile_summary, asked_questions[] }`.
- Persist to the active session (D) and feed it into the **next** answer's **Block C** (`block-c-state-update.js`), which already reads `interviewerSessionState` but today gets a default. This closes the loop the Expert design intended.
- Add `interviewerSessionState` to `app-state.js` defaults/sanitizer (currently undefined) and to the session schema. Surface it in the right rail "Session context (auto)" panel, collapsible. See [[expert-mode-7-block-orchestrator]].

### F — Auto-save settings
- `settings-panel-manager.js` already auto-saves (`bindAutoSave`, 600ms debounce). Finalize: **remove the Save button**, auto-save every field on `change`/debounced `input`, show a subtle `aria-live` "Saved ✓" pip. Keep the `save-settings` IPC + its side-effects (provider switch → `stopAllStreams`, model/key → gemini reconfigure). Redesign the settings surface as a panel/modal matching the new tokens; group: API keys (masked, show/hide), ASR provider, AI model, interviewer mode (Fast/Expert), language, audio devices, theme, stealth, window opacity. See [[settings-and-persistence]].

## 5. Data model changes
- `app-state.js`: add `interviewerSessionState` (object|null) + `activeSessionId` (string|null) to defaults + sanitizer.
- New `userData/cache/sessions/` store (D). `resumeText`/`jobDescription` continue to live in app-state for the *active* session and are snapshotted onto the session record.
- `config.js`: no model changes; optionally add a `BLOCK_H` model const (Flash) for consolidation.

## 6. Phases (suggested sequence)
1. **P0** audio-chunk fix + verify mic+system simultaneously reach ASR.
2. **A** shell + tokens + fonts + dual-lane chat render (static data first).
3. **B** wire the two channel-controls to live ASR + level meters.
4. **D** session store + sidebar (persist/load).
5. **C** resume drag-drop + extraction.
6. **E** Expert Block H consolidation + right-rail panel.
7. **F** settings auto-save redesign.
8. Polish: motion, reduced-motion, light theme, a11y pass (skill §1–§3), stealth toggle QA.

## 7. Decisions (confirmed 2026-05-31)
1. **Stealth mode:** ✅ Keep as a toggle on the new windowed chat app — `setContentProtection` / opacity / emergency-hide / always-on-top stay wired.
2. **Resume parsing:** ✅ Full `.txt/.md/.pdf/.docx` via `pdf-parse` + `mammoth` (add to `package.json` + `asarUnpack`).
3. **Session storage:** ✅ JSON-per-file under `userData/cache/sessions/<id>.json` + `index.json`.
4. **Window chrome:** ✅ Custom frameless (drag region + custom window controls), **1100×720** default / **960×640** min.

## 8. Risks
- CJK rendering in transcripts → must bundle `Noto Sans SC` (large; subset if possible).
- `pdf-parse`/`mammoth` packaging in Electron asar (`asarUnpack`).
- Expert Block H must stay non-blocking or it adds latency to the next turn; run it on the *previous* turn's idle.
- Session store concurrency if mobile + desktop write the same session (low risk; single-writer per session).
