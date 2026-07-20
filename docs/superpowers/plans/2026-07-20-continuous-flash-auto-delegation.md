# Continuous Flash Auto-Delegation Implementation Plan

> Execute test-first on `main`, with small verified commits pushed after each durable checkpoint.

## 1. Timeline contract and client state

- Add optional `anchorSeq` to the result contract and parser.
- Add failing hook tests proving results accumulate and retain their anchors.
- Replace the singleton result render with ordered question events interleaved after matching speaker segments.
- Preserve a tail fallback for manual/unanchored results and clear all events on New Interview.

## 2. Server anchor propagation

- Pass semantic `SpeakerTurn.seq` into the auto trigger with each candidate final.
- Retain the latest eligible anchor through debounce, monitoring, and Expert generation.
- Emit `anchorSeq` on automatic results and cover it in WebSocket tests.

## 3. Continuous Flash sentinel

- Add a strict, thinking-disabled `deepseek-v4-flash` sentinel with a 3-second timeout, no retries, bounded candidate/JD/guide context, and fail-closed parsing.
- Make semantic candidate finals schedule evaluation independently of raw PCM activity.
- Keep confirmed interviewer turns, Stop, Auto off, manual generation, and New Interview as hard stale-work boundaries.
- Once delegated, make the Expert path always emit a validated question or deterministic fallback.

## 4. Visible monitor state

- Add `auto-monitor` protocol messages for `evaluating`, `waiting`, `delegating`, and `idle`.
- Store the state in the socket hook and map it onto the existing GLP Auto pill without adding settings or panels.

## 5. Production verification

- Run focused server/web tests after each implementation slice, then full suites, typechecks, and builds.
- Replay the supplied MP3 silently through BlackHole 2ch with Xunfei and verify real incremental transcript, semantic roles, monitor/delegation state, and an inline Chinese Expert question below its candidate evidence.
- Update the matching Obsidian Implementation notes, commit, and push `main`.
