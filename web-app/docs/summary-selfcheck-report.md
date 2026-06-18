# 总结面试 (Interview Summary) — Bug Self-Check Report

**Branch:** `bugfix/summary-selfcheck` (off `e5403f8`, the summary-bearing commit)
**Method:** Offline, deterministic tests via dependency injection — the cloud speech/LLM
models are never called. A fake `chat()`, fake WebSocket, fake timers, and injected
transcripts drive every path. A new summary **telemetry event-log** makes the otherwise
opaque 30–60s flow observable and assertable.

**Result:** 8/8 bugs fixed, each with a failing-first test. Full suite green:
- Server: **130/130** (was 98, **+32** new)
- Web: **138/138** (new `SummaryModal.test.tsx` +10; expanded `useCopilotSocket.test.ts` to 15)

Run from `web-app/`: `npm test` (server: `tsx --test`; web: `vitest`).

---

## Bugs fixed

### #1 — 60s timeout aborts the deep v4-pro summary
- **Root cause:** `server/src/dashscope.ts` aborted every call at `REQUEST_TIMEOUT_MS=60000`. The summary uses DeepSeek **v4-pro, thinking ON, 4096 tokens**, which routinely runs past 60s → spurious `summary-error` ("aborted").
- **Fix:** added a per-call `timeoutMs?` override to `ChatOptions`; `analyzeSummary` passes `SUMMARY_REQUEST_TIMEOUT_MS = 180000`. Default callers keep 60s.
- **Tests:** `server/test/dashscope.test.ts` — override honored; default unchanged.

### #2 — Non-retryable 4xx was retried anyway
- **Root cause:** in `chat()`, the non-retryable `throw` for 4xx lived inside the `try`, so the same `catch` re-ran the retry/backoff loop — 400/404 burned `MAX_RETRIES` attempts (and, with the summary fallback, up to 6 slow calls) before failing.
- **Fix:** brand non-retryable errors with a `NON_RETRYABLE` symbol; the catch re-throws them immediately. 5xx/429 still retry.
- **Tests:** `server/test/dashscope.test.ts` — 400 → fetch called once + rejects; 500/429 → retried.

### #3 — `isModelRejected` matched too broadly (masked real errors)
- **Root cause:** `interview-analysis.ts` matched `/model/ && (…|400|404)`, so any 400 merely mentioning "model" (e.g. "max_tokens too large for model X") silently fell back to the cheaper model, hiding the real param error.
- **Fix:** tightened — require `\bmodel\b`, **exclude** `max_tokens`/param/temperature errors, and require genuine not-found / unknown / unavailable / unsupported wording (no bare status codes). Exported for testing.
- **Tests:** `server/test/interview-analysis.test.ts` — model-not-found → true; max_tokens-for-model → false; generic 400 → false.

### #4 — "面试完整记录" was actually a truncated tail
- **Root cause:** `buildSummaryInput` emitted `transcript.slice(-14000)` under a heading saying 完整 ("complete"); for long interviews the head was silently dropped.
- **Fix:** when the transcript overflows the window, the heading becomes `# 面试记录（节选：最近部分）`; short transcripts keep `# 面试完整记录`.
- **Tests:** `server/test/interview-analysis.test.ts` — long transcript labeled as 节选; short stays 完整.

### #5 — Dead/misleading "streaming" path
- **Root cause:** the client had a `summary-chunk` handler and a `'streaming'` state claiming "text accumulates streamed chunks", but `handleSummarize` is **one-shot** and never sends chunks — the modal just spun for the whole wait.
- **Fix:** renamed `'streaming'` → `'loading'`; removed the dead `summary-chunk` handler with an honest comment; the contract keeps `summary-chunk` as a documented **reserved** forward capability the client does not handle.
- **Tests:** `web/src/lib/useCopilotSocket.test.ts` — state machine asserts the one-shot path.

### #6 — Infinite spinner on disconnect
- **Root cause:** if the socket dropped mid-summary, the stateless server never replied over the dead socket, so `summary.status` stayed `'loading'` forever.
- **Fix:** `socket.onclose` now fails an in-flight summary (`activeSummaryRef` set) with a bilingual "connection lost — please retry" error and clears the ref so a re-run starts clean.
- **Tests:** `web/src/lib/useCopilotSocket.test.ts` — onclose while loading → status `'error'`, not stuck.

### #7 — Markdown renderer dropped inline code & numbered lists
- **Root cause:** `SummaryReport` handled headings/bold/bullets/quotes but not inline `` `code` `` (the prompt's own examples use backticks) or numbered lists (`1.`) — they rendered literally/flat.
- **Fix:** added inline `` `code` `` → `<code>` and `1.`/`2)` → `<ol>`, with independent bullet/ordered accumulators so runs don't merge. Still XSS-safe — React text nodes only, never `dangerouslySetInnerHTML`.
- **Tests:** `web/src/desktop/SummaryModal.test.tsx` — code/ordered-list render; bold/heading/bullet unchanged.

### #8 — Empty-transcript notice rendered as a real report
- **Root cause:** the "nothing to summarize" message was sent as an ordinary `summary-done` and rendered like an evaluation report.
- **Fix:** `handleSummarize` flags it `empty:true`; contract carries `empty?`; `messages.ts` parses it; the modal renders a distinct `summary-modal__notice`, not a report body.
- **Tests:** `server/test/ws-summarize.test.ts` (empty → `empty:true`) + `web/src/desktop/SummaryModal.test.tsx` (notice state).

---

## Telemetry (built to spec — "保证无bug")

`server/src/summary-telemetry.ts` — a self-contained, dependency-free recorder timestamping
the lifecycle `requested → input-built → model-call-start → model-call-end | timeout | fallback → done | error`.
Bounded ring buffer (default 200, clamped ≥1), injectable clock, `record()` never throws
(instrumentation can't break the feature), `snapshot()` returns defensive copies. Wired into
`analyzeSummary` (injected) and `handleSummarize`; a process-wide recorder is exposed via
`getSummaryTelemetry()` for an ops/health surface.
- **Tests:** `server/test/summary-telemetry.test.ts` — ordering, capacity/ring eviction, clock,
  snapshot isolation, never-throws.

---

## Files changed
- **Backend:** `server/src/dashscope.ts`, `server/src/interview-analysis.ts`, `server/src/ws.ts`, `server/src/summary-telemetry.ts` (new)
- **Frontend:** `web/src/lib/useCopilotSocket.ts`, `web/src/desktop/SummaryModal.tsx`, `web/src/lib/messages.ts`
- **Contract:** `packages/contract/index.d.ts` (`summary-done.empty?`; `summary-chunk` documented reserved)
- **Tests:** `server/test/dashscope.test.ts` (new), `server/test/summary-telemetry.test.ts` (new), `server/test/ws-summarize.test.ts` (new), `server/test/interview-analysis.test.ts` (expanded), `web/src/desktop/SummaryModal.test.tsx` (new), `web/src/lib/useCopilotSocket.test.ts` (expanded)

## Nothing judged "not a bug"
All 8 candidate issues were confirmed real and fixed. (XSS in the renderer was checked and was
already safe — React text nodes — so #7 was scoped to fidelity, not security.)
