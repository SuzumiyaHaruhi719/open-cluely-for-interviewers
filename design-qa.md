# One-shot interviewer workspace — design QA

## Scope

- References: generated GLP live-interview workspace at 1280 × 720 plus the user's supplied audio-dock screenshot.
- Implementation: `web-app/web/src/desktop/Shell.tsx` and `desktop-ui/one-shot-interview.css`.
- Browser: ChatGPT in-app browser, local production build at `http://127.0.0.1:8788/`.

## Core flow verification

- Preparation opens with résumé upload, a fuzzy-searchable built-in JD picker, a compact Online/Offline capture selector, connection truth, and the start action.
- The preserved Property Manager profile is selected by default and supplies the full JD plus evidence scorecard; free-text JD appears only after choosing “自定义职位”.
- A valid JD enables the start action and enters the live workspace without exposing models, providers, prompts, history, question bank, pipeline controls, or mobile actions.
- Online live workspace keeps clear, automatic session context, independent Summary and End actions, two audio sources, microphone device selection, recording timer, and interview notes. Offline keeps the same workspace but renders one room-microphone source only.
- End opens a GLP confirmation while the interview remains live. Neutral-gray Cancel has initial focus; Enter, Escape, and scrim cancellation preserve the session and restore focus to End. Only red Confirm stops capture and returns to preparation.
- The session-context control opens a focused drawer, closes by its button or Escape, and restores focus to the trigger.
- Notes appear in the timestamped transcript and are sent into server context.
- Automatic follow-ups remain evidence-anchored inside the transcript instead of occupying a permanent panel.

## Visual comparison

- Compared the user's supplied audio-dock crop and the matching 1280 × 720 production dock crop together in one visual review.
- Header, reading column, timestamp gutter, inline follow-up placement, and bottom audio dock retain the reference hierarchy.
- Product-required clear and automatic-context controls were added without restoring the old navigation rail.
- GLP green, amber, blue, neutral surfaces, radii, typography, and Phosphor iconography are retained; the redesign adds no gradients or blurred workspace mask.

## Issues found and resolved

- P2: the empty transcript showed an orphan vertical timeline rail. Fixed by hiding the rail until a real timeline item exists.
- P2: transcript, follow-up, summary, and empty-context surfaces used text glyphs or handcrafted SVGs. Replaced with direct Phosphor icon imports.
- P2: the automatic-context empty card was visually heavier than the drawer. Flattened it to the GLP page surface with a subtle border and no nested shadow.
- P1: long automatic context had no reliable contained scroll viewport. The drawer body now has `min-height: 0`, vertical scrolling, contained overscroll, stable scrollbar gutter, touch panning, and keyboard focus.
- P1: restoring Online/Offline as a separate preparation row pushed Start below the first 720 px viewport. Moved the compact selector into the action footer and tightened only vertical setup spacing; the entire `760 × 673.88 px` panel now fits from y=`23.06` to y=`696.94` with page scroll height exactly `720 px`.
- P1: End immediately destroyed the live session with no recovery point. Added a centered, non-blurred GLP dialog with explicit gray Cancel and red Confirm; capture and transcript remain mounted until Confirm.
- P2: the reference audio dock mixed a static display field and a device select with different DOM/CSS structures. Both now share one source-field container, equal `278.32 × 29 px` Online geometry, equal `48 × 29 px` actions, and CSS-owned permission affordance styling.
- P2: the simplified shell had lost interview-format routing. Online now defaults to display + microphone; Offline conditionally omits display audio, labels the remaining lane `现场面试 · 麦克风`, and enables the transcript's shared-mic speaker view.
- P2: the supplied Property Manager JD had disappeared behind a blank textarea. It is restored as the default searchable profile, with custom input disclosed only on explicit selection.
- Performance: barrel icon imports transformed more than 4,600 modules. Direct icon imports reduce the production build to roughly 100 transformed modules.

## Evidence

- Focused mode/dock/dialog/Shell suite: 23 tests passed, including explicit RED → GREEN checks.
- Full repository suite: 476 tests passed (6 core, 18 question bank, 232 server, 220 web).
- Production TypeScript/Vite and server bundle builds passed; Vite transformed 111 modules.
- In-app-browser QA verified default Online selection, Online two-lane routing, Offline single-mic routing, Cancel-first focus, Enter/Escape cancellation, red Confirm return to preparation, setup first-viewport fit, and exact field/action geometry.
- Browser runtime log was empty: no warnings or errors.

final result: passed
