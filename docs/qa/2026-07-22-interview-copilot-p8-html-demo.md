# Interview Copilot P8 HTML demo — five-round acceptance journal

## Test identity

- Source fixture: `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`
- Source SHA-256: `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`
- Replay excerpt: `348.011s–448.420s` (`100.409s` contract; decoded MP3 `100.44s`)
- Artifact: `demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html`
- Initial artifact SHA-256: `f695d4557812b81a3733c2bc5debfeeec88f0a2aaec7ac91432f708225514c97`
- Initial build commit: `def8da0`
- Browser: Codex in-app browser, exact built artifact served byte-for-byte from `127.0.0.1:8012` because automated `file://` navigation is blocked by browser policy
- Primary acceptance viewport: `1280×720`; additional viewports are recorded in later rounds

## Round 1 — complete introduction and presentation flow

- Reproduction: opened the built artifact at `1280×720`; navigated Cover → Problem → Product answer → P8 proof → Grounding → Interviewer value → GLP value → Current capabilities → Close using only the keyboard.
- Baseline evidence: all nine required sections appeared in order and the geometry audit reported no slide-child overflow.
- First viewer-facing defect: on Slide 4, the persistent bottom-right deck navigation covered the replay footer's `重新播放` / `打开真实产品` area. The presentation itself obstructed its core proof controls.
- Viewer impact: a presenter could accidentally change slides when intending to operate the demo, and the audience could not clearly see the complete product footer.
- First divergent boundary: Slide 4 at `1280×720`, before audio starts.
- Red gate: `deck.test.mjs` requires the deck controller to expose the active slide and a Slide-4-specific navigation placement. It failed before implementation.
- Fix: the deck controller now publishes `body[data-active-slide]`; Slide 4 moves deck navigation to the lower-left, outside the product viewport, while every other slide keeps the legacy lower-right placement.
- Green evidence: focused deck tests pass. Browser geometry after rebuild: deck navigation `left=26, right=246`; replay footer `left=371, right=1249`; `overlapsFooter=false` at `1280×720`.
- Screenshot evidence: browser capture at Slide 4 before playback showed the two deck circles overlapping the product footer's right edge.
- Remaining risk: later rounds still need visual comparison, full audio/seek calibration, candidate-first semantics, and offline readiness.

## Round 2 — current-product visual fidelity

- Reproduction: aligned the live app and Slide 4 to `1280×720`, then compared workspace width, header hierarchy, role colors, question placement, footer metrics, scroll affordance, and theme control.
- First viewer-facing defect: the reconstructed workspace was only `880px` wide (`68.8%` of the slide), while the current product's transcript surface used the full `1280px`. The side headline made the proof look like a small mockup instead of the product the interviewer actually uses.
- Viewer impact: transcript density, progressive captions, role labels, and the inline question would all appear materially smaller than in the current app during a boss demo.
- First divergent boundary: Slide 4 base layout at `1280×720`.
- Red gate: `deck.test.mjs` required a one-column demo layout and a compact three-part introduction row; the focused test failed against the old two-column grid.
- Fix: converted Slide 4 into a compact slide-introduction row above a full-width product viewport. The deck controls move to the header row and the redundant disclosure copy is removed there; the product header still visibly states `真实产品数据回放`.
- Green evidence: product width is now `1220px` (`95.3%` of the viewport, within `4.7%` of the live full-width surface). Browser geometry also reports no overlap between deck controls and replay footer.
- Screenshot evidence: equal `1280×720` captures show the reconstructed workspace now occupying the same dominant visual role as the live app.
- Remaining risk: audio timing, state reconstruction, semantics, and offline behavior remain for Rounds 3–5.
