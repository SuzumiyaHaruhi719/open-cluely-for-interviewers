# Seed ASR 2.0 panel-interview design

## Purpose

Use the entitled Doubao Seed ASR 2.0 hourly service as a first-class live recognizer, enable its native acoustic speaker clustering, and make automatic Expert delegation safe for interviews with multiple interviewers and one candidate.

## Verified provider contract

- Production resource: `volc.seedasr.sauc.duration` (Seed ASR 2.0 hourly). The configured account opens this resource; its concurrent SKU is not entitled.
- Endpoint: `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream`.
- Authentication remains server-only through `VOLC_APP_ID` and `VOLC_ACCESS_TOKEN`. The Volc secret key is neither required by this WebSocket protocol nor stored by the application.
- The current Volcengine streaming WebSocket documentation requires `request.enable_speaker_info: true` and `request.ssd_version: "200"` to enable ASR 2.0 speaker clustering. Language must be absent or `zh-CN`.
- `enable_nonstream: true` is required only when speaker clustering is used on the optimized bidirectional endpoint. This application uses `bigmodel_nostream`, so it must not add an unrelated endpoint flag.
- Reference: <https://docs.volcengine.com/docs/6561/1354869?lang=zh> (updated 2026-06-26).

## Approaches considered

### Native-first hybrid — selected

Ask Seed ASR 2.0 for stable acoustic cluster IDs, keep every cluster distinct, and let thinking-disabled DeepSeek v4 Flash map clusters and exceptional turns to semantic interview roles. This preserves identity evidence without trusting numeric speaker order and degrades safely to semantic text-only partitioning when the provider omits a cluster.

### Semantic-only partitioning

Continue sending text-only turns to DeepSeek. This already separates interviewer/candidate speech reasonably well, but it cannot reliably distinguish multiple interviewers or retain voice continuity across a long panel interview.

### Separate diarization model

Add another acoustic model before ASR. This adds latency, deployment weight, and another failure mode, and the user explicitly excluded CAM++ while asking to try provider-native separation first.

## Role and identity model

- `speakerId` is an opaque acoustic cluster, not a role and not a person name.
- Any number of distinct `speakerId` values may map to `interviewer`; one or more over-clustered IDs may also map to the single candidate role.
- Numeric ID order, first-speaker order, capture source, and speaking duration never determine role.
- DeepSeek returns one stable role per native cluster plus high-confidence per-turn exceptions for obvious acoustic drift.
- A manual speaker-role correction remains the highest-precedence decision.
- When Doubao omits usable speaker metadata, the existing text-only semantic partitioner remains active. There is no silent ASR 1.0 or external-diarizer fallback.

## Native response normalization

`volc-client.ts` will normalize a provider utterance into `{ text, isFinal, speakerId? }`.

- Prefer a finite integer on the utterance itself (`speakerId`, `speaker_id`, or `speaker`).
- Also accept the same keys from `utterance.additions` when it is either an object or a JSON string, because Volc feature metadata is returned through additions in this protocol family.
- Ignore empty, negative, non-integer, or malformed values rather than fabricating a cluster.
- Preserve the speaker ID only on the utterance that supplied it. Never copy the last cluster onto a rolling partial or another utterance.

The live provider test is authoritative for the exact response shape returned by the entitled account. Parser support remains deliberately narrow and covered by fixtures.

## Panel-aware automatic delegation

The auto-question sentinel must understand the live exchange, not merely a candidate text blob.

1. Every semantically confirmed interviewer turn closes the previous answer window and joins a bounded list of consecutive panel prompts.
2. Every semantically confirmed candidate turn grows a candidate-only evidence window.
3. The Flash sentinel receives both sections: recent interviewer context and candidate evidence. It uses the former only to detect what has already been asked and the latter to decide whether a concrete evidence gap remains.
4. When the sentinel delegates, the Expert generator receives the same interviewer context but may anchor quotes only in candidate evidence.
5. A new interviewer turn from any interviewer cluster invalidates an armed or in-flight autonomous suggestion for the prior answer.
6. Back-to-back interviewer turns are retained together until candidate speech begins, so a panel member's clarification does not erase the original question.
7. Expert output stays one pure-Chinese question, includes non-zero provider token usage when reported, and remains inside the existing sequential `<10s` budget.

## Data flow

1. Browser audio sends 16 kHz mono PCM to the selected `volc` relay.
2. `volc-client.ts` opens Seed ASR 2.0 hourly, sends the native clustering request, and parses final utterances with optional acoustic cluster IDs.
3. `ws.ts` records every final turn in `speaker-partitioner.ts`.
4. DeepSeek maps any number of native clusters to interviewer/candidate roles and applies sparse semantic turn corrections.
5. The partitioner emits a full transcript-role snapshot and releases each role-confirmed turn once.
6. Interviewer turns update the bounded panel context and cancel stale delegation; candidate turns update only the evidence window.
7. The monitor delegates a concrete gap to the one-call Expert workflow, whose question is anchored below the relevant candidate transcript turn.
8. Stop drains the provider, runs final semantic correction, and emits the terminal ASR state.

## Failure behavior

- Missing or malformed Doubao speaker metadata yields a text-only turn and semantic fallback, not an ASR failure.
- Provider authorization failures stay visible and never downgrade to BigASR 1.0.
- Monitor or Expert timeout fails closed/falls back without interrupting audio.
- Stop invalidates pending autonomous questions before the provider drain, preventing late suggestions after the interview ends.
- Secrets never enter renderer payloads, reports, logs, commits, or implementation notes.

## Acceptance criteria

- The config frame for Seed ASR 2.0 contains `enable_speaker_info: true`, `ssd_version: "200"`, `show_utterances: true`, and the existing `result_type: "single"`.
- Volc parser fixtures prove native speaker IDs survive object, snake-case, numeric-string, and JSON-string additions shapes while malformed values are ignored.
- A live real-time MP3 replay returns Seed ASR 2.0 transcripts and, when the service supplies clusters, at least two distinct native IDs.
- A three-speaker fixture maps two acoustic IDs to interviewer and one to candidate without collapsing IDs.
- Back-to-back panel prompts remain visible to the sentinel, but generation input and anchor quotes remain candidate-only.
- A newly confirmed interviewer turn from either interviewer invalidates a pending suggestion.
- Real-audio QA records monitor lifecycle, at least one meaningful automatic question when sufficient candidate evidence exists, a valid anchor sequence, non-zero token usage when reported, and `<10s` Expert latency.
- Full server/web tests and production build pass; implementation notes are updated; each accepted checkpoint is committed and pushed to `main`.
