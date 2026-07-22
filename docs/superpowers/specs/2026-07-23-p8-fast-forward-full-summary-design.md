# P8 Complete Interview Fast-forward and Summary Replay

## Purpose

Turn the standalone P8 introduction into an auditable replay of the complete product journey: the real 493-second interview is transcribed in the product workspace, a visible fast-forward carries the viewer to the end, and the production DeepSeek summary appears with the same evidence-grounded scoring structure used by Interview Copilot.

## Truth contract

- The audio is the complete source MP3 supplied for the P7–P8 interview, not a synthetic clip.
- Transcript events come from the recorded Doubao Seed ASR 2.0 QA run for that exact audio.
- Speaker roles use the QA run's final stable voiceprint assignments: speaker 0 is interviewer, speaker 1 is candidate, and speaker 2 remains non-participant/unknown.
- The report is generated once by the production `SUMMARY_SYSTEM`, `buildSummaryInput()`, and DeepSeek summary path using the complete role-resolved transcript and the built-in P8 JD.
- The portable HTML replays that captured production result deterministically. It must say that it is a production-result replay and must not imply a browser-side live model call.
- Model, elapsed time, input/output token counts, transcript count/length, prompt hash, transcript hash, and fallback state are visible in the summary provenance.

## Experience

### Normal replay

The product frame begins at the start of the complete interview. The existing GLP layout, transcript lanes, role controls, manual question, automatic context, notes, audio controls, theme control, and summary modal remain intact. The persistent progress bar represents the full 08:13 recording.

### Fast-forward

The dock adds one focused `快进至总结` action. Activating it:

1. pauses and mutes ordinary audio playback;
2. advances the authoritative audio clock from the current position to the real end over about eight seconds;
3. updates the visible transcript, clock, progress, role labels, automatic questions, and context from that same clock;
4. displays `60× 快进中` with a running destination time so the acceleration is explicit;
5. is cancellable by pause, seeking, replay, Escape, or starting ordinary playback.

No hidden timeout invents transcript order. Seeking backwards always rebuilds the UI from the selected audio time.

### Summary generation replay

At the real end, the modal opens in a short generation-replay phase. It shows the concrete pipeline stages:

- complete Seed ASR transcript collected;
- P8 JD and production scoring prompt loaded;
- DeepSeek production result replayed;
- evidence citations and final recommendation rendered.

The captured generation duration is displayed as provenance, while the presentation transition is compressed to approximately three seconds. The report then streams into the modal in deterministic chunks before settling into the complete Markdown report.

### Complete report

The report retains the production prompt's five required sections, in order:

1. 综合结论与录用建议
2. 能力维度评分
3. 亮点
4. 风险与顾虑
5. 进一步考察建议

Copy copies the complete report. Regenerate replays the captured generation transition; it does not pretend to call a model from the offline file. Closing and reopening preserves the completed result. Seeking away from the end closes the modal and returns the replay to the chosen point.

## Five implementation layers

### Layer 1 — Complete evidence

Package the exact full MP3 and a minimal, checked-in Seed ASR evidence fixture. Derive timeline cues from all 48 final events and final voiceprint assignments. Replace every 84-second assumption with the 493-second source.

### Layer 2 — Controlled acceleration

Introduce a pure fast-forward state model and the visible `快进至总结` control. The media clock remains authoritative, the transport is interruptible, and all existing replay surfaces track it.

### Layer 3 — Authentic DeepSeek artifact

Add a reproducible generator that imports the production P8 profile and summary functions, submits the full role-resolved transcript, captures provider usage and timing, validates the required headings and citations, and writes a provenance-rich JSON fixture without credentials.

### Layer 4 — Production summary transition

Replace the hand-written static report with safe rendering of the captured Markdown, plus a faithful loading/streaming transition and pipeline/provenance panel inside the existing production modal.

### Layer 5 — Product polish and acceptance

Verify normal replay, 60× transport, transcript ordering, role assignment, context appearance, automatic question placement, generation transition, completed report, copy/regenerate/close, backward seeking, theme, responsive layout, single-file build, and Downloads artifact. Update implementation documentation and rebuild from a clean commit.

## Acceptance criteria

- The packaged audio hash matches the supplied full MP3.
- The source fixture contains 48 finals, three voiceprints, and a 493,517 ms duration.
- Candidate/interviewer labels are voiceprint-level assignments, not per-utterance guesses.
- The transcript clock never decreases during normal or fast-forward playback.
- Fast-forward reaches the exact end in no more than ten presentation seconds and never emits normal-speed audio.
- The summary fixture proves it used `deepseek-v4-pro` unless the captured production run explicitly records a model rejection and fallback.
- The report contains all five required production sections and evidence citations.
- The modal never shows the old 84-second “证据不足” placeholder.
- The final single HTML opens offline and contains the complete audio, transcript, report, and provenance.

