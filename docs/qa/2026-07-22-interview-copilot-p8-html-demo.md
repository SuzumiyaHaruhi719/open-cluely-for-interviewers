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

## Round 3 — audio, progressive captions, pause, and seek

- Reproduction: played the embedded MP3 continuously from start to end at 1×, then sampled the UI at `0`, `10`, `25`, `47.889`, `51.620`, `75`, and `100` seconds; paused for five real seconds at `48.981s`; sought `35s → 70s → 35s`.
- Full-run evidence: browser media duration and terminal time both equal `100.409s`; the audio ended naturally with seven transcript rows, cue `p8-7`, and exactly one question.
- Checkpoint evidence: `10s=p8-3/13 chars`, `25s=p8-4/31`, `47.889s=p8-5/generating/no question`, `51.620s=p8-5/question-ready/one question`, `75s=p8-6`, `100s=p8-7`. Every slider target matched `audio.currentTime` exactly to the millisecond.
- Pause/seek evidence: five-second pause drift was `0ms`. At `35s` the live cue was `p8-4` with no question; at `70s` it was `p8-6` with one question; seeking back to `35s` removed the future question and restored `monitoring`.
- First viewer-facing defect: at exactly `0.000s`, the timeline rendered a pending transcript article with an empty paragraph before the first grapheme existed.
- Viewer impact: the first visible subtitle state looked like a failed/blank ASR result and visually led the audio instead of following it.
- First divergent boundary: `deriveReplayState(0)` returned one empty `visibleCue`.
- Red gate: a replay-state regression required zero rows at `0ms` and the first non-empty grapheme at `1ms`; it failed `1 !== 0` before the fix.
- Fix: remove zero-length caption cues from visible replay state. A cue becomes a row only after its first grapheme is available.
- Green evidence: regression passes; browser at `0ms` reports `rowCount=0`, then progressive content starts on the first audible cue. All seven time checkpoints, pause, forward seek, and backward reconstruction still pass.
- Remaining risk: Round 4 isolates candidate-first question semantics; Round 5 covers presentation navigation and portable delivery.

## Round 4 — candidate-first Auto question behavior

- Reproduction: inspected the exact frames at `8.499s`, `8.500s`, `47.888s`, `47.889s`, `51.619s`, and `51.620s`, then jumped directly to the reveal frame with the replay slider.
- Semantic evidence: at `8.499s` there were two pending candidate voiceprint rows and no candidate assignment; at `8.500s` both candidate rows became `候选人` and monitoring started without interviewer confirmation. At `47.889s` the state changed to `generating`; at `51.620s` exactly one question appeared immediately after `p8-5`, with `3,026 词元` and `3.7 s`.
- First viewer-facing defect: moving the replay slider before the first Play gesture correctly reconstructed candidate/question state, but left the start overlay on top of the evidence.
- Viewer impact: a presenter could not jump straight to the verified candidate-first moment for explanation; the exact question and its anchor were visually obscured even though the DOM state was correct.
- First divergent boundary: first slider `input` while `started=false`.
- Red gate: `player.test.mjs` required slider interaction to call `markStarted()` before `seekTo(...)`; it failed against the old one-line seek handler.
- Fix: treat an intentional slider movement as starting the replay view. It dismisses the transparent start surface, preserves paused audio, reconstructs state from `audio.currentTime`, and leaves the question fully inspectable.
- Green evidence: after rebuild, seeking directly to `51.620s` reports `overlayHidden=true`, `questionCount=1`, `anchor=p8-5`, correct latency/tokens, and a clear visible question card. Backward seeking continues to remove it.
- Remaining risk: final presentation controls, portability, theme/reduced-motion behavior, and handoff copy remain for Round 5.

## Round 5 — offline portability and presentation readiness

- Reproduction: exercised all nine slides, play/pause, mute, seek, replay, dark theme, leave/return, and the complete audio in the exact built artifact. Static acceptance rejected iframes, remote scripts/styles/fonts/media, and every non-data runtime resource. The Downloads file and repository artifact are compared by SHA-256.
- First viewer-facing defect: after the 100.409-second replay completed, Right Arrow still belonged to the replay, so it remained on Slide 4 at `100409ms` instead of advancing to Slide 5. Focus on the hidden start button or range input could also swallow presentation keys.
- Viewer impact: the presenter finished the strongest proof, pressed the expected slide key, and appeared stuck in front of the audience.
- First divergent boundary: media `ended` / direct seek to `100409ms`, followed by Right Arrow. Browser baseline remained `p8-demo`, counter `04 / 09`.
- Red gate: `player.test.mjs` required an explicit `onEnded` handoff, an `ended` notification, focus release, and a keyboard guard that lets Arrow keys work when a button—not a text/range input—has focus. It failed before implementation.
- Fix: the player now emits a single completion callback for real audio, fallback playback, and direct end seeking; the entry layer releases replay keyboard ownership and blurs the completed control. Arrow keys are no longer suppressed merely because a button has focus.
- Green evidence: after completion, browser focus is `BODY`; Right Arrow advances to `grounding`, counter `05 / 09`, with audio paused. Dark theme resolves to `rgb(21, 26, 29)` and exposes `切换浅色主题`; mute shows `已静音`; replay resets to the beginning with no stale question; leaving Slide 4 pauses at the same time and returning preserves that paused time.
- Portability evidence: the artifact is one HTML containing a `data:audio/mpeg;base64,...` source, inline CSS/JS/data, nine slides, and no iframe/CDN/external runtime resource. Automated `file://` navigation is blocked by the in-app browser's own policy, so interaction QA used the exact byte-identical file through a temporary localhost static server; offline structure and copy identity are independently enforced by tests and hashes.
- Remaining risk: OS/browser audio policies can still require the explicit Play click, which the start surface provides; audio decode failure exposes a user-initiated silent replay rather than inventing progress.

## Final requirement audit

| Requirement | Acceptance evidence |
|---|---|
| Preserve the complete introduction | Nine ordered sections: Cover, Problem, Product answer, P8 proof, Grounding, Interviewer value, GLP value, Current capabilities, Close. Keyboard audit reached all nine with no `1280×720` overflow. |
| Preserve the legacy slide style | Full-viewport slides, persistent GLP status bar, title, `01 / 09` counter, bottom progress, staged reveal motion, arrow/space navigation, and fullscreen key remain in the standalone deck. |
| Reconstruct the current interface | Slide 4 uses the current GLP header/timeline/role pills/question/footer hierarchy, scrollbar, light/dark icon, and reaches `95.3%` viewport width at the acceptance viewport. |
| P8 only | Profile is `用户运营专家（P8）`; timeline/artifact tests reject `物业`, `消防`, and `园区运营`. |
| 1–2 minute audio | Embedded browser duration is exactly `100.409s`; original SHA-256 and non-destructive source range are recorded. |
| Progressive captions | Grapheme-level state advances from `audio.currentTime`; zero-length rows are suppressed; real 1× playback and seven time checkpoints were observed. |
| Candidate-first monitoring | Candidate remains pending through `8.499s`, confirms at `8.500s`, and immediately unlocks monitoring without interviewer confirmation. |
| One meaningful inline question | Generation starts `47.889s`; exactly one question appears `51.620s`, directly after candidate cue `p8-5`; backward seek removes it. |
| Real telemetry | Question card and artifact contain `3,026 词元` and `3.7 s` from the verified report. |
| Explain value | Separate slides explain the evidence-grounding model, interviewer value, GLP organizational value, and current implemented capabilities. |
| One offline file | CSS, JavaScript, replay data, and MP3 are inline; artifact tests reject iframes and external runtime resources. Repository and Downloads SHA-256 are both `3b70b77ac374454333c6ee612396bf6be1e1556a35683cbf145695ccfa64e39b`. |
| Presentation controls/accessibility | Visible named buttons, range label, theme label, reduced-motion CSS, pause-on-exit, mute, replay, seek, keyboard ownership, and end-of-demo handoff were exercised. |
| Five real iterations | Rounds 1–5 each record a reproduced defect, first divergent boundary, red gate, causal fix, and browser/test evidence. |
| Frequent main commits and pushes | Fixture, deck, replay, packaging, and all five acceptance rounds were committed independently and pushed directly to `origin/main`. |
| Downloads handoff | `/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html` is rebuilt from source and byte-identical to the repository artifact. |

## Final verification

- Demo: `11/11` tests passed; no failures, skips, or cancellations.
- Production regression suite: core `6`, question bank `18`, server `272`, web `249` — `545` tests total, all passed.
- Production builds: React/Vite/TypeScript and bundled Node server both exited successfully.
- `git diff --check`: clean.
- Artifact and Downloads hashes: identical (`3b70b77ac374454333c6ee612396bf6be1e1556a35683cbf145695ccfa64e39b`).
