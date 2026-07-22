# Interview Copilot Complete HTML Introduction with P8 Demo Design

## Purpose

Create a presentation-ready Chinese HTML introduction that preserves the old deck's complete value narrative, updates it for the current GLP Interviewer Copilot, and proves the product through a synchronized 1–2 minute replay of a real P8 user-operations interview. The introduction must remain the primary artifact; the interactive replay is its central proof slide, not a replacement for the surrounding explanation. The artifact must be understandable without a presenter and reliable on another computer without localhost, cloud credentials, BlackHole, microphone permission, or network access.

## Chosen approach

Build a deterministic reconstruction of the current interviewer workspace rather than iframe the live product.

The final deliverable is one offline slide-deck HTML file with inline CSS, JavaScript, and MP3 data. It retains the old introduction's cover, problem, solution, accuracy, interviewer value, organizational value, current-state proof, and closing sections. Its central demonstration slide faithfully reconstructs the current GLP interface: current top bar, interview metadata, unified transcript timeline, role states, candidate-first monitoring, and inline Expert question card. A small build source remains in the repository so the single-file artifact can be regenerated and audited.

This choice is preferable to the alternatives:

- A live iframe looks exact but fails when the local server, API, audio loopback, permissions, or network are unavailable.
- A GIF or prerecorded video is stable but cannot pause, scrub, replay, expose evidence, or keep audio and state accessible.
- The offline reconstruction preserves the product story and interaction while making the demo deterministic. It must visibly say `真实产品数据回放` so viewers are never led to believe that the offline artifact is performing live inference.

## Evidence sources

### Legacy reference

- `/Users/thomasli/Downloads/interviewer-copilot-intro.html` is a 10-minute, 11-slide GLP value deck and remains the content-structure reference.
- `/Users/thomasli/Downloads/interviewer-copilot-demo.html` is a separate old-product simulation embedded by iframe.
- The new artifact keeps the old deck's answer-first GLP storytelling and presentation controls. It condenses duplicated or outdated material, updates all product claims, and replaces the old embedded simulation with the current UI plus one 100.409-second P8 replay.

### Current product reference

The visual and behavioral source of truth is the current production interface under `web-app/web/src/desktop/`, especially:

- `Shell.tsx` — one-shot interview flow and current action hierarchy.
- `InterviewHeader.tsx` — GLP top bar and essential actions.
- `TranscriptStream.tsx` — chronological transcript, notes, role states, and inline questions.
- `QuestionCard.tsx` — Expert question, source, latency, and token evidence.
- `desktop-ui/theme.css`, `desktop-ui/styles.css`, and `desktop-ui/one-shot-interview.css` — GLP colors, spacing, typography, and surface treatment.

The reconstruction copies visual tokens and behavior, not React production code. No product setting, API credential, pipeline editor, question bank, TTS, or retired feature is reintroduced.

### P8 audio and question evidence

Use only the P8 fixture:

`/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`

The file is AAC in an MP4 container despite its extension. Build a non-destructive MP3 excerpt from:

- Source start: `00:05:48.011` (`348.011s`).
- Source end: `00:07:28.420` (`448.420s`).
- Audio duration: `100.409s`.
- Selected context: built-in `用户运营专家（P8）` JD and scorecard.

The excerpt begins with the interviewer challenging how the card channel should compete on benefits. The candidate explains the platform phase, user inertia, breadth-to-quality strategy, category focus, and exclusive pricing. It ends before the next interviewer topic becomes active.

Replay the verified Expert question from `/tmp/open-cluely-five-round-20260722/round-2-after.json`:

> 你提到平台期靠“全”吸引有惯性的用户，那么当用户因为你的平台更全而开始使用时，你如何判断哪些利益点需要从“全”升级为“优”？

Verified evidence:

- Question source timestamp: `399.631s`.
- Demo-relative question time: `51.620s`.
- Model latency: `3.731s`.
- Token usage: `3,026 词元`.
- Trigger: automatic Expert follow-up.
- Anchor: delegated candidate voiceprint only.

The demo must not show the property-manager JD, property audio, or property question anywhere.

## Audience and message

Primary audience: GLP managers, recruiting leaders, and business interviewers seeing the product for the first time.

The entire story answers three questions:

1. What problem does it solve? Business interviewers cannot listen, evaluate, remember the JD, and design the best follow-up at the same time.
2. What does the product do? It confirms the candidate voiceprint, monitors only candidate evidence, finds a specific evidence gap, and places one useful question immediately below that evidence.
3. What value does that create? The interviewer stays present, obtains decision-grade evidence, and applies a consistent P8 bar without becoming a professional interviewer.

The value language must stay concrete. Avoid unsupported claims about hiring ROI, perfect speaker accuracy, or fully autonomous decisions.

## Complete introduction structure

Use the old HTML's presentation model exactly at the structural level: one full-viewport slide at a time, no document-length landing-page scroll, arrow/space navigation, visible slide counter, progress bar, fullscreen-safe layout, and a persistent but quiet GLP status strip. Preserve the old deck's staged `.rv` reveal rhythm and concise presenter key hints, but update easing, spacing, typography, and surfaces to the current GLP design language. Do not display a fake overall timecode. The introduction has nine slides.

The persistent presentation chrome is:

- Left status: `GLP · 面试官 Copilot / 产品介绍` with a restrained live dot.
- Right status: current slide title and `01 / 09` counter.
- Bottom: thin GLP-green progress line.
- Bottom-right: previous/next circular controls.
- Bottom-left: compact `← → 翻页 · 空格继续 · F 全屏` hint that fades after interaction.
- Keyboard: Left/Right, PageUp/PageDown, Space, Home/End, and `F` fullscreen.
- Transition: outgoing content fades 120ms; incoming slide reveals in 240–420ms. There is no blurred backdrop or long transition that hides the product.

### Slide 1 — cover

- GLP mark and title: `让每一场面试，都问到点子上`.
- Explanation: `面试官专注听人，AI 负责盯住证据缺口。`.
- Trust labels: `当前产品实录`, `P8 用户运营专家`, `1–2 分钟互动演示`.

### Slide 2 — why this matters

Preserve the old deck's three interviewer problems, rewritten compactly:

- `30 分钟，分不出背稿和实干`.
- `业务骨干不是职业面试官`.
- `十个面试官，十把尺子`.

The conclusion remains: missed evidence is a hiring-quality cost even when it never appears on a report.

### Slide 3 — the product in one sentence

Show the current three-stage flow:

`听懂候选人回答 → 发现证据缺口 → 把最该问的一句放回原话下面`

State the boundary clearly: the product does not answer for the candidate and does not make the hiring decision.

### Slide 4 — interactive P8 proof

This is the central full-product slide. The current interviewer workspace occupies most of the viewport and contains one `播放 1 分 40 秒真实演示` button. Audio starts only after that user gesture.

- Header shows `用户运营专家（P8）` and `真实产品数据回放`.
- Context chip shows `P8 · 组织级策略与业务影响`.
- Audio plays the full 100.409-second excerpt once at 1×.
- The transcript appears in chronological order and grows by grapheme while each utterance is active.
- Interviewer rows use the current amber role treatment; candidate rows use the current blue treatment.
- The candidate voiceprint changes from `待确认 · 说话人 1` to `候选人` after sufficient candidate evidence. Interviewer confirmation is not an admission prerequisite.
- A small status changes to `候选人已确认 · 正在监测证据缺口`.
- At demo-relative `47.889s`, the status becomes `发现证据缺口 · Expert 正在生成` and shows restrained progress.
- At `51.620s`, the verified question animates directly below the candidate evidence that triggered it.
- The card shows `自动 · 专家`, `3.7 s`, `3,026 词元`, and `候选人证据`.
- The question remains in the unified timeline. No detached permanent question panel appears.
- Exactly one Expert question is visible during this excerpt.
- Controls: play/pause, mute, seek, replay, and `打开真实产品`.
- `打开真实产品` targets `http://127.0.0.1:8004/` but is optional; the offline introduction remains complete if it is unavailable.

Navigating away pauses the audio. Returning to the slide preserves the paused time; `重新播放` resets only the demo, not the presentation slide index.

### Slide 5 — why the question is reliable

Preserve the old three-source explanation, updated to current product behavior:

- `候选人的原话` — only delegated candidate evidence may trigger Auto.
- `岗位 JD 与 P8 评分标准` — JD is expert context, not a second prompt system.
- `这场面试已经问过什么` — bounded history prevents repetition and tracks uncovered evidence.

Use the P8 question from Slide 4 as the worked example and visually connect each source to the final question.

### Slide 6 — value to the interviewer

Preserve the old value section with three current outcomes:

- `专注倾听` — no need to design the next question while evaluating the current answer.
- `关键证据不漏` — the selected P8 rubric remains in context.
- `结论有据` — question, evidence anchor, answer, latency, and model usage remain in one timeline.

### Slide 7 — value to GLP

Preserve the organizational-value section, limited to supportable claims:

- More consistent evidence collection across interviewers.
- Better distinction between polished narration and verifiable ownership.
- Reusable job-specific interviewing standards.
- Less follow-up interviewing caused by missed evidence.
- Stronger candidate experience because the interviewer remains present.

Do not claim measured ROI or perfect hiring accuracy.

### Slide 8 — what exists now

Replace the old roadmap-heavy slide with current, demonstrable capabilities:

- Searchable built-in JD profiles including P7/P8.
- Doubao Seed ASR 2.0 rolling captions.
- Whole-voiceprint role delegation with safe `待确认` fallback.
- Candidate-first automatic Expert follow-ups under the ten-second SLO.
- Manual follow-up, unified notes/timeline, interview summary, and one-shot reset.

Mark all of these as `已实现`. Do not show speculative future features as if they exist.

### Slide 9 — close

- Closing line: `让“会面试”，不再只依赖个人手感`.
- Supporting line: `把好问题、好标准和真实证据，交到每一位面试官手边。`.
- Actions: `重播 P8 演示`, `打开真实产品`, and `返回封面`.

## UI reconstruction

The demo uses the current GLP light visual language by default:

- White and warm-gray background surfaces.
- GLP green for product status and Expert accents.
- Amber for interviewer identity.
- Blue for candidate identity.
- Thin borders, restrained shadows, compact radii, and generous transcript whitespace.
- System Chinese font stack only; no Google Fonts or CDN request.

The surrounding introduction preserves the old deck's recognizable composition patterns—large answer-first headlines, compact eyebrow labels, three-column evidence cards, feature rows, product proof frames, and a strong closing slide—while removing duplicated copy and the obsolete product screenshot. The deck must feel like a new edition of the user's existing presentation, not a separate marketing site.

The product viewport includes only presentation-relevant current functions:

- GLP header, P8 job context, elapsed time, and replay status.
- Unified transcript timeline with timestamps.
- Candidate/interviewer/unknown role states.
- Candidate-first Auto monitor state.
- Inline Expert question card and its real telemetry.
- Audio progress, play/pause, mute, replay, and scrub.
- Optional one-icon light/dark theme toggle.

Preparation inputs, microphone selectors, summary, clear, settings, and end-interview controls are omitted from the deterministic replay because they are not exercised in the two-minute story. Their omission must not change the shape of the central product workspace.

## Synchronization architecture

### Timeline data

Store immutable replay data in `demo/interview-copilot-intro-p8/src/timeline.mjs`:

```js
export const DEMO_DURATION_MS = 100409;
export const AUDIO_START_MS = 0;
export const SOURCE_START_SECONDS = 348.011;
export const SOURCE_END_SECONDS = 448.420;

export const cues = [
  { id: 1, startMs: 0, endMs: 0, role: 'candidate', speakerId: 1, text: '嗯。' },
  { id: 2, startMs: 0, endMs: 0, role: 'interviewer', speakerId: 0, text: '一开始的时候怎么去做呢？' },
  { id: 3, startMs: 0, endMs: 19744, role: 'candidate', speakerId: 1, text: '那其实还是两个阶段，第一个阶段就是我们的平台期……' }
];

export const questionEvent = {
  revealMs: 51620,
  generatingMs: 47889,
  anchorCueId: 5,
  latencyMs: 3731,
  tokens: 3026,
  trigger: 'auto',
  text: '你提到平台期靠“全”吸引有惯性的用户，那么当用户因为你的平台更全而开始使用时，你如何判断哪些利益点需要从“全”升级为“优”？'
};
```

The implementation must replace the abbreviated sample cue with the complete verified transcript from the report. Cue boundaries are converted from source timestamps to the demo master clock.

### Master clock

- `audio.currentTime` is authoritative while audio is playing.
- The visual master time is `AUDIO_START_MS + audio.currentTime * 1000`.
- Before audio, after audio, and while seeking, use a monotonic `performance.now()` offset.
- Rendering uses one `requestAnimationFrame` loop and derives state from current time; it does not schedule independent `setTimeout` chains that drift.
- Seeking backward reconstructs the complete UI deterministically from the target time.
- Pausing freezes audio, transcript growth, progress, and question generation together.

### Grapheme progression

For an active cue, reveal `floor(progress * graphemeCount)` graphemes. Use `Intl.Segmenter('zh-CN', { granularity: 'grapheme' })` with `Array.from()` fallback. A final cue always renders its complete text.

### Audio packaging

- Use the bundled Bilibili ffmpeg binary to trim and re-encode the source non-destructively.
- Output mono MP3 at 64 kbps for voice clarity and compact embedding.
- Base64-encode the built MP3 into the final HTML as a `data:audio/mpeg;base64,...` source.
- The source recording and temporary WAV fixtures are never modified.
- The build verifies the clip duration is `100.409s ± 0.100s` before embedding.

## Error handling

- If audio decoding fails, keep the introduction and transcript playable in silent replay mode and show `音频未能加载，可继续查看演示`.
- If autoplay is blocked, remain on the opening state with the primary button enabled; never advance silently without explicit user action.
- If the optional real-product URL is unavailable, no offline-demo control is affected.
- On visibility loss, pause rather than let audio and animation diverge.
- On `prefers-reduced-motion`, replace spatial transitions with opacity changes while preserving timing and content.

## Accessibility and controls

- All controls are native buttons with Chinese accessible names.
- Outside Slide 4, Space advances the deck and Left/Right change slides. While Slide 4's demo is active or an audio control has focus, Space toggles play/pause and Left/Right seek by five seconds; `Escape` returns keyboard ownership to deck navigation.
- Home/End move to the first/last slide outside the demo and restart/jump to the end only while the demo progress control has focus. `M` toggles demo mute from any slide.
- The progress slider exposes elapsed and remaining time.
- Captions are always visible and do not depend on color alone for role identity.
- Minimum control target is 40×40 CSS pixels.
- The demo supports 1280×720, 1440×900, and 1920×1080 without document-level horizontal scroll.

## Repository and final artifacts

Create maintainable source at:

```text
demo/interview-copilot-intro-p8/
  README.md
  assets/p8-card-channel-100s.mp3
  src/index.template.html
  src/styles.css
  src/timeline.mjs
  src/replay-state.mjs
  src/deck.mjs
  src/player.mjs
  src/entry.mjs
  scripts/build.mjs
  test/timeline.test.mjs
  test/replay-state.test.mjs
  test/artifact.test.mjs
  dist/Interview Copilot P8 Complete Introduction.html
```

Copy the verified dist artifact to:

`/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html`

Keep `dist/` in git because the user explicitly needs a ready-to-open portable artifact. The build must be deterministic apart from an informational build commit string.

Record five rounds in:

`docs/qa/2026-07-22-interview-copilot-p8-html-demo.md`

## Five-round iteration contract

Every round must discover and fix a real artifact problem. A prewritten concern does not count as an encountered problem until evidence reproduces it. Each journal section records build commit, browser and viewport, reproduction, user-facing impact, first divergent boundary, failing assertion or measurement, fix, after evidence, and remaining risk.

### Round 1 — story and timing

Verify that the nine-slide introduction preserves the legacy story—problem → product action → proof → accuracy → interviewer value → organizational value → current capability → close—and that only P8 content appears in the proof. Fix the first observed missing explanation, pacing failure, ambiguity, or unsupported claim.

### Round 2 — current-product visual fidelity

Compare the reconstruction against the current production app at 1440×900 and 1920×1080. Fix the most visible mismatch in hierarchy, role treatment, timeline placement, or question-card fidelity.

### Round 3 — audio, captions, and seeking

Measure cue/audio drift while playing, pausing, seeking backward, and resuming. Fix the first reproduced synchronization, grapheme, duration, or browser-decoding failure. Final absolute drift must stay within 250ms.

### Round 4 — candidate-first Auto question story

Verify candidate confirmation enables monitoring without interviewer confirmation, generation begins only after candidate evidence, and the one verified question appears below its anchor with correct telemetry. Fix the first reproduced premature, late, duplicated, detached, or misleading state.

### Round 5 — portability and presentation readiness

Open the copied HTML from `file://` in Chrome and the in-app browser with networking unavailable. Exercise all nine slides plus play, pause, mute, seek, replay, theme, reduced motion, 1280×720, 1440×900, and 1920×1080. Fix the most important remaining blocker and rerun the complete 100.409-second P8 proof slide.

Each round ends with a focused commit and push to `main`. The final round also runs the complete repository test/build suite so the demo cannot silently damage the production application.

## Acceptance gates

- The final artifact is one offline HTML file and has no external network dependency.
- The embedded P8 replay is `100.409s`, satisfying the required 60–120-second demo duration; the complete introduction remains a presenter-controlled nine-slide deck.
- Only the P8 profile, P8 audio, and P8 Expert question are present.
- One click on Slide 4 starts synchronized P8 audio and product animation.
- The transcript grows progressively and stays in chronological order.
- Candidate confirmation, monitoring, generation, and one inline question are visible in the correct order.
- The question text, `3.731s`, and `3,026 词元` match verified report evidence.
- No question appears before candidate evidence and no second question appears in the selected excerpt.
- Play/pause, mute, seek, replay, keyboard controls, reduced motion, and theme are operable.
- Playback remains within 250ms of cue time after pause/resume and seek.
- The layout works at all three target viewports without clipping core content.
- The file opens from `file://` on a second-path copy with networking disabled.
- The five-round journal contains five actual reproduced problems and five verified fixes.
- Source, tests, generated HTML, QA journal, and matching implementation note are committed and pushed to `main`.

## Non-goals

- Live ASR, live model inference, microphone capture, BlackHole routing, or API-key use inside the offline HTML.
- A replacement for the production Interviewer Copilot.
- A full product tutorial or ten-minute management deck.
- Property-manager content, TTS, meeting minutes, question bank, pipeline editor, or settings walkthrough.
- Claims of perfect speaker separation, automatic hiring decisions, or quantified hiring ROI without supporting data.
