# Interview Copilot P8 complete introduction

This folder builds one portable GLP presentation around a complete, evidence-backed Interview Copilot replay. Slide 4 is the actual production-shaped interview workspace, not a screenshot or schematic.

## What the standalone HTML contains

- The complete `08:13.517` source MP3 supplied for the P7–P8 user-operations interview.
- All 48 final Doubao Seed ASR 2.0 events in chronological order.
- Voiceprint-level roles: speaker 0 → interviewer, speaker 1 → candidate, speaker 2 → unknown/non-participant.
- Character-progressive captions, inline automatic questions, session context, notes, theme, replay, seek, and the production summary modal.
- A visible, muted, interruptible `60×` transport that reaches the real end in `8.226s` from the start.
- A captured production DeepSeek report generated from the complete role-resolved transcript, built-in P8 JD, and the production scoring prompt.

The HTML performs no browser-side ASR or model call. It deterministically replays verified production evidence and labels the result as `真实生产结果回放`.

## Evidence provenance

### Audio and transcript

- Source: `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`
- Packaged audio: `assets/p8-full-interview-493s.mp3`
- SHA-256: `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`
- Duration: `493,517ms`
- Seed ASR fixture: `fixtures/p8-full-seed-asr.json`
- Final events: `48`
- Voiceprints: `3`
- Timeline derivation: `src/full-timeline.mjs`

### Full production summary

- Profile: `user-operations-p8`（用户运营专家 P8）
- Model: `deepseek-v4-pro`
- Fallback: `false`
- Production elapsed time: `29.414s`
- Input/output: `2,600 / 1,119` tokens
- Transcript: `3,450` characters; `48` final events
- Prompt SHA-256: `169bff9d77a57bf8169a6b2bdfa40ce3fe740148cd48b47168970b225c1f6848`
- Transcript SHA-256: `ab342481a330c0e3a8e3e2c1c823345c96470cfe8c02a5bb894b5db45ef8d459`
- Captured result: `fixtures/p8-full-summary.json`
- Reproducible capture script: `scripts/generate-full-summary.mts`

The report preserves the five production scoring sections: conclusion, capability scores, strengths, risks, and further assessment. The captured conclusion is `不推荐录用`, with transcript quotations attached to the scored evidence.

## Runtime architecture

`scripts/build.mjs` imports the production desktop CSS in application order, bundles the deck and product-frame runtimes, embeds the exact MP3 and fixtures, and emits one HTML. The product document is stored as a base64 payload and assigned through `iframe.srcdoc`; this avoids browser URL-size limits while preserving a server-free single file.

The media clock is the only replay clock. Normal playback, 60× fast-forward, captions, role labels, questions, context, progress, and completion all derive from it. Consecutive finals from the same voiceprint are treated as one spoken turn, divided by grapheme weight, and exposed through one monotonic checkpoint per grapheme so `输入中…` grows continuously instead of freezing on one character. Seeking backwards reconstructs state and dismisses future summary/question state.

## Build and test

```bash
node demo/interview-copilot-intro-p8/scripts/build.mjs --copy
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
```

Outputs:

- Repository: `demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html`
- Handoff: `/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html`

Both copies must be byte-identical. The file requires no server, credentials, microphone, BlackHole device, CDN, or network connection.

See `design-qa.md` and `docs/qa/2026-07-23-p8-fast-forward-summary.md` for the five-layer defect/fix record and browser acceptance evidence.
