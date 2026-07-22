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
