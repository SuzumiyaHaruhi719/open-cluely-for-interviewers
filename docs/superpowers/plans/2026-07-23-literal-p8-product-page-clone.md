# Literal P8 Product-Page Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the schematic P8 replay in the offline presentation with a literal, interactive clone of the production Interview Copilot workspace, including full AI-question reasoning, a five-second automatic session-context reveal, and an automatic evidence-limited summary at replay completion.

**Architecture:** Preserve the legacy GLP slide shell and embed a self-contained product document in the original `live-demo-shell > iframe.live-demo-frame` geometry. The build copies the production desktop CSS and product DOM vocabulary into an offline data-URL frame; the exact 84-second recording remains the authoritative clock for transcript, question, context, and summary state.

**Tech Stack:** Semantic HTML, production desktop CSS, browser JavaScript, Node.js 20 test runner, esbuild from `web-app/node_modules`, Phosphor icon output, Browser same-viewport visual QA.

**Design:** `docs/superpowers/specs/2026-07-23-literal-p8-product-page-clone-design.md`

## Constraints

- Work on `main`; checkpoint and push focused commits.
- Keep the final HTML offline and portable: no CDN, remote font, localhost, model API, microphone, or BlackHole dependency.
- Reuse production class names, CSS, icon markup, and DOM hierarchy rather than redrawing the product.
- Keep the verified 84.000-second M4A and its existing caption timeline unchanged.
- Show the Expert question at `33.731 s`, including anchor quote, `为什么这样问`, `预期证据`, latency, model tier, and `3,026 词元`.
- Automatically show session context on `[42.000 s, 47.000 s)` and automatically show the summary at natural audio completion.
- Seeking backward reconstructs all state and dismisses the completion summary.
- Update `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/html-p8-introduction-demo.md` after the behavior lands.

---

### Task 1: Lock the literal product-frame contract with failing tests

**Files:**
- Modify: `demo/interview-copilot-intro-p8/test/deck.test.mjs`
- Modify: `demo/interview-copilot-intro-p8/test/timeline.test.mjs`
- Modify: `demo/interview-copilot-intro-p8/test/replay-state.test.mjs`
- Create: `demo/interview-copilot-intro-p8/test/product-frame.test.mjs`

- [ ] **Step 1: Require the legacy iframe composition**

Add assertions that Slide 4 contains `.live-demo-shell > iframe.live-demo-frame`, that the old `.replay-app`/`#product-replay` schematic is absent, and that the deck still exposes its counter, progress, status strip, and keyboard navigation hooks.

- [ ] **Step 2: Require production product structures**

Read `src/product-frame.template.html` and assert the presence of `.one-shot-app`, `.interview-header`, `.interview-workspace`, `.chat-messages`, `.context-drawer`, `.interview-dock`, `.is-question-card`, and `.summary-modal`. Assert the full question labels `为什么这样问` and `预期证据` and a complete evidence-limited summary structure.

- [ ] **Step 3: Require deterministic timed states**

Extend replay-state tests with boundary checks at `41,999`, `42,000`, `46,999`, and `47,000 ms`, and at `DEMO_DURATION_MS - 1` and `DEMO_DURATION_MS`. Require context to be open for exactly five seconds and summary to appear only at completion.

- [ ] **Step 4: Run the focused tests red**

Run:

```bash
node --test \
  demo/interview-copilot-intro-p8/test/deck.test.mjs \
  demo/interview-copilot-intro-p8/test/timeline.test.mjs \
  demo/interview-copilot-intro-p8/test/replay-state.test.mjs \
  demo/interview-copilot-intro-p8/test/product-frame.test.mjs
```

Expected: failures identify the missing product-frame document and missing context/summary state.

---

### Task 2: Build the self-contained production workspace frame

**Files:**
- Create: `demo/interview-copilot-intro-p8/src/product-frame.template.html`
- Create: `demo/interview-copilot-intro-p8/src/product-frame.css`
- Create: `demo/interview-copilot-intro-p8/src/product-frame.mjs`
- Modify: `demo/interview-copilot-intro-p8/src/timeline.mjs`
- Modify: `demo/interview-copilot-intro-p8/src/replay-state.mjs`

- [ ] **Step 1: Extend immutable question and summary data**

Add anchor quotes, rationale, expected evidence, and evidence-limited summary sections to `timeline.mjs`. Keep all content grounded in the 84-second excerpt; do not invent hiring evidence.

- [ ] **Step 2: Add pure replay state**

Expose `contextAutoOpen` for `[42000, 47000)` and `summaryVisible` at completion. Preserve deterministic reconstruction after reset and backward seek.

- [ ] **Step 3: Reproduce the production DOM literally**

Create a frame document with the same main hierarchy and visible controls as the real P8 product: GLP header, interview status/actions, transcript stage, inline QuestionCard, context drawer, two audio channels, notes field, and SummaryModal. Use Phosphor library-generated SVG output for all icons.

- [ ] **Step 4: Wire real product interactions**

Use the candidate computer-audio start control to play/pause the embedded audio. Wire clear, manual question, context toggle, summary, theme, end interview, close, copy, regenerate, reset, and seek behavior. Listen for the outer deck's `pause-product-frame` message.

- [ ] **Step 5: Run focused tests green**

Run the Task 1 command and require all tests to pass.

---

### Task 3: Replace the schematic Slide 4 with the real iframe

**Files:**
- Modify: `demo/interview-copilot-intro-p8/src/index.template.html`
- Modify: `demo/interview-copilot-intro-p8/src/styles.css`
- Modify: `demo/interview-copilot-intro-p8/src/entry.mjs`
- Modify: `demo/interview-copilot-intro-p8/src/deck.mjs`
- Modify: `demo/interview-copilot-intro-p8/scripts/build.mjs`
- Delete: `demo/interview-copilot-intro-p8/src/player.mjs`

- [ ] **Step 1: Restore the original live-demo geometry**

Replace the custom product replay element with the legacy `.live-demo-shell > iframe.live-demo-frame` composition. Preserve the deck's legacy visual system, progress line, counter, status, and slide navigation.

- [ ] **Step 2: Bundle production styles into the frame**

Concatenate the production desktop CSS files used by `web-app/web/src/main.tsx`, strip only remote `@import` font rules, append minimal demo-only CSS, and embed the result directly in the product frame.

- [ ] **Step 3: Build a data-URL iframe**

Bundle the frame runtime separately, inline the M4A and timeline data, base64-encode the complete product document, and inject it as `data:text/html;base64,...` so the final presentation remains one file.

- [ ] **Step 4: Pause hidden frames**

When the deck leaves the P8 demo slide, post `pause-product-frame` to the iframe. Preserve normal Arrow/Space/fullscreen behavior in the outer deck.

- [ ] **Step 5: Build and validate artifact structure**

Run:

```bash
node demo/interview-copilot-intro-p8/scripts/build.mjs
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
```

Expected: one portable HTML is produced and every test passes.

---

### Task 4: Same-viewport product and timed-state visual QA

**Files:**
- Create: `demo/interview-copilot-intro-p8/design-qa.md`
- Create: `demo/interview-copilot-intro-p8/qa/literal-product-base-after.png`
- Create: `demo/interview-copilot-intro-p8/qa/literal-question-after.png`
- Create: `demo/interview-copilot-intro-p8/qa/literal-context-after.png`
- Create: `demo/interview-copilot-intro-p8/qa/literal-summary-after.png`

- [ ] **Step 1: Serve the artifact locally for inspection**

Open the finished HTML through a loopback static server in a fixed `1280 x 720` browser tab and navigate to Slide 4.

- [ ] **Step 2: Compare the base product frame**

Capture the initial workspace and compare it against `qa/real-product-p8-base-reference.png`, checking header, transcript stage, dock, typography, spacing, icons, borders, and responsive geometry.

- [ ] **Step 3: Verify the full AI question**

Seek beyond `33.731 s` and capture the inline question card. Confirm the question appears under its evidence and contains anchor, rationale, expected evidence, `3.7 s`, and `3,026 词元`.

- [ ] **Step 4: Verify the exact context window**

Seek to `42.000 s`, capture the production context drawer, wait/seek through `47.000 s`, and prove it closes. Confirm a manual toggle still works.

- [ ] **Step 5: Verify completion summary**

Seek to the final second and allow natural completion. Capture the production summary modal and confirm it contains demonstrated signals, unresolved risks, and next evidence. Seek backward and prove it dismisses.

- [ ] **Step 6: Record QA result**

Write `design-qa.md` with viewport, tested states, screenshots, differences, fixes, and the final line `final result: passed`. Any P0/P1/P2 issue must be fixed and recaptured before proceeding.

---

### Task 5: Document, rebuild, commit, and push

**Files:**
- Modify: `demo/interview-copilot-intro-p8/README.md`
- Modify: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/html-p8-introduction-demo.md`
- Rebuild: `demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html`
- Copy: `/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html`

- [ ] **Step 1: Update implementation documentation**

Document purpose, entry points, product-frame data flow, timing state, build inputs, configuration, and iframe/offline gotchas in the mandatory Obsidian note and demo README.

- [ ] **Step 2: Run final verification**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
node demo/interview-copilot-intro-p8/scripts/build.mjs
git diff --check
git status --short
```

Also verify the output contains no network URLs, keeps the exact 84.000-second fixture, and opens at `1280 x 720` without console errors.

- [ ] **Step 3: Copy the verified deliverable**

Replace the Downloads copy with the verified artifact and keep the browser preview open on Slide 4.

- [ ] **Step 4: Commit and push main**

Stage only the intended demo, tests, QA evidence, plan/spec, and implementation note changes. Commit with a focused message and push `main` to `origin`.

