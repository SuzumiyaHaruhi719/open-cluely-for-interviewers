# iFlytek (讯飞) fast hand-off speaker-attribution fix

**Branch:** `fix/xfyun-fast-handoff-speakers`
**Scope:** iFlytek text-parsing layer only (`server/src/xfyun-client.ts`). No frontend, no other providers (paraformer / volc / sim / CAM++) touched.

User report (verbatim): *"如果考生和面试官说话衔接过快 很容易把考生和面试官混起来 … 修复 不要管成本"*
("When the candidate and interviewer hand off too fast, it easily mixes up candidate and interviewer … fix it, don't worry about cost.")

---

## Symptom

When candidate (考生) and interviewer (面试官) speak with very fast hand-offs
(back-to-back / cross-talk) under the iFlytek provider (`xfyun`, 角色分离
`role_type=2`), their speech was attributed to the **wrong** speaker — candidate
and interviewer got mixed up.

## Root cause

`server/src/xfyun-client.ts` → `extractResult()` (old code, around **lines
132–172** on `origin/main`).

iFlytek 角色分离 tags the role id `rl` **per word**:
`data.cn.st.rt[].ws[].cw[].rl`. `rl="0"` means "continue the previous speaker";
non-zero values are distinct roles. During fast turn-taking iFlytek packs **both**
speakers' words into a **single** `result` frame, with a different `rl` per word.

The old `extractResult`:

- concatenated **all** words across `rt[].ws[].cw[]` into one `text`, and
- picked the segment speaker as the **first** non-`"0"` `rl` found
  (`if (segSpeaker === null) …`), **discarding every later per-word `rl`**.

So an entire frame collapsed to **one** transcript with **one** speaker. A frame
carrying interviewer words (`rl=1`) followed by candidate words (`rl=2`) was
emitted wholesale as speaker 1 — the candidate's words mislabeled as the
interviewer (and vice-versa). `createXfyunSession.handleServerFrame` compounded
this by emitting exactly one `onTranscript` per frame.

## The fix — split a frame into consecutive same-speaker runs

Rewrote `extractResult` to return **runs** instead of a single segment:

```ts
extractResult(data, prevSpeaker)
  : { runs: XfyunTranscript[]; speaker: number | null } | null
```

Algorithm (FINAL frames):

1. Flatten the frame to an ordered word list `{ w, rl }`, where `rl` is
   `parseInt(rl,10)` when finite & non-zero, else `null` ("continue").
2. Walk words in order. "current speaker" starts at the carried `prevSpeaker`
   (last-known across frames, default `0`).
3. `rl=null` (i.e. `"0"`, missing, or non-numeric) or an `rl` equal to the
   current speaker → **continue** the current run.
4. A non-zero `rl` that **differs** from the current speaker → **flush** the
   accumulated run as one final transcript, then start a new run with that
   speaker.
5. After the last word, flush the final run.
6. Carry the **last** run's speaker forward as the next frame's `prevSpeaker`
   (so a following frame that opens with `rl="0"` inherits it).

Each run is emitted as its own `XfyunTranscript { text, isFinal, speakerId }`.
`createXfyunSession.handleServerFrame` now iterates the runs:

```ts
const extracted = extractResult(obj.data, lastSpeaker);
if (!extracted) return;
lastSpeaker = extracted.speaker;
for (const run of extracted.runs) onTranscript(run);
```

**Partials** (`st.type !== "0"`) keep their prior behavior: one run of the
concatenated text with `speakerId: null` (no per-word splitting — partials are
transient). They still resolve a carry-forward speaker so a partial frame doesn't
drop the running speaker for the next frame.

Empty/wordless frames still return `null` (unchanged).

### Worked example (the core bug)

Frame words `rl` `1,1,2,2` with `prevSpeaker=0`:

| old behavior | new behavior |
|---|---|
| 1 transcript: text = all 4 words, speakerId = 1 | run 1: words 1–2 → speakerId **1**; run 2: words 3–4 → speakerId **2** |

Rapid alternation `1,2,1,2` → **4** runs, one per word, correct per-run speaker.

## Interaction with the 2-speaker cap

`server/src/speaker-cap.ts` (`createSpeakerCap`, `XFYUN_MAX_SPEAKERS = 2`) is
applied in `asr-relay.ts` `startSource` via `xfyunSpeakerCap.map(rawId)` on each
run's `speakerId`. This is unchanged and correct:

- Each run's raw `rl` now flows through the cap individually.
- The cap maps the 1st distinct raw id → slot 0, the 2nd → slot 1, and only folds
  the **3rd+** distinct id. For the normal 2-speaker interview (two distinct
  `rl`s) it does **not** re-collapse the now-correct per-run ids — it just
  renumbers them to slots 0/1.
- `asr-relay-xfyun-cap.test.ts` and `speaker-cap.test.ts` still pass unchanged.

The fix and the cap are complementary: `extractResult` stops *mislabeling* words
within a frame; the cap stops *over-segmenting* a 2-person interview into >2
slots. Both are needed.

## Tests

New file `server/test/xfyun-client.test.ts` (13 tests), TDD red→green:

`extractResult`:
- **FINAL `rl` 1,1,2,2 → two runs** (speakerId 1 then 2) — the core red→green test.
- Rapid alternation `rl` 1,2,1,2 → four runs with correct per-run text+speaker.
- Leading `rl="0"` attaches to the carried `prevSpeaker` (continuation, not dropped).
- Leading `rl="0"` with no prior speaker → falls back to 0.
- All-one-speaker (`rl` 1,1,1) → a single run (no regression).
- `rl="0"` between same-speaker words → no spurious split.
- Missing / non-numeric `rl` → treated as continuation.
- Partial (`type="1"`) → one run, `speakerId: null`.
- Empty / wordless / null frame → `null`.

`createXfyunSession` (via an injected fake WebSocket, mirroring the existing
session-test style):
- Multi-speaker FINAL frame → **one `onTranscript` per run**.
- `prevSpeaker` carries across frames (a frame opening with `rl="0"` inherits the
  previous frame's last speaker).
- Single-speaker final → exactly one `onTranscript` (no regression).
- Partials → one emit, no `speakerId`.

### Results

- **New tests:** 13/13 pass (RED first: 10 failed on the old code with
  `out.runs` undefined / single collapsed emit; GREEN after the fix).
- **Server suite** (`npm test --workspace @open-cluely/server`): 169 tests,
  **161 pass, 8 fail**. The 8 failures are **pre-existing / environmental** — the
  worktree has no `.env`, so 7 tests in `dashscope.test.ts` and 1 in
  `ws-analyze.test.ts` fail for lack of a live DashScope key. Baseline before the
  change was 156 tests / 148 pass / **the same 8 fail**; the fix added 13 passing
  tests and introduced **zero** new failures.
- **`asr-relay-xfyun-cap.test.ts` + `speaker-cap.test.ts`:** pass.
- **Web suite** (`npm test --workspace @open-cluely/web`): **159/159 pass**.
- **Typecheck** (`tsc --noEmit`, server): clean.

## Files changed

- `server/src/xfyun-client.ts` — rewrote `extractResult` (run-splitting; new
  `{ runs, speaker }` return); `createXfyunSession.handleServerFrame` now emits
  one transcript per run; updated the protocol doc comment.
- `server/test/xfyun-client.test.ts` — new test file (added).
- `docs/xfyun-handoff-fix-report.md` — this report.
