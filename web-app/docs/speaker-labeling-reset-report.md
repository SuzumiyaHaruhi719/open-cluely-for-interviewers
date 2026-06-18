# Speaker labeling (iFlytek) + auto-clear-on-interview-end + 2-speaker cap — fix report

Branch: `fix/speaker-labeling-and-reset`

User instruction (verbatim):
> 面试官和候选人标注不了 ... 首先每次面试结束自动清除候选人说话缓存 其次使用讯飞的时候也要能点候选人啊

Three issues fixed, each with red→green tests. Methodology: TDD (failing test first,
then the minimal surgical fix). Nothing in the suite regressed.

---

## BUG #1 — Can't label 面试官 / 候选人 when using iFlytek (讯飞)

### Root cause
- `web/src/desktop/TranscriptStream.tsx` (originally line ~225) gated the labelable
  speaker-segment view (the bubbles carrying the 面试官/候选人 toggle buttons) on
  **`offline ?`** only. `offline` is `config.interviewType === 'offline'`
  (`Shell.tsx:121`).
- iFlytek (`xfyun`) carries its OWN speaker id on finals: `server/src/xfyun-client.ts`
  `extractResult` emits `speakerId = parseInt(rl)` on finals, and
  `web/src/lib/useCopilotSocket.ts` (~line 329) appends a `speakerSegment` for ANY final
  with a numeric `speakerId` — including in ONLINE mode.
- So in online mode with iFlytek, `speakerSegments` were non-empty, but because the
  branch keyed on `offline` (false), the UI rendered the two fixed channel lanes
  (mic/display) instead of the labelable bubbles → no toggle buttons → the interviewer
  could not label anyone.
- The server side was already correct: `ws.ts:629` handles `set-speaker-role`
  (`roles.setRole`), and `ws.ts:525` calls `roles.setGuess(false)` for `xfyun`
  (`speaker-roles.ts` — each speaker labeled manually & independently, no auto-guess).
  The bug was purely that the UI never showed the toggles.

A secondary part of the same bug lived in the candidate-feeding effect in
`Shell.tsx` (~line 135): it fed the analyze buffer (`answer`) from candidate-labeled
segments only `if (offline)`; otherwise it fed from `transcripts.display.finalText`.
In online iFlytek (single room mic) the `display` lane is empty, so `answer` stayed
empty and **Generate Q was disabled for the whole interview** even after labeling a
candidate.

### Fix
- `web/src/desktop/TranscriptStream.tsx`: derive
  `const showSpeakers = offline || (speakerSegments?.length ?? 0) > 0;`
  and branch the render on `showSpeakers` instead of `offline`. The speaker-bubble
  view (with the 面试官/候选人 toggles) now renders whenever diarized segments exist OR
  the interview is offline. The raw room-mic fallback lane (`mic.finalText` /
  `mic.partial` shown as a candidate lane when segments are empty) was kept
  **offline-only** (guarded with `offline &&`), so online iFlytek doesn't mislabel the
  interviewer mic as a candidate fallback. Pure online with a non-diarizing provider
  (paraformer/volc) has no segments → still shows the two channel lanes (unchanged).
- `web/src/desktop/Shell.tsx`: the candidate-feeding effect now keys on segment
  presence, not `offline`: `if (speakerSegments.length) { use candidate-labeled
  segments }` (falling back to the room-mic transcript only when `offline`), `else if
  (offline)` use the room-mic transcript, `else` use `transcripts.display.finalText`
  (unchanged paraformer/volc online path). So once the interviewer taps 候选人 on an
  iFlytek-online bubble, that segment's text fills the analyze buffer and Generate Q
  is enabled.

### Tests (web / vitest)
`web/src/desktop/TranscriptStream.test.tsx`:
- iFlytek online (`offline=false`) WITH non-empty `speakerSegments` → renders the
  bubbles + the 面试官/候选人 toggles, and clicking 候选人 calls
  `onSetSpeakerRole(speakerId, 'candidate')` for the right speaker id. (the failing
  test that drove the fix)
- online (`offline=false`) WITHOUT segments (paraformer/volc) → renders the two
  channel lanes, NO toggles (negative case, unchanged behavior).
- offline WITH empty segments → falls back to the room-mic lane, no toggles
  (offline fallback preserved).
- the pre-existing offline-bubble test (toggles render + fire) still passes.

`web/src/desktop/Shell.test.tsx`:
- "online iFlytek: a candidate-labeled speaker segment feeds the analyze buffer" —
  emits an online final with a numeric `speakerId`, taps the bubble's 候选人 toggle
  (asserts a `set-speaker-role` frame goes to the server), then asserts Generate Q is
  enabled and the `analyze` frame's `candidateAnswer` contains that segment's text.

---

## BUG/FEATURE #2 — Auto-clear the candidate speech cache when each interview ends

### Root cause / gap
`resetTranscripts()` + `resetSpeakerSegments()` (in `web/src/lib/useCopilotSocket.ts`)
and the server-side reset (`pushConfig({ resetGeneration: true })`) were only invoked
from `Shell.onClearSession` (`Shell.tsx` ~line 409), which fires on the MANUAL "New
interview" / type-picker actions — never automatically when an interview ends. So a
finished interview's candidate segments / transcripts / in-flight summary stayed in
memory (frontend) and the server's accumulated candidate buffers
(`accumulatedDisplayFinal`, `accumulatedTranscript`, the trigger's since-fire window,
the context analyzer's transcript) were never cleared until the user manually started
a new interview.

### Definition of "interview ends" implemented  (please correct if this is wrong)
**An interview ends when the user stops the LAST active audio source — i.e. capture
transitions from "some source capturing" to "none capturing".**
- `capturing = audio.display.capturing || audio.mic.capturing` (`Shell.tsx:118`).
- The auto-clear fires on the `true → false` edge of `capturing`.
- A mere PARTIAL stop (one source stopped while another is still capturing) does
  **not** clear.
- Clearing is idempotent: it fires exactly once per end transition (a previous-state
  ref guards it) and never repeats while idle, and never on mount (capturing starts
  `false`).
- The manual "New interview" clear is unchanged.

### Fix
`web/src/desktop/Shell.tsx`: added a `wasCapturingRef` + an effect on `capturing`.
On the `true → false` transition it performs the same clear `onClearSession` does:
- frontend: `setAnswer('')`, `setTranscriptMessages([])`, reset `lastDisplayFinalRef`,
  `resetSpeakerSegments()`, `resetTranscripts()` (the latter also clears the in-flight
  summary + session context and abandons any in-flight generation);
- server: `pushConfig({ resetGeneration: true })` — which on the server
  (`ws.ts:556`) runs `trigger.reset()` + `resetAccumulated()`, dropping
  `accumulatedDisplayFinal`, `accumulatedTranscript`, the trigger's since-fire
  window, and cancelling the pending context analysis (`ws.ts:958`). This mirrors
  exactly what the manual clear pushes.

No new reset machinery was added — the existing helpers are reused.

### Tests (web / vitest, `web/src/desktop/Shell.test.tsx`)
New `describe('auto-clear candidate cache on interview end (last source stopped)')`:
- "stopping the LAST active source auto-clears the candidate cache" — uses the Sim ASR
  provider (synchronous capture, no real media) and stubs `getDisplayMedia` so two
  sources can run in jsdom. Seeds a diarized candidate segment, starts mic + display,
  stops the mic (display still live) and asserts **no** `resetGeneration` configure is
  pushed and the segment bubble is still on screen; then stops the display (last
  source) and asserts a `configure { resetGeneration: true }` **is** pushed and the
  segment bubble is cleared from the UI.
- "auto-clear fires only ONCE per interview end (idempotent)" — starts a single mic
  source, stops it, asserts exactly one `resetGeneration` reset is pushed.

The server-side reset is verified through the pushed `configure { resetGeneration:
true }` frame (the same contract `onClearSession` uses, whose server handling is
already covered by `server/test/ws-dispatch.test.ts`'s "configure resetGeneration
resets trigger and accumulated transcript").

---

## BUG #3 — iFlytek over-segments a 2-person interview into 4 speakers

### Symptom
A real interview has 2 people, but iFlytek (`xfyun`) surfaces 4 speakers in the UI.

### Root cause
- iFlytek 角色分离 (`role_type=2`, blind mode) emits per-WORD `rl` cluster ids.
  `server/src/xfyun-client.ts` `extractResult` (line ~155) takes the first non-"0"
  `rl` as the segment speaker (`parseInt(rl, 10)`) and forwards it on finals.
- Under fast turn-taking / cross-talk, blind diarization returns MORE than 2 distinct
  `rl` values for the same 2 voices.
- The xfyun path had **no "max speakers" cap**: `server/src/asr-relay.ts` (the
  `provider === 'xfyun' || 'sim'` branch, originally ~line 275) forwarded the raw
  `speakerId` straight through `emitTranscript` → `ws.ts` stamping → the browser, which
  keys `speakerSegments` off that raw id (`web/src/lib/useCopilotSocket.ts:329`,
  `web/src/lib/speakerSegments.ts` `appendSegment`). N distinct raw ids → up to N
  distinct bubbles → "4 speakers". (The CAM++ offline path caps speakers in the Python
  sidecar; the iFlytek path had no equivalent.)

### Provider-side limit — checked, NOT available
Checked the iFlytek 实时语音转写大模型 / AST endpoint we use
(`/ast/communicate/v1`, see `buildSignedUrl`). For our mode — blind separation
`role_type=2` — the API exposes only `role_type` (0 off / 2 blind) and voiceprint-
based options (`feature_ids`, `eng_spk_match`) that need pre-registered voiceprints.
**There is no request parameter to set/limit the number of speakers in blind mode.**
(The `speaker_number` / `has_seperate` params surfaced by a search belong to the
*batch* 语音转写 (lfasr) product, not the real-time AST endpoint.) So no provider
param was added — a deterministic client-side cap is the only reliable fix.
Source: iFlytek docs — https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html

### Fix — deterministic 2-speaker cap
New pure helper `server/src/speaker-cap.ts`:
- `XFYUN_MAX_SPEAKERS = 2`.
- `createSpeakerCap(maxSpeakers = 2)` returns `{ map(rawId), reset() }`.
- **Fold heuristic** (documented in the file): track distinct raw ids in order of
  first appearance; the 1st distinct → slot 0, the 2nd → slot 1; any FURTHER distinct
  id (overflow) folds onto the **most-recently-active in-cap slot** at the moment it
  first appears, and is then PINNED to that slot so repeats are stable (a flapping
  cluster id never re-splits a bubble). Re-seeing an already-mapped id re-activates its
  slot, so the next overflow folds onto whoever was most recently speaking.

Wired in `server/src/asr-relay.ts`:
- A per-connection `xfyunSpeakerCap = createSpeakerCap()`.
- In the xfyun emit path, the raw `speakerId` is run through `xfyunSpeakerCap.map()`
  before `emitTranscript` (sim is left untouched — its ids are already a fixed 0/1
  script; paraformer/volc carry no id; CAM++ caps server-side). So the browser only
  ever receives capped ids {0,1} → role resolution, candidate gating, the UI bubbles,
  and `set-speaker-role` all key off the capped id consistently.
- The cap is reset in `setAsrProvider` ONLY on a genuine provider CHANGE (fresh
  engine), not on the full-config re-push that re-asserts the same provider
  mid-interview (which must keep the established slot mapping stable).

Manual relabel still works: the interviewer taps 面试官/候选人 on either capped slot;
`set-speaker-role` carries the capped id, and `relabelSegments` re-labels all that
speaker's bubbles.

### Tests
`server/test/speaker-cap.test.ts` (pure helper, 8 tests):
- `XFYUN_MAX_SPEAKERS === 2`; first two distinct ids → slots 0/1 in order; ids
  1,2,3,4 → `[0,1,1,1]` (≤2 distinct); over-segmented stream `0,1,0,2,1,3,2,0` → ≤2
  distinct; folding is stable on repeat; fold targets the most-recently-active slot;
  `reset()` starts fresh; a single-speaker stream stays on slot 0.

`server/test/asr-relay-xfyun-cap.test.ts` (relay integration, 3 tests; sets `XFYUN_*`
env + dynamic-imports the relay so the `config` singleton picks up the creds):
- an over-segmented xfyun stream (rl ids 1,2,3,4) emits 4 finals but ≤2 distinct
  capped speaker ids, with the first two as 0/1 (the failing test that drove the fix);
- partials (no speakerId) pass through untouched;
- a genuine 2-speaker stream `5,9,5` maps to `[0,1,0]` (both speakers kept).

`web/src/lib/useCopilotSocket.test.ts` (frontend end-to-end, 1 test):
- with capped ids on the wire (0,1,0), `speakerSegments` collapse to exactly the two
  speakers {0,1}, and `setSpeakerRole(1, 'candidate')` re-labels all of speaker 1's
  bubbles AND sends `{ type:'set-speaker-role', speakerId:1, role:'candidate' }`.

The CAM++/offline diarize path is unaffected (the cap is applied only on the xfyun
branch; the existing `asr-relay.test.ts` offline/volc/sim cases still pass).

---

## Suite status

- `@open-cluely/web` (vitest): **159 passed / 159**, 20 files — fully green
  (baseline 152; +7 new tests added by this change: 4 TranscriptStream + 1 Shell
  iFlytek-feeding + 2 Shell auto-clear − net, plus 1 useCopilotSocket capped-ids).
- `@open-cluely/server` (node:test): **148 passed / 8 failed** — the pass count rose
  from the baseline 137 by +11 new tests (8 speaker-cap + 3 xfyun-cap integration);
  the **failing count is unchanged at 8** and the failing tests are byte-identical to
  the pre-existing baseline on `origin/main`: `server/test/dashscope.test.ts` (7 —
  require a DashScope API key / live fetch; fail at `dashscope.ts:83` "no key") and
  `server/test/ws-analyze.test.ts` (1 — "expected at least one progress message",
  model/network dependent). None are in files touched by this change.

## Files changed
- `web/src/desktop/TranscriptStream.tsx` — show speaker bubbles when segments exist
  (not only offline); keep room-mic fallback offline-only. (#1)
- `web/src/desktop/Shell.tsx` — feed analyze buffer from candidate-labeled segments
  whenever segments exist (#1); auto-clear candidate cache on the last-source-stopped
  edge (#2).
- `server/src/speaker-cap.ts` — NEW: pure 2-speaker cap helper + `XFYUN_MAX_SPEAKERS`. (#3)
- `server/src/asr-relay.ts` — apply the cap on the xfyun speakerId; reset on provider
  change. (#3)
- `web/src/desktop/TranscriptStream.test.tsx` — Bug #1 UI tests (4 new).
- `web/src/desktop/Shell.test.tsx` — Bug #1 feeding test + Bug #2 auto-clear tests (3 new).
- `web/src/lib/useCopilotSocket.test.ts` — Bug #3 frontend capped-ids + relabel test (1 new).
- `server/test/speaker-cap.test.ts` — NEW: Bug #3 cap helper tests (8 new).
- `server/test/asr-relay-xfyun-cap.test.ts` — NEW: Bug #3 relay integration tests (3 new).
