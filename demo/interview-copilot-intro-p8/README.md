# Interview Copilot P8 complete introduction

This folder builds a portable, offline HTML slide deck around one verified product replay.

## Visual provenance

- Design source: `/Users/thomasli/Downloads/interviewer-copilot-intro.html`
- Reused directly: GLP-dark tokens, 36 px status strip, 1240 px slide frame, two-column proof cover, browser screenshot frame, card/feature language, staged `.rv` reveal, bottom progress line, and square navigation controls
- Updated proof asset: `assets/p8-product-replay-cover.png`, captured from this deck's real synchronized P8 question state rather than the legacy property-oriented screen
- Design QA: `design-qa.md` plus matched 1280×720 reference/implementation captures in `qa/`

The P8 content and player are maintained separately from the visual shell. A design change cannot silently alter the audio source, transcript checkpoints, speaker roles, or Expert-question timing.

## Replay provenance

- Source: `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`
- Source SHA-256: `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`
- Source range: `00:06:32.200` through `00:07:56.200`
- Packaged clip: `assets/p8-real-interview-84s.m4a`
- Clip SHA-256: `56beb4525fa62e6056e83b951efa062d98e39a1422177f72ee26b1dfb15a43e5`
- Timeline contract: `84.000s` (browser-decoded AAC duration: `84.242s`)
- Job profile: `user-operations-p8`（用户运营专家 P8）
- Transcript source: a real-time Doubao Seed ASR 2.0 pass over the exact packaged clip
- Caption timing: 231 observed partial updates compacted into monotonic grapheme checkpoints
- Generation begins: `30.000s`
- Question appears: `33.731s`
- Expert latency: `3.731s`
- Usage: `3,026 词元`
- Verified question: `你提到为了拿到全网最低价，会停止与其他竞品合作。这个排他策略如何验证带来的是增量，而不是平台对单一品牌的依赖？`

The deck labels this sequence **真实产品数据回放**. It is a deterministic replay of verified product output, not live inference inside the standalone file. Audio, final transcript copy, roles, and reveal checkpoints all originate from the same exported clip; the renderer never estimates progress by distributing characters evenly across a sentence.

## Build and test

```bash
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
node demo/interview-copilot-intro-p8/scripts/build.mjs
```

The generated file is `dist/Interview Copilot P8 Complete Introduction.html` and requires no server, credentials, microphone, BlackHole device, CDN, or network connection. The build inlines the P8 M4A, the real P8 product screenshot, CSS, replay data, and JavaScript into that one file.
