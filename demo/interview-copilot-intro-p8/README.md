# Interview Copilot P8 complete introduction

This folder builds a portable, offline HTML slide deck around one verified product replay.

## Replay provenance

- Source: `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`
- Source SHA-256: `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`
- Source range: `00:05:48.011` through `00:07:28.420`
- Clip duration: `100.409s`
- Job profile: `user-operations-p8`（用户运营专家 P8）
- Verification report: `/tmp/open-cluely-five-round-20260722/round-2-after.json`
- Generation begins: `47.889s`
- Question appears: `51.620s`
- Expert latency: `3.731s`
- Usage: `3,026 词元`
- Verified question: `你提到平台期靠“全”吸引有惯性的用户，那么当用户因为你的平台更全而开始使用时，你如何判断哪些利益点需要从“全”升级为“优”？`

The deck labels this sequence **真实产品数据回放**. It is a deterministic replay of verified product output, not live inference inside the standalone file.

## Build and test

```bash
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
node demo/interview-copilot-intro-p8/scripts/build.mjs
```

The generated file is `dist/Interview Copilot P8 Complete Introduction.html` and requires no server, credentials, microphone, BlackHole device, CDN, or network connection.
