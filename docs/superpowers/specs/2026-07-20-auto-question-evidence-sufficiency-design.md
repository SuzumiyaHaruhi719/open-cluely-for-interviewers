# Auto-question evidence sufficiency design

## Purpose

Prevent Auto mode from spending the live Expert call on a cut-off, padded, or low-information candidate fragment while preserving the existing under-10-second single-call path.

## Decision

Use a deterministic admission check inside `decideLocalTrigger()` before the existing Expert Flash call.

- Reject an answer whose tail is a connective or otherwise looks unfinished.
- Accept provider text without final punctuation only when its ending is a recognizable completed ASR clause.
- Require at least two substantive clauses plus either two distinct concrete actions, or one action combined with both an outcome and a specific operational detail.
- Preserve the existing capture, quiet-period, cooldown, minimum-new-character, speaker-role, and `should_ask` gates.
- Make no second model call and add no visible setting.

## Alternatives considered

1. Raise `AUTO_MIN_NEW_CHARS`. Rejected because repeated generic speech can cross any fixed length and short evidence-rich answers would wait unnecessarily.
2. Restore a separate Flash monitor. Rejected because a serial model call consumes the same 10-second latency budget as question generation.
3. Deterministic completeness and evidence checks. Chosen because they are local, testable, language-aware, and add effectively zero latency.

## Data flow

1. A role-confirmed candidate final reaches `onCandidateFinal()`.
2. Existing capture/cooldown/new-character gates arm the real-silence debounce.
3. `decideLocalTrigger()` normalizes the candidate window and applies filler, completion, clause, action, outcome, and detail checks.
4. Rejected evidence stays available for a later final; no progress card or model request starts.
5. Admitted evidence goes through the unchanged one-call Expert Flash generator with JD, interview guide, resume, and question history.

## Error and boundary behavior

- Provider punctuation is helpful but not mandatory: completed result/time endings are accepted.
- Connective tails such as “因为” and “接下来” always wait for more speech, regardless of length.
- Generic repetition does not become eligible merely by crossing the character threshold.
- Speech resumption, interviewer handoff, capture Stop, reset epochs, and model `should_ask:false` keep their existing cancellation behavior.

## Verification

- Unit tests prove rich evidence is admitted.
- Unit tests prove long cut-off fragments and padded generic speech are rejected.
- Unit tests prove completed ASR text without terminal punctuation can still pass.
- Full server tests, typecheck, build, and a real MP3/BlackHole browser pass protect the surrounding pipeline.

