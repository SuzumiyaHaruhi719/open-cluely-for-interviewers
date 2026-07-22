# Literal P8 product-frame design QA

## Target

- Outer visual source: `/Users/thomasli/Downloads/interviewer-copilot-intro.html`
- Product source: production desktop DOM/CSS under `web-app/web/src/desktop/`
- Acceptance surface: Slide 4, `P8 真实演示`
- Browser: the user's in-app browser
- Presentation shell: the existing GLP-dark status bar, grid, cards, progress line, and square slide controls

## Current state checks

| State | Result | Evidence |
| --- | --- | --- |
| Product geometry | Passed | The full production-shaped header, transcript workspace, context rail, summary, and dock render inside Slide 4. |
| Complete recording | Passed | Exact `08:13.517` MP3, 48 Seed ASR finals, three voiceprints, and byte-identity tests. |
| Progressive transcript | Passed | Every final exposes monotonic provider-like target batches of 2–5 graphemes; punctuation pauses and same-voiceprint turn reconstruction preserve the 48-final chronological order without metronomic typing. |
| Stable live rendering | Passed | `输入中…` applies the Copilot's 20ms grapheme/shared-prefix smoother inside each provider target, exposes the final target before cue finalization, and patches a persistent visual span instead of recreating the transcript row. |
| 60× transport | Passed | Visible `快进至总结` changes to `60× 快进中`, mutes playback, advances the progress clock, and reaches `08:13` in `8.226s`. |
| Complete summary | Passed | End state opens the production modal and renders all five production scoring sections. |
| Production provenance | Passed | `deepseek-v4-pro`, `2,600 词元输入`, `1,119 词元输出`, transcript length, prompt hash, and captured `29.4s` runtime are visible. |
| Summary transition | Passed | `重新生成` visibly replays evidence validation → P8 scoring → DeepSeek scoring → complete report in `3.2s`. |
| Offline artifact | Passed | The `7.2MB` single HTML embeds audio, transcript, product frame, report, CSS, scripts, and icons with no remote runtime dependency. |

## Five real iterations

1. **The old demo judged only an 84-second excerpt.** It could not honestly claim a complete interview summary. The exact 493-second MP3, all 48 final Seed events, and stable voiceprint roles now drive the full replay.
2. **A full eight-minute replay was too slow for a presentation.** A visible, muted, interruptible `60×` transport now compresses the remaining interview into at most ten seconds without inventing a second timeline.
3. **The old report was hand-written and evidence-limited.** The production P8 profile, production summary prompt, full role-resolved transcript, and `deepseek-v4-pro` were run once through the real service path; the untouched result and usage metadata are checked in with hashes.
4. **Jumping directly to a finished report hid how it was produced.** The modal now replays evidence validation, P8 scoring, DeepSeek scoring, safe progressive Markdown rendering, and complete provenance before enabling copy/regenerate.
5. **Embedding the complete product document as an iframe data URL rendered a blank product surface.** The full audio pushed the URL beyond the browser's practical navigation limit. The product payload now loads through `iframe.srcdoc`; a regression test rejects oversized data-URL iframe transport. In-app-browser acceptance then found the fast-forward control, displayed the moving `60×` state, opened the summary, and found every required report heading.

## Visual acceptance

The active product view uses the selected GLP-dark system and the same production component hierarchy. Fast-forward is a compact dock action rather than an overlay; the summary uses the existing production modal; its backdrop remains transparent rather than blurred. The completed report is scrollable within the modal and the underlying transcript stays in context. The theme control uses the production `glp-theme-toggle` class and switches between dark and light mode without native-button chrome.

At the reported `884 × 863` browser viewport, Slide 7 renders as a `2 × 3` matrix: all six cards fit between `309–620px`, the title remains visible, and navigation stays clear of the content. The closing slides use direct product language instead of slogan-like or self-congratulatory claims.

No actionable P0, P1, or P2 visual defect remains.

## Live-caption regression correction

At `00:25`, the candidate lane displayed `输入中…` but stayed on `家`; the preceding candidate segment appeared all at once. The complete timeline had only start/end reveal checkpoints, and one final arriving 1 ms after the preceding batch received a 1 ms window. The allocator now first reconstructs contiguous same-voiceprint turns, redistributes their existing provider-final window by grapheme weight, then emits punctuation-aware provider targets. Browser verification sampled the same candidate row at `00:23`, `+1s`, and `+2s`: its visible length grew `4 → 16 → 26`; a second candidate segment grew `16 → 28` over the next measured second. The regression is locked in `full-timeline.test.mjs`.

The first character-by-character implementation then flashed because every grapheme changed the timeline signature, assigned a fresh `chat.innerHTML`, and restarted the production row-entry animation. The runtime now separates structural reconciliation from live text updates and mirrors `TranscriptStream.ProgressiveLiveText`: one initial grapheme, a 20ms tick, shared-prefix rollback for corrected hypotheses, a stable visual span, and one polite assistive target. In the rebuilt browser artifact, the candidate row remained the identical connected DOM node across a 900ms sample while its visible text grew from 17 to 25 characters (`sameNode: true`, `oldNodeStillConnected: true`).

The next regression was perceptual rather than structural: one target per grapheme produced a perfectly uniform typewriter cadence. `caption-rhythm.mjs` now generates deterministic 2–5-character target batches with varied provider-like gaps and longer clause/sentence pauses; the existing 20ms visual smoother consumes each target without replacing the row. The representative self-introduction schedule has gaps of `142–596ms`, gap variation `CV 0.39`, and bursts of `2–5` characters.

Review then found two completion-edge defects: punctuation could create a one-character target, and the final target landed exactly on `cue.endMs`, where the row became non-live before its smoother could drain. The burst allocator now rebalances every multi-grapheme cue to `2–5` characters and places the complete target at least `(final burst + 1) × 20ms` before finalization. The rebuilt browser replay displayed the complete target and complete visual text before the row finalized; tests enforce both contracts across all 48 cues. The complete suite passes 50/50.

final result: passed
