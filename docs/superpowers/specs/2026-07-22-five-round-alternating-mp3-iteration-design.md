# Five-Round Alternating MP3 Product Iteration Design

## Purpose

Exercise Interview Copilot as an interviewer would use it, alternating two real interview recordings for five complete cycles, and turn every reproduced user-facing failure into a traced, regression-tested, replay-verified fix.

## Audio fixtures

The fixtures are the two distinct Bilibili interview recordings already supplied by the user:

1. `/Users/thomasli/Downloads/Bilibili Interview 86.6.mp3`
   - 7 minutes 24 seconds.
   - Property-management interview content.
   - Uses the built-in `物业经理` JD and interview guide.
2. `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`
   - 8 minutes 13 seconds.
   - User-operations expert interview with repeated interruptions.
   - Uses `用户运营专家（P8）` in round 2 and `用户运营专家（P7）` in round 4.

The `(1)` and non-`(1)` copies of each recording are byte-identical and therefore cannot count as separate evidence. Both source files are AAC in MP4 containers despite their `.mp3` suffixes. Each run uses a temporary, non-destructive mono 16 kHz PCM16 WAV conversion.

## Five-round matrix

| Round | Recording | JD context | Primary user risk |
|---|---|---|---|
| 1 | 86.6 | 物业经理 | baseline transcription, role assignment, transcript order, and Auto-question usefulness |
| 2 | P7/P8 | 用户运营专家（P8） | interruptions, whole-voiceprint stability, expert-level question quality, and latency |
| 3 | 86.6 | 物业经理 | regression after rounds 1–2, note/timeline integrity, and repeated-run lifecycle |
| 4 | P7/P8 | 用户运营专家（P7） | level-specific context, interruption recovery, non-repetitive questions, and finalization |
| 5 | 86.6 | 物业经理 | final adversarial replay, reset/isolation, UI usability, and summary readiness |

Every round replays the complete recording at 1× through Doubao Seed ASR 2.0 with the internal Balanced Auto gate. CLI evidence and the visible local web app are complementary: CLI proves transport/model invariants, while the browser proves what the interviewer actually sees and can operate.

## Round evidence contract

Every round writes one section to `docs/qa/2026-07-22-five-round-mp3-iteration.md` containing:

- recording, JD, build commit, start/end time, duration, and exact command;
- provider lifecycle, partial/final counts, first-final time, native speaker IDs, and final assignment partition;
- every Auto question with evidence anchor, trigger time, latency, model, and token usage;
- visible-browser checks for ordering, scrolling, active partials, role labels, question placement, controls, and end-of-interview state;
- the concrete user-facing problem reproduced in that round;
- root cause traced across browser, WebSocket, server, provider, and state boundaries as applicable;
- the regression test that first failed for the expected reason;
- the minimal code fix and why it addresses the source rather than the symptom;
- targeted green test, full affected-suite result, production build result, and replay evidence;
- commit hash and remaining risks.

A round is not complete merely because existing gates pass. If no distinct user-facing defect is found, the round stays open and is replayed with a focused adversarial condition until one is either found and fixed or the evidence justifies a documented product improvement that directly removes a real usability risk.

## Product acceptance gates

### Audio and ASR

- Seed ASR 2.0 reaches `live`, drains final results before `stopped`, and reports no transport errors.
- Real-time stream duration remains within two percent or 1.5 seconds of the source duration.
- Rolling partials appear while speech is active; final transcript segments preserve provider audio time and chronological order.
- Resetting or starting the next round cannot leak transcripts, assignments, notes, cooldowns, or questions from the prior round.

### Speaker roles

- A provider-native speaker ID is the atomic role unit.
- No accepted partition may assign one native ID to both interviewer and candidate.
- Ambiguous IDs remain `待确认`; pending/interviewer speech cannot release Auto questions.
- Multiple interviewer IDs may map to interviewer, and repeated interruptions cannot split or flip a delegated voiceprint.
- Final partition is applied before capture reports stopped.

### Questions

- Auto questions are anchored only to delegated/manual candidate evidence.
- No question fires while the interviewer is speaking, before a substantive candidate answer, or from unchanged evidence.
- Expert generation completes in under 10 seconds or uses the local evidence-grounded fallback.
- Repeated questions cannot ask the same evidence dimension against materially identical evidence.
- P7/P8 and property-manager questions use only the selected JD context and remain Chinese except for source-grounded product names or acronyms.

### Interviewer experience

- Active partial text visibly grows during speech instead of appearing only as large final blocks.
- Transcript chronology, timestamps, notes, and AI follow-ups share one scrollable timeline.
- AI follow-ups appear below the evidence that triggered them rather than in a permanent detached area.
- Manual follow-up remains available; stop, summary, clear, context, theme, interview type, and audio controls remain operable.
- Ending capture and ending the interview have distinct, understandable effects; destructive end action requires confirmation.

## Defect workflow

1. Reproduce the symptom in a complete audio run and save the report.
2. Locate the first boundary where observed data diverges from expected data.
3. State one root-cause hypothesis and test it with the smallest diagnostic.
4. Add a regression test that fails because the defect still exists.
5. Implement one focused fix.
6. Verify the regression test and affected suite.
7. Rebuild and replay the same fixture until the original symptom is absent.
8. Update the round journal and matching Obsidian implementation note.
9. Commit and push the round checkpoint to `main` as explicitly requested by the user.

## Failure handling

- Provider entitlement or network failures are recorded as external evidence and retried without changing product code unless error handling itself is defective.
- A model timeout is not automatically a product defect; missing fallback, repeated fallback, misleading status, or failure to recover is.
- Ambiguous ground truth is never converted into a claim of perfect speaker accuracy. Identity-consistency invariants and role evidence are reported separately.
- If a proposed fix fails three times, stop patching symptoms and reassess the affected architecture before another implementation attempt.

## Deliverables

- Five completed, alternating full-audio rounds in the QA journal.
- One or more focused code/test commits for every round, pushed to `main`.
- Updated matching notes under the Obsidian `Interview Copilot/Implementation/` folder.
- Fresh full tests, production build, local server health, and final visible-browser verification.
- A completion audit that maps every requirement in this design to current evidence.
