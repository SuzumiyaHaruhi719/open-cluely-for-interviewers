# Candidate-First Auto Follow-ups Design

## Purpose

Start autonomous interviewer follow-ups as soon as a candidate voiceprint is confirmed. Interviewer voiceprint confirmation may improve context and close stale answer windows, but it must never be a prerequisite for generating from confirmed candidate evidence.

## Product invariant

- Only role-confirmed candidate turns enter the Auto evidence buffer.
- Confirming any interviewer voiceprint is optional for Auto admission.
- A delivered question does not hard-lock the rest of a candidate's continuous answer.
- Additional questions require all existing adaptive gates: active capture, no generation in flight, cooldown elapsed, enough new candidate text, semantic debounce, and a positive Flash evidence-gap verdict.
- Manual generation still consumes the current evidence window and resets cooldown, preventing an immediate duplicate Auto question.

## Data flow

1. Doubao emits provider-native speaker turns.
2. `speaker-partitioner.ts` confirms a candidate voiceprint and calls `onCandidateTurn`.
3. `ws.ts:feedCandidateAnswer()` appends only that confirmed candidate text and calls `autoTrigger.onCandidateFinal()`.
4. `auto-trigger.ts` applies local admission gates, then asks the Flash sentinel whether a distinct evidence gap is worth delegating.
5. A successful Expert question consumes only the evidence used for that question. Later confirmed candidate text starts the next candidate-only evidence window.
6. Confirmed interviewer turns remain useful cancellation/context boundaries but do not unlock Auto.

## Admission and anti-spam behavior

- Preserve the configured `20,000 ms` cooldown and `120` new-character minimum.
- Preserve the `3,000 ms` semantic debounce and single in-flight generation lock.
- Preserve the Flash monitor and its evidence-sufficiency/liveness behavior.
- Remove `suggestionDeliveredForAnswer` as a global admission lock in both agent and interval modes.
- Do not change speaker-confidence thresholds or feed unknown/interviewer turns into candidate evidence.
- Do not add a fixed timer or generate generic questions without new candidate evidence.

This keeps the protection that matters—candidate-only evidence and semantic novelty—without coupling follow-up frequency to successful interviewer voiceprint classification.

## Failure handling

- Monitor or Expert failures remain fail-closed and do not consume candidate evidence as a delivered question.
- Stopped capture, session reset, or a confirmed interviewer boundary still invalidates stale in-flight work.
- A manually generated question still clears the current candidate window.

## Verification

- A second substantive candidate delta after cooldown can generate without calling `onInterviewerFinal()`.
- A second delta inside cooldown cannot generate.
- Interviewer-only or unknown turns never feed Auto.
- Manual generation prevents an immediate automatic duplicate.
- Existing server and web tests, type checks, and production build remain green.

## Non-goals

- No UI or settings changes.
- No reduction of voiceprint-delegation confidence.
- No fixed-frequency question timer.
- No change to how questions are anchored in the transcript.
