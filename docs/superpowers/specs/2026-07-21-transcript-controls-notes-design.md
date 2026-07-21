# Transcript Controls and Notes Design

## Purpose

Make the live interview timeline operable during long recordings: the interviewer can manually request one Expert follow-up, scroll through transcripts without being forced back to the bottom, and see notes at their actual interview time in both the transcript and Session Context.

## Confirmed root causes

- `.interview-stage` expands to the transcript content height while `.interview-workspace` clips it. Consequently `#chat-messages` has `scrollHeight === clientHeight` even when its content exceeds the visible workspace.
- `useCopilotSocket().analyze()` and the server's single-call Expert handler still work, but `Shell` no longer exposes the action through `InterviewHeader`.
- `TranscriptStream` renders all `transcriptMessages` before all `speakerSegments`; `createdAtMs` affects only the printed timestamp, not event placement.
- `SessionContextDrawer` receives only `SessionContextState`, so locally entered notes have no direct context representation.

## Design

### Manual Expert follow-up

`InterviewHeader` always displays a `手动追问` action. It is enabled only after the socket is connected and confirmed candidate transcript exists. `Shell` builds a bounded candidate-only transcript from role-resolved speaker segments, falls back to the candidate display lane for non-diarizing providers, and calls the existing `analyze(candidateAnswer, questionHistory)` API. An in-flight guard prevents overlap with Auto while the button remains stable and focusable.

### Transcript viewport

The workspace becomes a one-row `minmax(0, 1fr)` grid and the stage is constrained to the available height. `#chat-messages` remains the only scrolling surface, gains a stable visible scrollbar, keyboard focus, contained overscroll, and vertical touch/trackpad behavior. Auto-follow runs only while the user is near the bottom; scrolling upward suspends it, and returning near the bottom resumes it.

### Chronological notes

When speaker segments are present, `TranscriptStream` builds one stable timeline containing seeded/manual messages and ASR segments. Items with timestamps sort ascending; ties preserve source order; legacy seeded entries without timestamps stay before live content. Anchored AI questions remain immediately after their evidence segment.

### Notes in Session Context

`Shell` passes its timestamped note messages to `SessionContextDrawer`. `SessionContextPanel` renders a `面试备注` section in ascending time order using the same elapsed-interview formatter as the transcript. Notes render even before the first AI context analysis and remain separate from model-inferred competencies, topics, and gaps.

## Error handling and invariants

- Manual analysis never runs with an empty candidate transcript or while another generation is active.
- Notes with missing timestamps remain stable and do not reorder live ASR evidence unpredictably.
- Scrolling changes presentation only; it never changes transcript, role, or question state.
- Clearing or ending an interview continues to clear the local note collection through the existing transcript-message reset.

## Verification

- Component tests cover manual button visibility and dispatch, note chronology, context-note chronology, and scroll-follow suspension.
- CSS contract tests cover the constrained workspace, stable scrollbar, overscroll, and keyboard/touch scrolling.
- Full frontend/server tests, production build, browser measurement (`scrollHeight > clientHeight`), and an MP3 replay validate the integrated behavior.
