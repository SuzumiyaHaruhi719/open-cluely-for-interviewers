# Fail-safe speaker-role ledger design

## Purpose

Prevent interviewer and candidate turns from being silently mixed when acoustic diarization drifts, while preserving low-latency live transcripts and panel-interview support.

## Root cause

The existing partitioner has two independent sources of role evidence: a stable role for each native ASR `speakerId`, and a semantic exception for an individual transcript `seq`. Three state boundaries can turn one bad inference into a persistent product error:

- Native finalization only sends cluster anchors plus the latest eight native turns to DeepSeek, so early and middle turns in a long interview are never reconsidered after capture ends.
- `cachedTurnRoles` only accepts new high-confidence labels. If a later classifier response explicitly changes a turn to `unknown`, the older role is never removed.
- Auto-question bookkeeping consumes the resolved cluster baseline even when no per-turn semantic verdict exists. A drifting voice cluster can therefore feed a candidate answer into the interviewer lane, or trigger a question from interviewer speech.

The acoustic `speakerId` is useful evidence but cannot be treated as identity: Seed ASR may split one person into several clusters or reuse a cluster across different people. A panel interview also legitimately has multiple interviewer clusters.

## Considered approaches

1. **Add more Chinese phrase heuristics.** This repairs individual replay examples but is brittle across jobs, languages, speaking styles, and incomplete ASR fragments.
2. **Trust acoustic clusters and expose manual correction.** This is fast, but a single cluster collision still mislabels many turns before a person notices.
3. **Use a per-turn semantic ledger with fail-safe ambiguity.** Recommended. Acoustic clusters remain a provisional display baseline; role-sensitive behavior requires explicit semantic evidence, and finalization revisits every transcript turn in bounded overlapping batches.

## Decision

Use a reversible, per-turn semantic role ledger driven by DeepSeek v4 Flash.

- Every classifier observation for a requested `seq` replaces the previous semantic verdict for that turn. An explicit `unknown` revokes a stale cached label.
- Live checks continue to use a bounded recent window and preserve the existing eight-second request budget.
- Finalization divides every transcript `seq` into bounded review batches. Each batch includes its target turns, direct neighbours, and limited native cluster anchors, so every turn is inspected with local context without sending the whole interview in one prompt.
- Batch results are merged per turn. A high-confidence agreement becomes `candidate` or `interviewer`; conflicting equally credible observations and low-confidence results become `unknown`.
- Final native turns do not fall back to an acoustic cluster label when their semantic review is unresolved. They render as `待确认`, which is safer than a confident wrong label.
- Manual role corrections remain authoritative. High-precision local repairs for split questions, answer continuations, and score announcements remain after the semantic merge.
- Auto-question and interviewer-monitor bookkeeping only consume turns that have high-confidence per-turn semantic evidence or a high-precision local repair. A provisional acoustic baseline may color the live transcript but cannot trigger role-sensitive AI behavior.
- Multiple acoustic clusters may resolve to `interviewer`; no one-interviewer/one-candidate assumption is introduced.

## State and precedence

Each semantic ledger entry stores `role`, `confidence`, and whether the current final sweep observed the turn.

Final display precedence:

1. Manual role correction for a native acoustic cluster.
2. High-precision local turn repair.
3. High-confidence per-turn semantic ledger verdict.
4. Live-only high-confidence acoustic cluster baseline.
5. `unknown` / `待确认`.

Role-sensitive Auto precedence is stricter:

1. High-precision local turn repair that passes manual precedence.
2. High-confidence per-turn semantic verdict that passes manual precedence.
3. No release. Acoustic baseline alone is never sufficient.

## Data flow

1. Doubao Seed ASR 2.0 emits finalized text with an acoustic `speakerId`.
2. The partitioner records the turn and periodically asks DeepSeek v4 Flash for cluster baselines plus one semantic verdict per recent turn.
3. The response replaces ledger entries for every turn explicitly observed by the request, including revoking entries returned as `unknown`.
4. The renderer receives a full partition snapshot; live unresolved native turns may use the provisional cluster baseline, while Auto only receives semantically confirmed turns.
5. On stop, the partitioner runs bounded overlapping reviews covering every transcript `seq`, merges the observations, applies manual/local precedence, and emits one authoritative final partition.
6. Any turn without sufficient final evidence remains `unknown` and is shown as `待确认`; it is never silently forced into either person.

## Failure behavior

- One failed final batch marks its target turns unresolved instead of reusing a stale semantic label.
- A total classifier outage preserves the transcript and manual corrections, but final unverified turns remain `待确认`.
- A stale live verdict cannot survive an explicit later `unknown` or conflicting final observation.
- Stopping capture closes the Auto gate before the final sweep, so reconciliation cannot generate a late question.
- The ledger is cleared atomically with the interview session.

## Verification

- A long native transcript test proves final review requests cover every `seq`, not only the latest window.
- A regression proves explicit `unknown` revokes a stale per-turn role.
- A disagreement regression proves equally credible conflicting final labels resolve to `unknown`.
- A delegation regression proves an acoustic cluster baseline alone cannot release a turn to candidate/interviewer Auto callbacks.
- Existing multi-interviewer, manual-precedence, split-question, score, and answer-continuation regressions remain green.
- The browser renders unresolved roles as `待确认`.
- Full tests, typecheck, production build, and a BlackHole MP3 replay verify the integrated path.
