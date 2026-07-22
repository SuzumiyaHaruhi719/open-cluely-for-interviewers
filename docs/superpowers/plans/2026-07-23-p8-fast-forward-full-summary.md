# P8 Complete Interview Fast-forward and Summary Replay Plan

> Execute in five test-driven layers. Each layer ends with targeted verification and its own commit before moving on.

## Layer 1: Complete transcript and audio

**Files:**
- Add `demo/interview-copilot-intro-p8/assets/p8-full-interview-493s.mp3`
- Add `demo/interview-copilot-intro-p8/fixtures/p8-full-seed-asr.json`
- Add `demo/interview-copilot-intro-p8/src/full-timeline.mjs`
- Add `demo/interview-copilot-intro-p8/test/full-timeline.test.mjs`
- Modify `demo/interview-copilot-intro-p8/scripts/build.mjs`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.mjs`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.template.html`
- Modify `demo/interview-copilot-intro-p8/test/audio-provenance.test.mjs`

1. Write failing tests for the exact source hash, 493,517 ms duration, 48 final transcript events, three voiceprints, stable voiceprint roles, and full audio embedding.
2. Add the minimal evidence fixture and derive complete cues from its final events.
3. Package the exact supplied MP3 and switch the build/runtime to the complete source.
4. Run timeline, provenance, build, and artifact tests.
5. Commit `feat: replay complete P8 interview evidence`.

## Layer 2: Visible 60× fast-forward

**Files:**
- Add `demo/interview-copilot-intro-p8/src/fast-forward.mjs`
- Add `demo/interview-copilot-intro-p8/test/fast-forward.test.mjs`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.template.html`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.mjs`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.css`
- Modify `demo/interview-copilot-intro-p8/test/product-frame.test.mjs`

1. Write failing pure-state tests for acceleration, exact end clamping, interruption, label state, and backward seeking.
2. Add the dock action and fast-forward presentation state using the audio clock as the only timeline authority.
3. Make pause, seek, reset, ordinary play, Escape, and end-of-audio cancel transport safely.
4. Run state, product-frame, accessibility, and build tests.
5. Commit `feat: add transparent P8 fast-forward`.

## Layer 3: Production DeepSeek summary fixture

**Files:**
- Add `demo/interview-copilot-intro-p8/scripts/generate-full-summary.mts`
- Add `demo/interview-copilot-intro-p8/fixtures/p8-full-summary.json`
- Add `demo/interview-copilot-intro-p8/test/full-summary-fixture.test.mjs`

1. Write failing tests for production model provenance, hashes, complete transcript metadata, usage, required headings, citations, and decisive recommendation.
2. Implement a generator that imports the built-in P8 JD and production summary pipeline, streams the real call, captures usage/timing, and writes only non-secret evidence.
3. Run the generator using the portable environment, then inspect and validate the captured report without hand-editing it.
4. Run summary fixture and production summary tests.
5. Commit `feat: capture production P8 DeepSeek summary`.

## Layer 4: Summary generation and full report UX

**Files:**
- Add `demo/interview-copilot-intro-p8/src/summary-replay.mjs`
- Add `demo/interview-copilot-intro-p8/test/summary-replay.test.mjs`
- Modify `demo/interview-copilot-intro-p8/scripts/build.mjs`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.template.html`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.mjs`
- Modify `demo/interview-copilot-intro-p8/src/product-frame.css`
- Modify `demo/interview-copilot-intro-p8/test/product-frame.test.mjs`

1. Write failing tests for safe Markdown rendering, five ordered sections, compressed replay stages, progressive report reveal, provenance, copy, replay-regenerate, and backward-seek dismissal.
2. Inject the captured JSON at build time and replace the static placeholder with a loading/progress/report state machine.
3. Render only escaped, allow-listed Markdown structures and expose the authentic run metadata.
4. Run summary, product-frame, artifact, and accessibility tests.
5. Commit `feat: replay full production interview summary`.

## Layer 5: End-to-end acceptance and handoff

**Files:**
- Modify `demo/interview-copilot-intro-p8/README.md`
- Modify `demo/interview-copilot-intro-p8/design-qa.md`
- Modify `docs/qa/2026-07-23-p8-fast-forward-summary.md`
- Modify `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/html-p8-introduction-demo.md`
- Rebuild `demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html`
- Copy `/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html`

1. Run the complete automated suite and inspect the generated artifact for unresolved tokens, remote dependencies, missing audio, and report completeness.
2. Open the Downloads artifact in the in-app browser and verify normal playback, fast-forward, transcript/context/question states, generation replay, completed summary, controls, theme, and backward seeking.
3. Capture screenshots of fast-forward, summary generation, and completed report; compare against the production GLP references and correct visible defects.
4. Record the five observed problems and fixes in the QA report and update implementation notes.
5. Rebuild from the final source, rerun the complete suite, commit `build: finalize complete P8 summary demo`, push `main`, and leave the verified artifact open.

