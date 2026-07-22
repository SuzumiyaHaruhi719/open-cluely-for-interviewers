# Literal P8 Product-Page Clone Inside the Legacy Deck

## Purpose

Replace the simplified replay drawing with a literal, interactive copy of the real Interviewer Copilot interview workspace while preserving the legacy GLP presentation shell and the verified 84-second P8 recording.

## Approved visual targets

- Legacy presentation structure and Slide 4 geometry: `/Users/thomasli/Downloads/interviewer-copilot-intro.html`.
- Real product markup and appearance: the current P8 interview workspace rendered from `web-app/web/src/desktop/` at `1280 x 720` in dark mode.
- Real product components used as implementation truth:
  - `InterviewHeader.tsx`
  - `TranscriptStream.tsx`
  - `QuestionCard.tsx`
  - `SessionContextDrawer.tsx`
  - `SessionContextPanel.tsx`
  - `SummaryModal.tsx`
  - the production `desktop-ui` styles imported by `web-app/web/src/main.tsx`

The product viewport must not be a presentation approximation. It must reuse the production class names, production CSS, Phosphor icon assets, and product DOM hierarchy.

## Root cause

The existing deck copied the legacy color tokens and card vocabulary but replaced the real product iframe with a custom `.replay-app` surface. That surface omitted the production header actions, audio dock, transcript message hierarchy, full question explanation, context drawer, and summary modal. It therefore looked like a diagram of the product instead of the product.

## Architecture

1. Keep the legacy deck chrome, full-viewport slide model, progress bar, status strip, reveal animation, and Slide 4 `live-demo-shell`/`live-demo-frame` geometry.
2. Build a self-contained product-frame HTML document and embed it in the deck as an offline `data:text/html;base64` iframe.
3. During the build, concatenate the same production CSS files used by the React application, stripping only the remote font import so the final artifact remains offline.
4. Render the product frame with the real `.one-shot-app`, `.interview-header`, `.interview-workspace`, `.chat-messages`, `.context-drawer`, `.interview-dock`, `.chat-message`, `.is-question-card`, and `.summary-modal` structures.
5. Keep `audio.currentTime` as the authoritative replay clock. The iframe runtime derives all visible state from that time so play, pause, seek, reset, and backward reconstruction remain deterministic.
6. The outer deck pauses the product frame with `postMessage` when the presenter leaves a live-demo slide.

## Replay behavior

- The existing exact 84.000-second M4A and Seed ASR 2.0 caption checkpoints remain unchanged.
- Clicking the real candidate computer-audio channel's start button begins the replay. Its label and both channel states update like a live interview.
- Candidate/interviewer turns render with the production transcript DOM and role-toggle chrome.
- Candidate confirmation continues to unlock Auto without interviewer confirmation.
- The verified Expert question enters the transcript at `33.731 s`, directly below its candidate evidence.
- The question card must include:
  - the primary question;
  - its anchor quote;
  - `为什么这样问` with the concrete evidence gap;
  - `预期证据` with the decision-quality evidence expected;
  - automatic/expert labels, `3.7 s`, and `3,026 词元`.

## Automatic context and summary states

- The real session-context drawer opens automatically at `42.000 s`.
- It remains open for exactly five seconds and closes at `47.000 s`.
- Its content uses the production context panel sections: ability dimensions, asked topics, and open gaps.
- The user can still open or close the drawer manually from the real header button.
- When the audio reaches its natural end, the real summary modal opens automatically.
- The summary is evidence-limited: it evaluates only this P8 excerpt, reports demonstrated signals, unresolved risks, and recommended next evidence. It must not invent a final hiring decision.
- Manual `面试总结`, close, copy, replay, clear, and end-interview controls remain functional in the offline demo.

## Fidelity and asset rules

- Production Phosphor SVG output is reused as library-generated icon markup; no handmade icon or CSS illustration substitutes are allowed.
- No iframe, stylesheet, font, script, image, or audio request may require the network.
- The product frame uses production dark-mode tokens and production responsive behavior.
- Demo-only code may add deterministic playback wiring and a compact seek affordance, but it may not replace or visually restyle the production workspace.

## Acceptance

- The deck's Slide 4 uses the legacy `live-demo-shell > iframe.live-demo-frame` composition at the same `1280 x 720` viewport.
- The embedded product frame contains the production component/class signatures listed above.
- Automated tests prove the question rationale and expected-evidence fields are present.
- Automated tests prove the context window is `[42000, 47000)`—exactly five seconds.
- Automated tests prove the summary opens at replay completion and disappears after seeking backward.
- Same-viewport browser captures of the real product and embedded product have no actionable P0/P1/P2 differences in header, workspace, transcript, context drawer, question card, dock, or summary modal.
- `design-qa.md` ends with `final result: passed` before handoff.
