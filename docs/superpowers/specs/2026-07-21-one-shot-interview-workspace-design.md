# One-shot interview workspace redesign

**Status:** Approved for implementation
**Visual target:** `exec-a9848a53-d77e-48a3-9e7e-de7139146d43.png` — Live Transcript Minimal
**Scope:** `web-app/web/`; existing server, ASR, speaker-role, auto-question, and summary contracts remain intact

## Purpose

Turn the web client into a single-purpose interviewer workspace: provide a resume and JD, start the interview, read the live transcript, receive evidence-anchored automatic follow-ups, and end with a summary. The UI must stay recognizably GLP while removing navigation and configuration surfaces that do not help the active interview.

## Product decisions

- The app opens on a compact preparation screen rather than an already-running dashboard.
- Preparation asks only for a resume and JD. Resume is optional; a non-empty JD is required.
- The JD and extracted resume are sent as context fields to the fixed Expert model. They never create a second prompt system.
- The live screen has one primary reading surface: the role-separated transcript timeline.
- Keep the automatic session context because it is a core model signal. It becomes a single-purpose, collapsible drawer and is the only retained sidebar-like surface.
- Keep microphone/computer-audio capture, device selection, level/state feedback, manual notes, role correction, automatic follow-ups, visible token/latency metadata, and end-of-interview summary.
- Remove the left navigation, interview history, Question Bank, Settings UI, mobile entry, model/provider/language controls, manual Generate-Q action, right-side JD/resume editor, Tour entry, and pipeline-related product surfaces from the active shell.
- Product policy remains fixed: Doubao Seed ASR 2.0, Chinese output, automatic follow-up enabled, and DeepSeek v4 Flash Expert generation.
- Use the existing GLP palette and tokens: green brand, amber interviewer, blue candidate, bright neutral surfaces, restrained borders, small radii, minimal shadow.
- Use a coherent production icon library for visible controls. Do not render emoji, text-symbol icons, inline handcrafted SVGs, CSS art, or gradients in the new shell.

## Information architecture

### Preparation state

The initial state is a centered, calm preparation surface with:

1. GLP wordmark and one-line product description.
2. Resume dropzone with parsed-file confirmation and removal.
3. JD textarea with a clear label, character count, and factual-context helper copy.
4. One primary `开始面试` action. It is disabled only while the socket is unavailable, resume parsing is in flight, or the JD is blank.

There is no interview-format selector, model selector, settings link, history, sample interview, question bank, or prompt builder.

### Live state

The live workspace follows the selected visual target:

- A 64px header with the GLP wordmark, inferred interview title, live indicator, elapsed timer, context-loaded status, a visible `清空转写` action, the session-context toggle, and outlined `结束面试`.
- A centered transcript timeline with a timestamp gutter and a faint vertical guide.
- Interviewer turns use amber; candidate turns use blue; unresolved turns are explicitly labelled `待确认`.
- Provider partials appear immediately and reveal one grapheme at a time.
- Automatic AI follow-ups are inserted directly beneath the transcript evidence that triggered them. They do not remain in a detached permanent panel.
- A thin bottom dock keeps the two audio lanes, capture state, meters, microphone device selection, elapsed recording state, and one compact note input.

### Automatic session-context drawer

The header exposes a `会话上下文` toggle with an accessible expanded state. Opening it reveals a right-side drawer containing the existing `SessionContextPanel` data:

- competency coverage;
- already-probed topics;
- remaining evidence gaps.

The drawer is non-modal on wide screens and overlayed on smaller screens. It can be closed with its close control or Escape, restores focus to the toggle, and never discards the live transcript. It starts collapsed so it does not steal the primary interview surface, but its toggle remains visible at all times.

## Interaction behavior

### Start

1. User enters JD and optionally uploads a resume.
2. `开始面试` resets stale local/server generation state.
3. The full fixed config is pushed with `jobDescription`, `resumeText`, `diarize:true`, `autoGenerate:true`, `autoMode:'agent'`, `mode:'expert'`, `interviewerModel:'deepseek-v4-flash'`, `outputLanguage:'zh'`, and `asrProvider:'volc'`.
4. The app enters the live workspace. Audio controls remain explicit because browser display/microphone permission and source choice cannot be truthfully hidden.

### Transcript and timestamps

- Each finalized speaker turn records a client arrival timestamp.
- Visible elapsed timestamps are calculated relative to the first capture start; before capture they render from zero.
- Coalescing same-speaker finals retains the timestamp of the first final in that turn.
- A final server speaker partition preserves timestamps for existing segment sequence IDs and assigns current time only to genuinely new segments.
- Seeded/manual notes and AI question events also carry an arrival timestamp so the timeline remains stable.

### End

`结束面试` stops both capture lanes, requests the existing summary from the accumulated transcript plus JD/resume context, and opens the summary modal. It does not delete the visible transcript.

## Responsive behavior

- At 1180px and above, the transcript maxes out near 1040px and the context drawer can sit beside it.
- From 760–1179px, the drawer overlays the right edge and the bottom dock wraps without hiding primary actions.
- Below 760px, the timestamp gutter narrows, audio lanes stack, and header metadata condenses; no dedicated mobile-product button or route is introduced.
- The main transcript remains scrollable while the header and dock stay fixed inside the viewport.

## Accessibility and motion

- Every control uses a semantic button/input with a visible focus ring.
- Role is communicated by text and color, never color alone.
- The transcript keeps `role="log"`; live partial assistive text is atomic to avoid announcing every grapheme.
- Drawer state uses `aria-controls` and `aria-expanded`.
- Entrance/reveal motion is limited to opacity/transform and respects `prefers-reduced-motion`.
- Text remains readable at 200% zoom; controls do not overlap at supported widths.

## Removal boundaries

- `Sidebar`, `QuestionBank`, `SettingsModal`, `RightRail`, `Topbar`, `TitleBar`, `InterviewTypeModal`, and `SpotlightTour` may remain as unreferenced compatibility modules during this change, but the new `Shell` must not render or import them.
- No backend route or protocol is removed in this UI-focused change.
- `useAppSettings` remains an internal persistence owner for the microphone device and summary model; it is not rendered as Settings.
- Existing manual speaker-role correction remains available on unresolved or mislabelled turns.

## Acceptance criteria

1. Initial render contains resume upload, JD input, and one start action; it contains no sidebar, history, Question Bank, Settings, mobile action, model/language choice, pipeline editor, or manual AI-generation button.
2. Starting sends the supplied JD/resume through the existing session config and shows the live workspace.
3. Live workspace shows header, elapsed timer, transcript, visible role labels, timestamps, bottom audio dock, note input, context toggle, clear action, and end action.
4. Session-context drawer renders server-provided competency/topic/gap state and can be opened/closed without altering the transcript.
5. Provider partials still reveal progressively; final transcript segments remain editable by role.
6. Automatic questions remain evidence-anchored inside the timeline and keep non-zero token/latency metadata when supplied.
7. Ending stops both capture lanes and opens the existing summary flow.
8. Focused tests, full web tests, full repository tests, production build, and in-app-browser interaction checks pass.
9. `design-qa.md` compares the selected reference and implementation, resolves all P0/P1/P2 findings, and ends with `final result: passed`.
