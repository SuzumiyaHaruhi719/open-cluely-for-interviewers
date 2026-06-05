# Ephemeral Interviews + AI Analysis — Design Spec

Date: 2026-06-05 · Status: approved, implementing
Repo: `open-cluely-for-interviewers/web-app` (server = Node+tsx, web = Vite+React)

## Goal
Three changes to the interview-copilot:
- **A. Delete chat history.** No sessions, no persistence — every app open is a fresh, in-memory-only interview.
- **B. Interview summary** via DeepSeek **v4 pro** — a topbar button opens a modal with a streamed full evaluation report.
- **C. Fix session-context** — the live right-rail panel is dead (never ported to React); build it so it updates as the interview progresses.

## Part A — Ephemeral (delete history)
**Delete:** `web/src/desktop/useSessions.ts`; the session functions in `web/src/lib/api.ts` (`fetchSessions/createSession/fetchSession/updateSession/deleteSession/appendSessionMessage`); the RECENT history list in the sidebar (`Sidebar.tsx`); the server `/api/sessions` routes + session store; persistence calls in `Shell.tsx` (`appendMessage`/`load`/`patch`/`create`); the now-moot cross-chat plumbing (`discardedRequestsRef`, `resetGeneration` epoch suppression on server + client, chatId attribution).
**Flow:** open → `InterviewTypeModal` (online/offline + optional sample) → blank live interview in React state only. **"New interview"** button = reset all in-memory state + re-open the picker. Sidebar = **Live copilot · Question bank · Settings** (no history). Nothing persists across reload. The online/offline choice remains (drives ASR routing).
**Keep working:** live transcript + inline follow-ups (incl. the offline Generate-Q buffer fix + the auto-trigger "since-last-fire" window), GLP theme, ASR providers, Question bank.

## Part C — Session-context (live panel)
**Server:** a light analyzer (model `deepseek-v4-flash`) triggered on candidate finals, debounced + in-flight-gated (reuse the `auto-trigger` pattern). Builds input from the recent transcript and asks DeepSeek for STRICT JSON:
```
{ competencies: [{ name, status: 'covered'|'partial'|'gap', evidence? }],
  topics: string[], gaps: string[] }
```
Emit over the existing `session-context` WS message (`ws.ts` already forwards `session-context-updated` → `{type:'session-context', state}`).
**Client:** add a `session-context` handler in `useCopilotSocket` (store latest state); pass to `RightRail`; build a real **`SessionContextPanel`** React component (replaces the dead vanilla-js path + the hardcoded `hasSessionContext={false}`): competency chips colored by status (GLP success/warning/info), drilled-topics list, open-gaps list. Empty-state until first update. Cleared by "New interview".

## Part B — Interview summary (modal, DeepSeek v4 pro)
**Trigger:** topbar **"总结面试 / Summarize"** button → `SummaryModal`.
**Server:** new C→S `summarize {requestId}`. Builds input = full transcript (both lanes / diarized) + all AI follow-ups + JD + résumé, calls **`deepseek-v4-pro`** with an evaluation prompt, **streams** the report back (`summary-chunk` / `summary-done`, or reuse progress/result).
**Report structure:** 候选人概况 · 各能力维度(评分 + 证据) · 亮点 · 风险/不足 · 追问覆盖度 · 录用建议(倾向 + 理由).
**Client:** `SummaryModal` renders the streamed report; copy-to-clipboard + optional download `.md`; re-runnable.

## Shared infra
New server module `interview-analysis.ts`: builds the analysis input (transcript + follow-ups + JD + résumé) and calls DeepSeek — **flash** for incremental session-context (strict JSON), **v4-pro** for the summary (streamed). Both prompts live here.

## Decisions
- Session-context updates on candidate finals (debounced light flash call), not per word.
- Model ids `deepseek-v4-flash` (context) / `deepseek-v4-pro` (summary) — verify exact DashScope names at implementation.
- Phases implemented sequentially (A → C → B) because they share `Shell.tsx` / `ws.ts` / contract / `useCopilotSocket.ts`.

## Testing
- Server: session-context analyzer emits valid JSON + debounces; `summarize` calls v4-pro + streams; analysis-input builder; no `/api/sessions` routes remain.
- Client: `session-context` handler stores + `SessionContextPanel` renders covered/partial/gap; `SummaryModal` streams + copy; "New interview" resets everything; no `useSessions`/`/api/sessions` references remain.
- Build: `tsc` + `vite build` clean.
