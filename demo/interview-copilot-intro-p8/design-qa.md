# Literal P8 product-frame design QA

## Target and viewport

- Outer presentation source: `/Users/thomasli/Downloads/interviewer-copilot-intro.html`
- Product source: `web-app/web/src/desktop/` plus the production CSS import order in `web-app/web/src/main.tsx`
- QA viewport: `1280 × 720`
- Slide: `#4` (`P8 真实演示`)
- Browser: the user's in-app browser

## Reference captures

- `qa/literal-reference-slide4-before.png` — original legacy Slide 4 geometry
- `qa/real-product-p8-base-reference.png` — production P8 workspace
- `qa/real-product-context-drawer-reference.png` — production context drawer
- `qa/real-product-summary-modal-reference.png` — production summary modal

## Implemented captures

- `qa/literal-product-base-after.png` — offline product frame before playback
- `qa/literal-question-after.png` — complete inline Expert question at `35s`
- `qa/literal-context-after.png` — automatic context drawer inside `[42s, 47s)`
- `qa/literal-summary-after.png` — automatic evidence-limited summary at completion
- `qa/literal-progress-after.png` — persistent full-width replay timeline at the matched `1280 × 720` viewport

## State checks

| State | Result | Evidence |
| --- | --- | --- |
| Product geometry | Passed | Header, workspace, transcript stage, context rail, and bottom dock use production DOM/classes/CSS. |
| Real recording | Passed | Candidate channel plays the embedded 84-second M4A and captions grow from provider reveal checkpoints. |
| Candidate confirmation | Passed | By `5s`, the candidate voiceprint is assigned and manual/automatic question monitoring is enabled. |
| Expert question | Passed | Primary question, anchor quote, `为什么这样问`, `预期证据`, `3.7 s`, `3,026 词元`, and version are simultaneously visible. |
| Context timing | Passed | Pure-state boundary tests prove `[42000, 47000)`; browser captures show the drawer open at `44s` and closed after seeking beyond `47s`. |
| Summary | Passed | Seeking near the end and allowing natural playback completion opens the production summary modal with demonstrated signals, risks, and next evidence. |
| Interaction | Passed | The visible timeline was clicked to `00:50 / 01:24`; its fill moved to `60.18%`, the transcript reconstructed six ordered rows, and the Expert question remained anchored. Start/pause, reset, manual question, context toggle, summary, theme, end interview, notes, close, copy, and regenerate controls are also wired. |
| Console | Passed | Browser diagnostic log: `[]`. |

## Issues found and fixed during visual QA

1. **Product header stretched into the transcript.** The accessibility-only replay disclosure was a normal first child of the CSS grid because the frame lacked the shared `.sr-only` utility. It consumed the first grid row and displaced every production region. The utility is now defined locally with the same off-screen invariant, restoring the exact 64px header row.
2. **The most important part of the Expert question was initially above the viewport.** Bottom-follow scrolling aligned the end of the tall question card. On first reveal, the transcript now positions the card by its exact `offsetTop`, so the primary question, reason, and expected evidence are visible together.
3. **Backward seeking after completion restarted from zero.** `HTMLMediaElement.ended` can remain true briefly after a seek. Playback reset now depends on the authoritative replay time reaching the logical duration, so a backward seek resumes from the selected position.
4. **The replay progress control disappeared inside the presentation.** Production CSS intentionally hides `.interview-dock__recording` below `1180px`, but the embedded product frame is often narrower. The demo now keeps a full-width GLP timeline above the dock controls at every width, reserves the required dock padding, renders elapsed/total time and played fill, and preserves drag-to-seek behavior.

## Visual comparison conclusion

The frame reuses the production design system instead of approximating it. Differences from the base reference are intentional product data: the offline fixture names the P8 recording, adds a persistent full-width timeline/replay control for the presentation, populates session context, and populates the evidence-limited summary. No actionable P0, P1, or P2 visual differences remain.

final result: passed
