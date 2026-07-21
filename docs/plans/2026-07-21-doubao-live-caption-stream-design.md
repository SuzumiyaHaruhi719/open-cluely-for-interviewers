# Doubao Seed ASR 2.0 live-caption stream design

## Goal

Show genuine rolling Doubao text under `输入中…` and reveal it grapheme by grapheme, while preserving the accurate finalized transcript and native speaker clusters used by semantic role correction.

## Root cause

The web client used `bigmodel_nostream`. Volcengine defines that endpoint as streaming input with sentence-level output: it may wait for more than 15 seconds of audio or the terminal packet. The renderer's 20 ms progressive caption component worked, but its first target was already a sentence-sized block.

## Chosen design

- Connect Seed ASR 2.0 resources to the optimized bidirectional `bigmodel_async` endpoint.
- Set `enable_nonstream:true` so every fast rolling hypothesis is followed by an accurate second-pass `definite` result.
- Keep `enable_speaker_info:true` and `ssd_version:"200"`; native speaker clusters remain attached only to definitive utterances.
- Enable first-text acceleration with score 10. Accelerated text is provisional UI feedback, never role-confirmed interview evidence.
- Keep the existing `ProgressiveLiveText` renderer. It reveals one grapheme every 20 ms and reconciles provider corrections at the common prefix.

## Data flow

1. Browser sends 16 kHz PCM to the per-source ASR relay.
2. `volc-client.ts` forwards PCM to `bigmodel_async` with the two-pass request.
3. Fast-pass `result.text` frames become `transcript` messages with `isFinal:false`.
4. `useCopilotSocket` replaces the source's rolling partial target.
5. `ProgressiveLiveText` reveals that target one grapheme at a time under `输入中…`.
6. Second-pass `definite` utterances become durable finals with optional native `speakerId`; only those enter speaker-role partitioning and Auto evidence.

## Rejected alternatives

- Animating finalized paragraphs locally would look live but misrepresent recognition latency.
- Adding acceleration flags to `bigmodel_nostream` is unsupported and does not change its sentence-return behavior.
- Dropping the second pass would improve provisional latency at the cost of final accuracy and speaker clustering.

## Acceptance criteria

- The protocol config selects `bigmodel_async`, enables the second pass, and enables moderate first-text acceleration.
- A real MP3 replay produces multiple distinct partial hypotheses before finals, not repeated sentence blocks.
- The visible live-caption DOM changes by one grapheme per 20 ms tick under `输入中…`.
- Stop still drains definitive speaker-tagged results without provider or browser errors.
