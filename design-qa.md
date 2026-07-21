# One-shot interviewer workspace — design QA

## Scope

- Reference: generated GLP live-interview workspace at 1280 × 720.
- Implementation: `web-app/web/src/desktop/Shell.tsx` and `desktop-ui/one-shot-interview.css`.
- Browser: ChatGPT in-app browser, local production build at `http://127.0.0.1:8788/`.

## Core flow verification

- Preparation opens with only résumé upload, a fuzzy-searchable built-in JD picker, connection truth, and the start action.
- The preserved Property Manager profile is selected by default and supplies the full JD plus evidence scorecard; free-text JD appears only after choosing “自定义职位”.
- A valid JD enables the start action and enters the live workspace without exposing models, providers, prompts, history, question bank, pipeline controls, or mobile actions.
- Live workspace keeps clear, automatic session context, independent Summary and End actions, two audio sources, microphone device selection, recording timer, and interview notes.
- The session-context control opens a focused drawer, closes by its button or Escape, and restores focus to the trigger.
- Notes appear in the timestamped transcript and are sent into server context.
- Automatic follow-ups remain evidence-anchored inside the transcript instead of occupying a permanent panel.

## Visual comparison

- Compared the reference and the 1280 × 720 production implementation together in one visual review.
- Header, reading column, timestamp gutter, inline follow-up placement, and bottom audio dock retain the reference hierarchy.
- Product-required clear and automatic-context controls were added without restoring the old navigation rail.
- GLP green, amber, blue, neutral surfaces, radii, typography, and Phosphor iconography are retained; the redesign adds no gradients or blurred workspace mask.

## Issues found and resolved

- P1: the setup CTA fell below the initial 720 px viewport. Fixed by compacting preparation spacing and giving the JD field a bounded height; the complete panel now fits from y=42 to y=678.
- P2: the empty transcript showed an orphan vertical timeline rail. Fixed by hiding the rail until a real timeline item exists.
- P2: transcript, follow-up, summary, and empty-context surfaces used text glyphs or handcrafted SVGs. Replaced with direct Phosphor icon imports.
- P2: the automatic-context empty card was visually heavier than the drawer. Flattened it to the GLP page surface with a subtle border and no nested shadow.
- P1: long automatic context had no reliable contained scroll viewport. The drawer body now has `min-height: 0`, vertical scrolling, contained overscroll, stable scrollbar gutter, touch panning, and keyboard focus.
- P1: End implicitly opened the summary and later left the interviewer in a dead ended workspace. End now stops both capture lanes and returns directly to preparation; the adjacent Summary action independently opens/generates the report before End.
- P2: computer and microphone source controls used different geometry and action order. Both now use the same field-first row with equal measured `282.32 × 29 px` source fields at 1280 × 720.
- P2: the supplied Property Manager JD had disappeared behind a blank textarea. It is restored as the default searchable profile, with custom input disclosed only on explicit selection.
- Performance: barrel icon imports transformed more than 4,600 modules. Direct icon imports reduce the production build to roughly 100 transformed modules.

## Evidence

- Focused JD/header/dock/context/Shell suite: 28 tests passed.
- Full repository suite: 471 tests passed (6 core, 18 question bank, 232 server, 215 web).
- Production TypeScript/Vite and server bundle builds passed; Vite transformed 108 modules.
- In-app-browser QA verified fuzzy search, custom-only textarea, default Property Manager start, independent Summary behavior, End-to-preparation navigation, exact audio-field geometry, and the context scroll contract.
- Browser runtime log contained only expected summary telemetry; no warnings or errors.

final result: passed
