# Semantic speaker weak-correction design

## Purpose

Correct clearly mislabelled interviewer/candidate turns when native ASR acoustic IDs drift, without turning a semantic guess into a permanent voiceprint remap.

## Root cause

The current native-cluster path learns one stable role per `speakerId` and reuses it across the interview. DeepSeek can return a per-turn exception, but the classifier input samples only the first two and last two turns of each cluster. A long candidate answer can therefore be absent from the model's context while the stale cluster role still labels it as interviewer. Xunfei can also split one grammatical question across changing acoustic IDs; in real replays Flash labelled the two outer fragments as interviewer but gave the connective middle fragment a candidate verdict, sometimes with higher isolated confidence. The WebSocket path also releases the provisional cluster role to Auto before the semantic partition finishes, allowing one acoustic error to affect question timing.

## Decision

Keep acoustic roles as a baseline and add a bounded DeepSeek v4 Flash weak-correction layer.

- Native classifier input contains compact per-cluster anchors plus the latest chronological question/answer window.
- The prompt requires one semantic `turnRoles` verdict (or `unknown`) for every recent seq, including obvious speech-act conflicts such as a substantive answer following an interviewer question even when the acoustic ID baseline says interviewer.
- Direct same-source fragments that are grammatically continuous and lack a terminal boundary are marked as a continuity group. Matching 0.90+ Flash roles on both outer fragments constrain every conflicting middle fragment, because the grouped speech act is stronger evidence than an isolated-clause score; endpoint disagreement or ambiguity leaves the group untouched.
- A turn exception affects only its `seq`; it never changes the stable `speakerId` role.
- Manual role corrections remain authoritative over both cluster roles and semantic exceptions.
- Low-confidence cluster assignments are ignored, and per-turn exceptions retain the stricter existing confidence floor.
- Once a baseline exists, a new long finalized turn triggers a correction refresh immediately instead of waiting for three more turns.
- While semantic partitioning is enabled, role-sensitive Auto bookkeeping waits for the partitioner rather than consuming a provisional acoustic role directly.
- No new setting or visible mode is added.

## Role precedence

1. Manual role correction for the acoustic ID.
2. High-confidence DeepSeek per-turn semantic exception.
3. High-confidence DeepSeek stable acoustic-cluster role.
4. `unknown` while evidence is insufficient.

## Data flow

1. Xunfei emits a finalized transcript and native acoustic `speakerId`.
2. The partitioner buffers the turn and builds cluster anchors plus recent chronological context.
3. DeepSeek v4 Flash returns stable `speakerRoles` and sparse high-confidence `turnRoles` conflicts.
4. The server applies manual precedence, caches the per-turn correction, and emits a full partition snapshot.
5. The browser atomically replaces provisional labels; only the corrected partition releases candidate/interviewer events to Auto.
6. Finalization rechecks the latest context while retaining successful live corrections if the final request fails.

## Boundaries

- Length alone never determines a role; it only decides whether a fresh semantic check is worth scheduling.
- Short acknowledgements and ambiguous fragments inherit the acoustic baseline unless DeepSeek is highly confident. Continuity propagation additionally requires matching high-confidence model verdicts on both outer fragments; text shape alone cannot assign a role.
- The recent window is bounded, so classifier latency and output stay inside the existing live budget.
- Text-only and hybrid provider paths remain supported; hybrid input keeps both recent text-only turns and native context.

## Verification

- A regression test reproduces a recent long candidate answer omitted by the old first/last cluster sampler.
- A cadence test proves one long drift turn gets an immediate correction refresh.
- A behavior test proves one corrected candidate turn does not remap a genuine interviewer turn sharing the same acoustic ID.
- Existing manual-precedence tests remain green.
- Full server/web tests, typecheck, build, and a silent MP3/BlackHole browser replay validate the integrated behavior.
