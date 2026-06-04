# Mic-less simulation test harness

Exercise the interview copilot **without a microphone**. DeepSeek generates
two-speaker Chinese structured-interview transcripts; a server-side `sim` ASR
provider replays them (with speaker ids) instead of listening to audio; a driver
opens several concurrent "chats" with distinct feature mixes and logs everything.

Use it to debug **cross-chat isolation**, **auto-followup**, the **30s-interval**
firing mode, and **multi-speaker** diarization.

## Prerequisites

- The server + Vite dev servers running on `:8787` / `:5173`
  (`npm run dev` from `web-app/`). The driver talks to `ws://localhost:8787/ws`.
- `web-app/.env` with `DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL`
  (`https://dashscope.aliyuncs.com/apps/anthropic`) for the generator.

## 1. Generate fixtures

```bash
node scripts/sim/gen-interview.mjs            # 3 transcripts (default)
node scripts/sim/gen-interview.mjs --count 5  # N transcripts
```

Writes `scripts/sim/fixtures/interview-<i>.json`, each an array of
`{ "speakerId": 0|1, "text": "…" }` turns (interviewer = 0, candidate = 1).
Robust: retries the API once, and falls back to a small hardcoded transcript if
DeepSeek is unreachable, so the harness always has a usable script.

## 2. Run the chats

```bash
node scripts/sim/run-chats.mjs --chats 3 --duration-sec 120
```

### Flags

| flag | default | meaning |
|------|---------|---------|
| `--chats N` | 3 | how many concurrent chats to open (mixes cycle if N > 3) |
| `--duration-sec S` | 120 | how long to keep the sockets open before finishing |
| `--interval-ms MS` | per-mix | override the cadence of **interval-mode** chats (chats 1 & 2). Agent mode (chat 0) is unaffected. Use a gentler value on long runs to limit DeepSeek API spend. |

Each chat gets a **distinct mix** (cycled if `--chats` > 3):

| chat | mode    | auto mode        | diarize |
|------|---------|------------------|---------|
| 0    | expert  | agent            | on      |
| 1    | expert  | interval @ 30s   | on      |
| 2    | expert2 | interval @ 15s   | on      |

(With `--interval-ms`, chats 1 & 2 both use that cadence instead of 30s/15s, and
their summary labels reflect the effective value.)

### Long, gentle, continuous run (e.g. 2 hours)

To demonstrate the auto-followup pipeline running continuously without errors,
use a small chat count and a gentle interval so you don't hammer the DeepSeek API:

```bash
node scripts/sim/run-chats.mjs --chats 2 --duration-sec 7200 --interval-ms 60000
```

The driver is built to survive this:

- **Auto-reconnect** — if a socket drops, it re-opens with backoff (1s → 2s → 5s,
  capped at 10s) and re-sends the full `configure` + speaker-role + `audio-control
  start` handshake. A reconnect is **not** a failure; it's counted (`recon` column)
  and logged as `RECONNECT #n (reason)`. The chat only really ends when the
  `--duration-sec` timer fires.
- **Transient vs hard errors** — retryable server errors (rate-limit / timeout /
  5xx / overload) and `skipped:` messages are logged as `TRANSIENT …`, counted,
  and do **not** fail the verdict. Only hard errors (validation / unexpected /
  malformed) and the structural checks below count.
- **Heartbeat** — every 60s a `HEARTBEAT t=… results=…(auto=…) transient=…
  reconnects=… spk={…}` line is appended to `logs/run.log` so you can
  `tail -f scripts/sim/logs/run.log` to watch health during a long run.

For each chat the driver sends `configure` (with `asrProvider:'sim'` + the
fixture as `simScript`), marks speaker roles (1 = candidate, 0 = interviewer),
then `audio-control start` on the `mic` lane (which arms the auto-trigger gate).
It keeps the socket open for `--duration-sec`, logging every server message to
`scripts/sim/logs/chat-<n>.log` and a combined `scripts/sim/logs/run.log`.

### Output

A per-chat **SUMMARY** table (#transcripts, #partial/#final, distinct
speakerIds, #progress, #result split auto/manual, #**hard** errors, #**transient**
errors, #skipped, #**reconnects**, time-to-first auto fire) and an **OVERALL**
verdict where `PASS` means **0 HARD issues**. The verdict also prints a
`transient (self-healed): N rate-limit/timeout, M skipped, R reconnects` line so
retryable hiccups are visible but don't fail the run.

**HARD** issues (these fail the verdict):

- any **hard** `error` message (validation / unexpected / malformed — anything
  that isn't a retryable transient or a `skipped:`);
- **multi-speaker collapse** (a diarized chat that only ever saw one speakerId);
- **cross-chat leakage** (a result whose content matches another chat's script,
  or a `requestId` observed on more than one chat's socket);
- **no transcript** (the `sim` provider never replayed — a wiring problem);
- **auto never firing**, but only when the run was long enough to expect a fire
  (interval mode: cadence + 60s; agent mode: ~120s). On shorter runs this is
  downgraded to an informational **NOTE**, not a failure.

**Transient / self-healing** (logged + counted, but NOT failures):

- retryable server errors (`429`, rate-limit, timeout, `ECONN*`, `502/503/500`,
  overload, "too many") → `TRANSIENT …`;
- `skipped:` results (the analyze pipeline declining is normal);
- WebSocket drops → an automatic `RECONNECT #n` with backoff.

## How it fits together

- `server/src/sim-client.ts` — `createSimSession(deps)`: a fake ASR session
  (same `sendAudio`/`stop`/`isReady` shape as the volc/xfyun clients) that
  ignores audio and replays the script on a ~2.5s/turn timer, looping forever.
- `server/src/asr-relay.ts` — `provider === 'sim'` uses the plain text path and
  forwards the script's per-turn `speakerId` (like xfyun; no CAM++).
  `relay.setSimScript(...)` stores the latest script for the next start.
- `server/src/ws.ts` — the zod `configure` schema accepts `asrProvider:'sim'` +
  `simScript`; the script is pushed onto the relay.
- `packages/contract` — `AsrProvider` includes `'sim'`; `SessionConfig` has
  `simScript?: Array<{ speakerId: number; text: string }>`.

## Environment overrides

- `SIM_WS_URL` — override the server URL (default `ws://localhost:8787/ws`).
