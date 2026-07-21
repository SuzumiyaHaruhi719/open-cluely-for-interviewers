# Five-Round MP3 Product Iteration Journal

## Test contract

- Date/timezone: 2026-07-22, Asia/Shanghai.
- Starting build: `54a5b7f` (`main`).
- Provider: Doubao Seed ASR 2.0 (`volc`).
- Question path: Balanced Auto gate → DeepSeek V4 Flash Expert.
- Playback: complete normalized source at 1× unless a round explicitly records an additional focused diagnostic.
- Design: `docs/superpowers/specs/2026-07-22-five-round-alternating-mp3-iteration-design.md`.
- Plan: `docs/superpowers/plans/2026-07-22-five-round-alternating-mp3-iteration.md`.

## Immutable fixtures

### A — Property interview

- Source: `/Users/thomasli/Downloads/Bilibili Interview 86.6.mp3`.
- SHA-256: `c646c5e3d002c0ed606022abda5f72819351c7d0bdeb04f2e4ad6f8c8ef93980`.
- Container: AAC audio in ISO Base Media/MP4 despite the `.mp3` suffix.
- Duration: 00:07:24.15.
- Temporary normalized fixture: `/tmp/open-cluely-five-round-20260722/property-16k.wav`.
- Context: built-in `物业经理` JD and 100-point guide.

### B — P7/P8 user-operations interview

- Source: `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`.
- SHA-256: `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`.
- Container: AAC audio in ISO Base Media/MP4 despite the `.mp3` suffix.
- Duration: 00:08:13.52.
- Temporary normalized fixture: `/tmp/open-cluely-five-round-20260722/p7p8-16k.wav`.
- Context: built-in `用户运营专家（P8）` in round 2 and `用户运营专家（P7）` in round 4.

The `(1)` and non-`(1)` copies of each source have matching hashes and are not counted as distinct fixtures.

## Round 1 — A / 物业经理

Status: running.

## Round 2 — B / 用户运营专家（P8）

Status: pending Round 1 checkpoint.

## Round 3 — A / 物业经理

Status: pending Round 2 checkpoint.

## Round 4 — B / 用户运营专家（P7）

Status: pending Round 3 checkpoint.

## Round 5 — A / 物业经理

Status: pending Round 4 checkpoint.

## Completion audit

Status: pending all five verified rounds.
