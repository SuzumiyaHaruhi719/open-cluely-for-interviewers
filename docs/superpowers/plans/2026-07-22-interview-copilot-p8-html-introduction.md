# Interview Copilot Complete P8 HTML Introduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one portable offline HTML slide deck that preserves the legacy GLP product introduction, reconstructs the current interviewer workspace, and contains a synchronized 100.409-second P8 interview replay with candidate-first role confirmation and one verified inline Expert question.

**Architecture:** Maintain small source modules under `demo/interview-copilot-intro-p8/`, use immutable timeline data plus one audio-authoritative replay state machine, and build them into one self-contained HTML file. The nine-slide deck retains the legacy presentation model; Slide 4 contains the deterministic current-product replay. Five acceptance rounds each reproduce and fix one real viewer-facing issue, record before/after evidence, commit, and push.

**Tech Stack:** Semantic HTML, CSS, browser JavaScript, Node.js 20, Node test runner, esbuild already installed under `web-app/node_modules`, bundled Bilibili ffmpeg, Browser/Chrome visual verification.

**Design:** `docs/superpowers/specs/2026-07-22-interview-copilot-p8-html-introduction-design.md`

## Global Constraints

- Preserve the old HTML's full-viewport slide style, status strip, counter, progress line, reveal rhythm, arrow/space navigation, and fullscreen presentation behavior.
- Preserve the complete introduction: cover, problem, solution, P8 proof, why it is reliable, interviewer value, GLP value, current capabilities, and close.
- The proof uses only `用户运营专家（P8）`; no property-manager content may appear.
- Audio source is `/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`, trimmed non-destructively from `348.011s` through `448.420s`.
- The embedded replay duration is exactly `100.409s` within a tolerance of `±0.100s`.
- The verified Expert question appears at replay time `51.620s`, after generation begins at `47.889s`, with `3.731s` latency and `3,026 词元`.
- Candidate voiceprint confirmation unlocks monitoring; interviewer confirmation is not an Auto admission prerequisite.
- Exactly one question appears, inline below its candidate evidence. No detached permanent question panel is allowed.
- Final output is one offline HTML with inline CSS, JavaScript, and audio; it may not require localhost, cloud keys, BlackHole, permissions, fonts, CDNs, or network access.
- The deck labels the replay `真实产品数据回放`; it never implies the offline file performs live model inference.
- Default copy is Chinese. Source-grounded `P8`, `App`, `GMV`, and `ROI` are allowed.
- Work directly on `main`, make a focused commit per implementation/iteration checkpoint, and push every completed checkpoint.
- Use `apply_patch` for authored text/code edits. Do not alter either source MP3.
- After implementation, create or update `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/html-p8-introduction-demo.md`.

---

### Task 1: Freeze the P8 audio fixture and replay contract

**Files:**
- Create: `demo/interview-copilot-intro-p8/README.md`
- Create: `demo/interview-copilot-intro-p8/assets/p8-card-channel-100s.mp3`
- Create: `demo/interview-copilot-intro-p8/src/timeline.mjs`
- Create: `demo/interview-copilot-intro-p8/test/timeline.test.mjs`

**Interfaces:**
- Consumes: the original P8 recording and verified report `/tmp/open-cluely-five-round-20260722/round-2-after.json`.
- Produces: `DEMO_DURATION_MS`, `SOURCE_START_SECONDS`, `SOURCE_END_SECONDS`, `roleConfirmedMs`, `cues`, and `questionEvent` for every later task.

- [ ] **Step 1: Write the failing timeline contract test**

Create `test/timeline.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_DURATION_MS,
  SOURCE_PROFILE_ID,
  SOURCE_START_SECONDS,
  SOURCE_END_SECONDS,
  roleConfirmedMs,
  cues,
  questionEvent
} from '../src/timeline.mjs';

test('P8 replay is one ordered 100.409-second candidate-first proof', () => {
  assert.equal(SOURCE_PROFILE_ID, 'user-operations-p8');
  assert.equal(SOURCE_START_SECONDS, 348.011);
  assert.equal(SOURCE_END_SECONDS, 448.420);
  assert.equal(DEMO_DURATION_MS, 100409);
  assert.ok(roleConfirmedMs > 0 && roleConfirmedMs < questionEvent.generatingMs);
  assert.equal(questionEvent.generatingMs, 47889);
  assert.equal(questionEvent.revealMs, 51620);
  assert.equal(questionEvent.latencyMs, 3731);
  assert.equal(questionEvent.tokens, 3026);
  assert.equal(questionEvent.trigger, 'auto');
  assert.equal(
    questionEvent.text,
    '你提到平台期靠“全”吸引有惯性的用户，那么当用户因为你的平台更全而开始使用时，你如何判断哪些利益点需要从“全”升级为“优”？'
  );
  assert.ok(cues.length >= 7);
  assert.ok(cues.every((cue, index) => cue.startMs <= cue.endMs && (index === 0 || cues[index - 1].startMs <= cue.startMs)));
  assert.ok(cues.some((cue) => cue.role === 'interviewer'));
  assert.ok(cues.some((cue) => cue.role === 'candidate'));
  assert.ok(cues.find((cue) => cue.id === questionEvent.anchorCueId)?.role === 'candidate');
  assert.ok(cues.every((cue) => !/物业|消防|园区/.test(cue.text)));
});
```

- [ ] **Step 2: Run the test and observe the missing-module failure**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/timeline.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/timeline.mjs`.

- [ ] **Step 3: Create the exact replay timeline**

Create `src/timeline.mjs` with the verified P8 copy and bounded cue data:

```js
export const SOURCE_PROFILE_ID = 'user-operations-p8';
export const SOURCE_START_SECONDS = 348.011;
export const SOURCE_END_SECONDS = 448.420;
export const DEMO_DURATION_MS = 100409;
export const roleConfirmedMs = 8500;

export const cues = [
  { id: 'p8-1', startMs: 0, endMs: 350, role: 'candidate', speakerId: 1, text: '嗯。' },
  { id: 'p8-2', startMs: 350, endMs: 2500, role: 'interviewer', speakerId: 0, text: '一开始的时候怎么去做呢？' },
  { id: 'p8-3', startMs: 2500, endMs: 19744, role: 'candidate', speakerId: 1, text: '那其实还是两个阶段，第一个阶段就是我们的平台期，我们的平台期其实' },
  { id: 'p8-4', startMs: 19744, endMs: 39669, role: 'candidate', speakerId: 1, text: '引入的都是一些成熟的银行已经谈好的利益点，而他们如果长期在使用这个利益点，也就证明他们在市场上是有一定竞争力的。也许有一些用户，他们可以通过各种渠道知道，星巴克其实在某一个平台要比招商银行、广发银行每周三、每周五的优惠利益点更大，但是更多' },
  { id: 'p8-5', startMs: 39669, endMs: 59950, role: 'candidate', speakerId: 1, text: '的海量用户其实是不知道，他们长期在使用银行的 App 去购买一些卡券。那么我们的核心目标用户群体是这些比较有惯性的人，那么我做的其实最开始不是说我要有多大的利益点去吸引我的用户，而是说我是有多全的利益点去吸引我的用户。那么用户来了之后，甚至有可能因为我的平台展示了' },
  { id: 'p8-6', startMs: 59950, endMs: 79616, role: 'candidate', speakerId: 1, text: '各个银行基于餐饮行业的利益点，他反而去办了一张该银行的卡。但第二个阶段是我要有很牛的优惠点的竞争力的时候，我为什么敢做？如果我什么品牌都做，我就很难有市场竞争力。但如果我主推一个品牌，我去帮他做市场的渗透的话，那我们其实是一个' },
  { id: 'p8-7', startMs: 79616, endMs: 100409, role: 'candidate', speakerId: 1, text: '强强联合的状态，那么我就要一个全平台、全网最低价，他就会愿意给我，因为我所有其他的竞品我都不合作，而且基于之前我跟银行的合作，我有大量的这种对你这个品类非常热爱的目标用户群体。你说你想不想要你竞争对手的用户吧？你要是想，你就给我一个最低价。' }
];

export const questionEvent = {
  generatingMs: 47889,
  revealMs: 51620,
  anchorCueId: 'p8-5',
  latencyMs: 3731,
  tokens: 3026,
  trigger: 'auto',
  text: '你提到平台期靠“全”吸引有惯性的用户，那么当用户因为你的平台更全而开始使用时，你如何判断哪些利益点需要从“全”升级为“优”？'
};
```

- [ ] **Step 4: Trim the source into a compact voice MP3**

Run:

```bash
mkdir -p demo/interview-copilot-intro-p8/assets
'/Users/thomasli/Library/Application Support/bilibili/ffmpeg/ffmpeg' -y \
  -i '/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3' \
  -ss 348.011 -t 100.409 -vn -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k \
  'demo/interview-copilot-intro-p8/assets/p8-card-channel-100s.mp3'
'/Users/thomasli/Library/Application Support/bilibili/ffmpeg/ffmpeg' \
  -i 'demo/interview-copilot-intro-p8/assets/p8-card-channel-100s.mp3' -f null - 2>&1 | rg 'Duration:'
```

Expected: the last command reports approximately `00:01:40.40`; the original file timestamp and hash remain unchanged.

- [ ] **Step 5: Document fixture provenance**

Create `README.md` containing the source path, SHA-256 `6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2`, source/clip timestamps, report path, P8 profile ID, question text, latency, token count, build command, and `真实产品数据回放` disclosure.

- [ ] **Step 6: Run the timeline test green and commit**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/timeline.test.mjs
git diff --check
git add demo/interview-copilot-intro-p8
git commit -m 'feat: add verified P8 demo fixture'
git push origin main
```

Expected: one test passes; commit contains only the fixture, timeline, test, and provenance.

---

### Task 2: Rebuild the complete legacy-style GLP introduction deck

**Files:**
- Create: `demo/interview-copilot-intro-p8/src/index.template.html`
- Create: `demo/interview-copilot-intro-p8/src/styles.css`
- Create: `demo/interview-copilot-intro-p8/src/deck.mjs`
- Create: `demo/interview-copilot-intro-p8/test/deck.test.mjs`

**Interfaces:**
- Consumes: the nine-slide copy and presentation behavior from the design spec.
- Produces: `createDeck({ root, onSlideChange })`, nine semantic slide sections, and the current GLP presentation chrome.

- [ ] **Step 1: Write the failing deck-structure test**

Create `test/deck.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../src/index.template.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('complete introduction preserves nine-slide presentation structure', () => {
  const slides = [...html.matchAll(/<section[^>]+data-slide-id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(slides, ['cover', 'problem', 'solution', 'p8-demo', 'grounding', 'interviewer-value', 'glp-value', 'current', 'close']);
  for (const copy of [
    '让每一场面试，都问到点子上',
    '30 分钟，分不出背稿和实干',
    '听懂候选人回答',
    '为什么这句追问值得问',
    '对面试官的价值',
    '对 GLP 的价值',
    '当前已经实现',
    '让“会面试”，不再只依赖个人手感'
  ]) assert.match(html, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /id="deck-prev"/);
  assert.match(html, /id="deck-next"/);
  assert.match(html, /id="deck-progress"/);
  assert.match(html, /id="deck-counter"/);
  assert.match(css, /\.slide\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.slide\.is-active/);
  assert.doesNotMatch(html, /物业|消防|园区运营/);
});
```

- [ ] **Step 2: Run the deck test red**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/deck.test.mjs
```

Expected: FAIL because the template and stylesheet do not exist.

- [ ] **Step 3: Create the semantic nine-slide template**

Use one `<main id="deck">` containing these exact sections and headings:

```html
<section class="slide cover-slide is-active" data-slide-id="cover" data-slide-title="封面">
  <div class="slide-inner hero-layout">
    <div class="eyebrow rv">GLP · 面试官 Copilot</div>
    <h1 class="rv">让每一场面试，<br>都问到点子上</h1>
    <p class="lead rv">面试官专注听人，AI 负责盯住证据缺口。</p>
    <div class="proof-chips rv"><span>当前产品实录</span><span>P8 用户运营专家</span><span>1–2 分钟互动演示</span></div>
  </div>
</section>
<section class="slide" data-slide-id="problem" data-slide-title="为什么值得做">
  <div class="slide-inner"><div class="eyebrow rv">为什么值得做</div><h2 class="rv">招聘的成败在面试间里，但面试是最难做好的工作</h2><div class="card-grid three rv"><article><h3>30 分钟，分不出背稿和实干</h3></article><article><h3>业务骨干不是职业面试官</h3></article><article><h3>十个面试官，十把尺子</h3></article></div><p class="thesis rv">没问到的证据，不会出现在任何报告里，却会进入每一次用人决定。</p></div>
</section>
<section class="slide" data-slide-id="solution" data-slide-title="产品答案">
  <div class="slide-inner"><div class="eyebrow rv">一句话讲完</div><h2 class="rv">把最该问的那一句，放回候选人刚说过的原话下面</h2><div class="flow rv"><span>听懂候选人回答</span><b>→</b><span>发现证据缺口</span><b>→</b><span>生成一个专家追问</span></div><p class="thesis rv">它不替候选人回答，也不替面试官做决定。</p></div>
</section>
<section class="slide demo-slide" data-slide-id="p8-demo" data-slide-title="P8 真实演示"><div class="slide-inner demo-layout"><div class="demo-copy"><div class="eyebrow rv">真实 P8 面试录音</div><h2 class="rv">候选人一说到关键处，追问就在原话下面出现</h2></div><div id="product-replay" class="product-replay rv" aria-label="P8 面试产品回放"></div></div></section>
<section class="slide" data-slide-id="grounding" data-slide-title="为什么问得准"><div class="slide-inner"><div class="eyebrow rv">为什么这句追问值得问</div><h2 class="rv">每一句追问，都有三份可检查的依据</h2><div class="card-grid three rv"><article><h3>候选人的原话</h3><p>只有已确认候选人的证据能触发自动追问。</p></article><article><h3>岗位 JD 与 P8 评分标准</h3><p>岗位要求作为专家上下文，不另造一套提示系统。</p></article><article><h3>这场面试已经问过什么</h3><p>避免重复，把注意力留给还没验证的证据。</p></article></div><blockquote class="question-proof rv">你如何判断哪些利益点需要从“全”升级为“优”？</blockquote></div></section>
<section class="slide" data-slide-id="interviewer-value" data-slide-title="面试官价值"><div class="slide-inner"><div class="eyebrow rv">对面试官的价值</div><h2 class="rv">把注意力还给眼前的候选人</h2><div class="feature-list rv"><article><b>专注倾听</b><span>不必一边判断，一边设计下一个问题。</span></article><article><b>关键证据不漏</b><span>P8 评分标准始终在上下文中。</span></article><article><b>结论有据</b><span>问题、原话和回答留在同一条时间线。</span></article></div></div></section>
<section class="slide" data-slide-id="glp-value" data-slide-title="GLP 价值"><div class="slide-inner"><div class="eyebrow rv">对 GLP 的价值</div><h2 class="rv">把“会面试”从个人手感，变成可复用的组织标准</h2><div class="card-grid three rv"><article><h3>证据更一致</h3></article><article><h3>真做过，更容易被看见</h3></article><article><h3>岗位标准可复用</h3></article><article><h3>少一次补问返工</h3></article><article><h3>候选人体验更专注</h3></article></div></div></section>
<section class="slide" data-slide-id="current" data-slide-title="当前能力"><div class="slide-inner"><div class="eyebrow rv">当前已经实现</div><h2 class="rv">不是概念图：这套流程现在就能完整跑通</h2><div class="capability-list rv"><span>可搜索 P7 / P8 岗位模板</span><span>豆包 Seed ASR 2.0 实时字幕</span><span>整段声纹角色归类与待确认保护</span><span>候选人确认后自动专家追问</span><span>统一备注、追问和转写时间线</span><span>面试总结与一次性会话重置</span></div></div></section>
<section class="slide close-slide" data-slide-id="close" data-slide-title="结尾"><div class="slide-inner close-layout"><div class="eyebrow rv">谢谢</div><h1 class="rv">让“会面试”，<br>不再只依赖个人手感</h1><p class="lead rv">把好问题、好标准和真实证据，交到每一位面试官手边。</p><div class="close-actions rv"><button id="close-replay" type="button">重播 P8 演示</button><button type="button" data-real-product-url="http://127.0.0.1:8004/">打开真实产品</button><button id="close-home" type="button">返回封面</button></div></div></section>
```

Add persistent status/header, counter, progress, nav buttons, key hint, `<audio id="demo-audio">`, a JSON marker `__DEMO_DATA__`, CSS marker `/*__DEMO_STYLES__*/`, JavaScript marker `/*__DEMO_SCRIPT__*/`, and audio marker `__DEMO_AUDIO_BASE64__` around the slide markup.

- [ ] **Step 4: Implement the slide controller**

Create `src/deck.mjs`:

```js
export function createDeck({ root = document, onSlideChange = () => {} } = {}) {
  const slides = [...root.querySelectorAll('[data-slide-id]')];
  const counter = root.querySelector('#deck-counter');
  const progress = root.querySelector('#deck-progress');
  const title = root.querySelector('#deck-title');
  let index = -1;

  function show(next) {
    const bounded = Math.max(0, Math.min(slides.length - 1, next));
    if (bounded === index && slides[index]?.classList.contains('is-active')) return;
    const previous = index >= 0 ? slides[index] : null;
    index = bounded;
    slides.forEach((slide, slideIndex) => slide.classList.toggle('is-active', slideIndex === index));
    counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    progress.style.transform = `scaleX(${(index + 1) / slides.length})`;
    title.textContent = slides[index].dataset.slideTitle;
    history.replaceState(null, '', `#${index + 1}`);
    onSlideChange({ index, id: slides[index].dataset.slideId, previousId: previous?.dataset.slideId });
  }

  const fromHash = Number.parseInt(location.hash.slice(1), 10);
  const initialIndex = Number.isFinite(fromHash) ? Math.max(0, Math.min(slides.length - 1, fromHash - 1)) : 0;
  root.querySelector('#deck-prev').addEventListener('click', () => show(index - 1));
  root.querySelector('#deck-next').addEventListener('click', () => show(index + 1));
  show(initialIndex);

  return { show, next: () => show(index + 1), previous: () => show(index - 1), getIndex: () => index };
}
```

The entry module handles context-sensitive keyboard ownership so Space/Left/Right control slides outside Slide 4 and the audio player while Slide 4 is active.

- [ ] **Step 5: Implement current GLP presentation styling**

In `styles.css`, define exact base tokens and slide mechanics:

```css
:root{--glp:#087a55;--glp-deep:#075c43;--ink:#283038;--muted:#727b84;--line:#dfe5e9;--paper:#fff;--canvas:#f5f6f7;--candidate:#089bd8;--interviewer:#f2a900;--expert:#00ad61;--radius:18px;--shadow:0 18px 60px rgba(32,43,50,.10)}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--canvas);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.slide{position:absolute;inset:52px 0 8px;display:grid;place-items:center;opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .12s ease,transform .24s ease,visibility 0s linear .24s}
.slide.is-active{opacity:1;visibility:visible;transform:none;transition-delay:0s}
.slide-inner{width:min(1440px,calc(100vw - 88px));height:calc(100vh - 112px);display:flex;flex-direction:column;justify-content:center;gap:22px}
.rv{opacity:0;transform:translateY(10px)}.is-active .rv{animation:reveal .38s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--delay,80ms)}
@keyframes reveal{to{opacity:1;transform:none}}
.card-grid{display:grid;gap:16px}.card-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.card-grid article,.feature-list article{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:22px;box-shadow:0 8px 28px rgba(32,43,50,.05)}
@media(max-width:900px){.slide-inner{width:calc(100vw - 40px)}.card-grid.three{grid-template-columns:1fr}.slide{overflow:auto}.demo-copy{display:none}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}.rv{transform:none}}
```

Add focused rules for the status strip, 72px headline scale, compact eyebrow, flow, feature list, capability chips, demo viewport, bottom progress, circular nav controls, dark theme variables, and all 1280×720 reductions. Do not copy embedded base64 screenshots or external font imports from the old deck.

- [ ] **Step 6: Run the deck test green and commit**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/deck.test.mjs
git diff --check
git add demo/interview-copilot-intro-p8/src demo/interview-copilot-intro-p8/test/deck.test.mjs
git commit -m 'feat: restore complete GLP introduction deck'
git push origin main
```

Expected: the deck test passes and the commit contains all nine slides without product replay logic.

---

### Task 3: Reconstruct the current product and deterministic P8 replay

**Files:**
- Create: `demo/interview-copilot-intro-p8/src/replay-state.mjs`
- Create: `demo/interview-copilot-intro-p8/src/player.mjs`
- Create: `demo/interview-copilot-intro-p8/src/entry.mjs`
- Modify: `demo/interview-copilot-intro-p8/src/index.template.html`
- Modify: `demo/interview-copilot-intro-p8/src/styles.css`
- Create: `demo/interview-copilot-intro-p8/test/replay-state.test.mjs`

**Interfaces:**
- Consumes: `cues`, `questionEvent`, `roleConfirmedMs`, and the Slide 4 product root.
- Produces: `deriveReplayState(timeMs)`, `createReplayPlayer(...)`, and a current-GLP product viewport synchronized to audio.

- [ ] **Step 1: Write failing deterministic-state tests**

Create `test/replay-state.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveReplayState } from '../src/replay-state.mjs';
import { cues, questionEvent, roleConfirmedMs } from '../src/timeline.mjs';

const stateAt = (timeMs) => deriveReplayState({ timeMs, cues, questionEvent, roleConfirmedMs });

test('candidate confirmation alone unlocks monitoring', () => {
  assert.equal(stateAt(roleConfirmedMs - 1).candidateRole, 'pending');
  assert.equal(stateAt(roleConfirmedMs).candidateRole, 'candidate');
  assert.equal(stateAt(roleConfirmedMs).monitorState, 'monitoring');
});

test('generation and one question occur in evidence order', () => {
  assert.equal(stateAt(questionEvent.generatingMs - 1).monitorState, 'monitoring');
  assert.equal(stateAt(questionEvent.generatingMs).monitorState, 'generating');
  assert.equal(stateAt(questionEvent.revealMs - 1).questionVisible, false);
  const revealed = stateAt(questionEvent.revealMs);
  assert.equal(revealed.questionVisible, true);
  assert.equal(revealed.visibleQuestions.length, 1);
  assert.equal(revealed.visibleQuestions[0].anchorCueId, 'p8-5');
});

test('seeking backward reconstructs state without sticky question data', () => {
  assert.equal(stateAt(80000).questionVisible, true);
  assert.equal(stateAt(30000).questionVisible, false);
});
```

- [ ] **Step 2: Run the state tests red**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/replay-state.test.mjs
```

Expected: FAIL because `replay-state.mjs` does not exist.

- [ ] **Step 3: Implement the pure replay state machine**

Create `src/replay-state.mjs`:

```js
export function splitGraphemes(text) {
  if (globalThis.Intl?.Segmenter) return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  return Array.from(text);
}

function visibleText(cue, timeMs) {
  if (timeMs >= cue.endMs) return cue.text;
  if (timeMs <= cue.startMs) return '';
  const graphemes = splitGraphemes(cue.text);
  const ratio = (timeMs - cue.startMs) / Math.max(1, cue.endMs - cue.startMs);
  return graphemes.slice(0, Math.max(1, Math.floor(graphemes.length * ratio))).join('');
}

export function deriveReplayState({ timeMs, cues, questionEvent, roleConfirmedMs }) {
  const boundedTime = Math.max(0, timeMs);
  const visibleCues = cues
    .filter((cue) => cue.startMs <= boundedTime)
    .map((cue) => ({ ...cue, visibleText: visibleText(cue, boundedTime), isLive: boundedTime < cue.endMs }));
  const candidateRole = boundedTime >= roleConfirmedMs ? 'candidate' : 'pending';
  const questionVisible = boundedTime >= questionEvent.revealMs;
  const monitorState = questionVisible
    ? 'question-ready'
    : boundedTime >= questionEvent.generatingMs
      ? 'generating'
      : candidateRole === 'candidate'
        ? 'monitoring'
        : 'waiting-candidate';
  return {
    timeMs: boundedTime,
    candidateRole,
    monitorState,
    visibleCues,
    questionVisible,
    visibleQuestions: questionVisible ? [questionEvent] : []
  };
}
```

- [ ] **Step 4: Add the Slide 4 current-product markup**

Inside `#product-replay`, use this hierarchy:

```html
<div class="copilot-shell">
  <header class="copilot-header"><div class="copilot-brand"><strong>GLP</strong><span>用户运营专家（P8）</span></div><div class="copilot-live"><i></i><span id="replay-status">真实产品数据回放</span></div><button id="theme-toggle" aria-label="切换深色主题">◐</button></header>
  <div class="copilot-meta"><span>P8 · 组织级策略与业务影响</span><span id="role-monitor">等待候选人证据</span><time id="replay-clock">00:00</time></div>
  <div id="replay-timeline" class="replay-timeline" aria-live="polite"></div>
  <div class="replay-start" id="replay-start"><button id="replay-start-button" type="button">播放 1 分 40 秒真实演示</button><small>真实 P8 面试录音 · 点击后播放声音</small></div>
  <footer class="replay-controls"><button id="replay-play" aria-label="播放或暂停">▶</button><button id="replay-mute" aria-label="静音或恢复声音">声音</button><input id="replay-progress" type="range" min="0" max="100409" value="0" aria-label="演示进度"><span id="replay-time">00:00 / 01:40</span><button id="replay-reset">重新播放</button><button type="button" data-real-product-url="http://127.0.0.1:8004/">打开真实产品</button></footer>
</div>
```

Transcript rows display timestamp, icon, role label, role-choice pills, and visible text. The question card is inserted immediately after cue `p8-5` and displays `AI 追问`, `自动`, `专家`, the full question, `候选人证据`, `3,026 词元`, and `3.7 s`.

- [ ] **Step 5: Implement the audio-authoritative player**

Create `src/player.mjs` exporting `createReplayPlayer({ root, audio, timeline })`. It must:

```js
const masterTime = () => Math.round(audio.currentTime * 1000);
const render = () => {
  const state = deriveReplayState({ timeMs: masterTime(), ...timeline });
  renderTimeline(root.querySelector('#replay-timeline'), state, timeline.questionEvent);
  renderStatus(root, state);
  root.querySelector('#replay-progress').value = String(Math.min(timeline.DEMO_DURATION_MS, state.timeMs));
  if (!audio.paused && !audio.ended) frame = requestAnimationFrame(render);
};
```

Use event listeners for `play`, `pause`, `timeupdate`, `seeked`, `ended`, `error`, `visibilitychange`, the range input, mute, reset, and start button. `renderTimeline` derives the entire DOM from state on every meaningful time change so backward seeking removes future rows/question state. It scrolls to the newest row only when the viewer was already within 48px of the bottom.

If `audio.play()` is rejected, keep the start overlay and render no silent progress. If decoding emits `error`, show `音频未能加载，可继续查看演示` and enable a clearly labelled `静音查看` action whose monotonic `performance.now()` clock starts only from that second user gesture. `visibilitychange` pauses either clock. The optional local-product buttons call `window.open(button.dataset.realProductUrl, '_blank', 'noopener')` and never participate in offline readiness.

- [ ] **Step 6: Wire deck and replay keyboard ownership**

Create `src/entry.mjs` to import `createDeck`, `createReplayPlayer`, and timeline exports. Outside Slide 4, Left/Right/Page keys/Space navigate slides, Home/End jump, and `F` toggles fullscreen. On active Slide 4 after playback begins, Space toggles audio, Left/Right seek five seconds, `M` toggles mute, and Escape returns to deck controls. Navigating away calls `player.pause()`. Any deck interaction adds `is-used` to the key hint so CSS fades it without removing it from accessibility APIs.

- [ ] **Step 7: Style the product reconstruction from current GLP tokens**

Add focused CSS for `.copilot-shell`, `.copilot-header`, `.copilot-meta`, `.replay-timeline`, `.transcript-row[data-role]`, `.role-pill`, `.question-card`, `.replay-controls`, live caret, status dot, dark theme, and 720p compaction. Use `--interviewer`, `--candidate`, and `--expert` tokens; never blur the workspace behind the start overlay. The overlay uses a translucent white surface with the transcript shell still legible.

- [ ] **Step 8: Run focused tests green and commit**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/timeline.test.mjs demo/interview-copilot-intro-p8/test/deck.test.mjs demo/interview-copilot-intro-p8/test/replay-state.test.mjs
git diff --check
git add demo/interview-copilot-intro-p8/src demo/interview-copilot-intro-p8/test
git commit -m 'feat: add current P8 interviewer replay'
git push origin main
```

Expected: all focused tests pass and the question state is fully reversible by time.

---

### Task 4: Build and validate the one-file offline artifact

**Files:**
- Create: `demo/interview-copilot-intro-p8/scripts/build.mjs`
- Create: `demo/interview-copilot-intro-p8/test/artifact.test.mjs`
- Generate: `demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html`

**Interfaces:**
- Consumes: template, CSS, ESM entry graph, timeline, and MP3.
- Produces: one standalone HTML and optional copy command for Downloads.

- [ ] **Step 1: Write the failing artifact test**

Create `test/artifact.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const artifactUrl = new URL('../dist/Interview Copilot P8 Complete Introduction.html', import.meta.url);

test('built artifact is a complete offline P8 introduction', async () => {
  const html = await readFile(artifactUrl, 'utf8');
  assert.equal((html.match(/data-slide-id=/g) ?? []).length, 9);
  assert.match(html, /data:audio\/mpeg;base64,[A-Za-z0-9+/=]+/);
  assert.match(html, /用户运营专家（P8）/);
  assert.match(html, /为什么这句追问值得问/);
  assert.match(html, /3,026 词元/);
  assert.match(html, /3\.7 s/);
  assert.match(html, /真实产品数据回放/);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\.|src="(?!data:)|href="https?:\/\//i);
  assert.doesNotMatch(html, /物业|消防|园区运营/);
  assert.doesNotMatch(html, /__DEMO_(?:DATA|STYLES|SCRIPT|AUDIO_BASE64)__/);
});
```

The negative URL assertion allows the explicit local `http://127.0.0.1:8004/` link by changing it to `data-real-product-url="http://127.0.0.1:8004/"` plus a click handler; no external stylesheet/script/image/audio URL remains.

- [ ] **Step 2: Run the artifact test red**

Run:

```bash
node --test demo/interview-copilot-intro-p8/test/artifact.test.mjs
```

Expected: FAIL with `ENOENT` for the dist HTML.

- [ ] **Step 3: Implement the deterministic builder**

Create `scripts/build.mjs`:

```js
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as timeline from '../src/timeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(here, '..');
const repoRoot = path.resolve(demoRoot, '..', '..');
const require = createRequire(import.meta.url);
const esbuild = require(path.join(repoRoot, 'web-app/node_modules/esbuild'));
const copyToDownloads = process.argv.includes('--copy');

const [template, styles, audio] = await Promise.all([
  readFile(path.join(demoRoot, 'src/index.template.html'), 'utf8'),
  readFile(path.join(demoRoot, 'src/styles.css'), 'utf8'),
  readFile(path.join(demoRoot, 'assets/p8-card-channel-100s.mp3'))
]);
const bundle = await esbuild.build({ entryPoints: [path.join(demoRoot, 'src/entry.mjs')], bundle: true, format: 'iife', target: ['chrome120'], minify: false, write: false });
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const data = JSON.stringify({ ...timeline, cues: timeline.cues, questionEvent: timeline.questionEvent }).replaceAll('<', '\\u003c');
const html = template
  .replace('/*__DEMO_STYLES__*/', styles)
  .replace('/*__DEMO_SCRIPT__*/', bundle.outputFiles[0].text)
  .replace('__DEMO_DATA__', data)
  .replace('__DEMO_AUDIO_BASE64__', audio.toString('base64'))
  .replace('__BUILD_COMMIT__', commit);
const distDir = path.join(demoRoot, 'dist');
const artifact = path.join(distDir, 'Interview Copilot P8 Complete Introduction.html');
await mkdir(distDir, { recursive: true });
await writeFile(artifact, html);
if (copyToDownloads) await copyFile(artifact, '/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html');
console.log(artifact);
```

- [ ] **Step 4: Build and run all demo tests**

Run:

```bash
node demo/interview-copilot-intro-p8/scripts/build.mjs --copy
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
shasum -a 256 'demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html' '/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html'
```

Expected: all tests pass and both HTML hashes match.

- [ ] **Step 5: Commit the build pipeline and first artifact**

Run:

```bash
git add demo/interview-copilot-intro-p8/scripts demo/interview-copilot-intro-p8/test/artifact.test.mjs 'demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html'
git commit -m 'build: package offline P8 introduction'
git push origin main
```

---

### Task 5: Iteration 1 — preserve the complete introduction story

**Files:**
- Create: `docs/qa/2026-07-22-interview-copilot-p8-html-demo.md`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/index.template.html`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/styles.css`
- Modify: matching demo test file.

**Interfaces:**
- Consumes: legacy introduction, design spec, built artifact.
- Produces: one real narrative/pacing correction plus Round 1 before/after evidence.

- [ ] **Step 1: Create the QA journal contract**

Create the journal with fixture hash, artifact hash, build commit, browser, viewport, exact reproduction, viewer impact, first divergent boundary, red assertion/measurement, fix, green evidence, screenshots, remaining risk, and commit for each of five rounds.

- [ ] **Step 2: Present every slide in order without entering the demo**

Open the artifact from `file://`, navigate Cover → Problem → Solution → P8 Proof → Grounding → Interviewer Value → GLP Value → Current → Close using only keyboard. Record the first failed item from this ordered audit:

1. A legacy introduction section is missing.
2. The product is explained before the problem is clear.
3. A slide needs presenter narration to be understood.
4. A claim is outdated, unsupported, or references a retired feature.
5. Copy or controls overflow 1280×720.

- [ ] **Step 3: Turn the first observed failure into a focused red test**

Add the exact missing copy/structure/overflow assertion to `deck.test.mjs`. For measured overflow, add a stable marker/class assertion and verify the failing browser measurement in the journal. Run the test and record the failure output.

- [ ] **Step 4: Fix the source of the narrative failure**

Edit only the responsible template/copy/layout rule, rebuild, and rerun the nine-slide presentation. Do not shorten the deck by deleting required introduction sections.

- [ ] **Step 5: Record, commit, copy, and push Round 1**

Run all demo tests, rebuild with `--copy`, record before/after evidence, then commit:

```bash
git add demo/interview-copilot-intro-p8 docs/qa/2026-07-22-interview-copilot-p8-html-demo.md
git commit -m 'fix: clarify P8 introduction story'
git push origin main
```

---

### Task 6: Iteration 2 — match the current product visually

**Files:**
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/index.template.html`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/styles.css`
- Modify: `docs/qa/2026-07-22-interview-copilot-p8-html-demo.md`
- Modify: matching demo test file.

**Interfaces:**
- Consumes: current app at `http://127.0.0.1:8004/`, current CSS/components, Round 1 artifact.
- Produces: one verified visual-fidelity correction.

- [ ] **Step 1: Capture equal-size current-app and demo evidence**

At 1440×900 and 1920×1080, capture the current live transcript workspace and Slide 4 at the same role/question state. Compare header hierarchy, transcript width, role colors, timeline spacing, candidate/interviewer labels, question-card placement, token/latency footer, scroll affordance, and light/dark icon.

- [ ] **Step 2: Select the highest-salience mismatch**

Use this priority: question detached from anchor → role hierarchy wrong → transcript unreadable → current GLP colors/surfaces wrong → secondary spacing mismatch. Record only the first mismatch as Round 2's problem.

- [ ] **Step 3: Add a focused assertion and observe red**

Encode the responsible structural class/data attribute in `deck.test.mjs` or `artifact.test.mjs`, or record the exact pixel/DOM measurement if the mismatch is purely geometric. Preserve the before screenshot.

- [ ] **Step 4: Fix the causal markup/token/layout rule and verify**

Rebuild, recapture both viewports, and require the intended relationship rather than subjective “looks better” evidence. Examples: question card's DOM immediately follows its anchor row; transcript client width stays within 8% of the live product; role hues match current CSS variables.

- [ ] **Step 5: Record, commit, copy, and push Round 2**

```bash
git add demo/interview-copilot-intro-p8 docs/qa/2026-07-22-interview-copilot-p8-html-demo.md
git commit -m 'fix: align P8 replay with current product'
git push origin main
```

---

### Task 7: Iteration 3 — calibrate audio, captions, pause, and seek

**Files:**
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/timeline.mjs`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/replay-state.mjs`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/player.mjs`
- Modify: `docs/qa/2026-07-22-interview-copilot-p8-html-demo.md`
- Modify: matching replay test.

**Interfaces:**
- Consumes: real 100.409-second audio and deterministic state.
- Produces: absolute visible cue drift no greater than 250ms after uninterrupted play, pause/resume, and backward/forward seek.

- [ ] **Step 1: Run the complete audio once and sample state**

At replay times 0, 10, 25, 47.889, 51.620, 75, and 100 seconds, record `audio.currentTime`, visible active cue, visible grapheme count, role state, monitor state, and question visibility. Repeat after pausing for five seconds at 30s and after seeking from 70s back to 35s.

- [ ] **Step 2: Identify the first synchronization defect**

Choose the earliest of: wrong utterance active, drift over 250ms, partial text jumps as a block, pause advances UI, backward seek leaves future rows/question, audio duration differs by over 100ms, or end state does not settle.

- [ ] **Step 3: Add the exact time-state regression and observe red**

Add a boundary assertion to `timeline.test.mjs` or `replay-state.test.mjs`. For audio-decoder drift, record the browser measurement and add an artifact metadata assertion that guards the corrected clip duration.

- [ ] **Step 4: Correct the earliest divergent boundary**

Change cue timing when the transcript begins wrong; change state derivation when seek/pause is sticky; re-encode only if actual audio duration is wrong. Keep `audio.currentTime` authoritative.

- [ ] **Step 5: Replay the full clip, record, commit, copy, and push Round 3**

Require all seven checkpoints within 250ms and no future state after the backward seek, then commit:

```bash
git add demo/interview-copilot-intro-p8 docs/qa/2026-07-22-interview-copilot-p8-html-demo.md
git commit -m 'fix: synchronize P8 audio and captions'
git push origin main
```

---

### Task 8: Iteration 4 — prove candidate-first Auto question behavior

**Files:**
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/timeline.mjs`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/replay-state.mjs`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/player.mjs`
- Modify as evidence requires: `demo/interview-copilot-intro-p8/src/index.template.html`
- Modify: `docs/qa/2026-07-22-interview-copilot-p8-html-demo.md`
- Modify: matching replay/artifact test.

**Interfaces:**
- Consumes: verified candidate role, generating/reveal timestamps, anchor cue, telemetry.
- Produces: one faithful candidate-first question story.

- [ ] **Step 1: Observe the replay from 0 through 60 seconds without seeking**

Record screenshots/DOM at `8.499s`, `8.500s`, `47.888s`, `47.889s`, `51.619s`, and `51.620s`.

- [ ] **Step 2: Select the first semantic failure**

Audit in order: candidate is not confirmed before monitoring; UI implies interviewer confirmation is required; generation starts before candidate evidence; question is visible before completion; question is not immediately below `p8-5`; telemetry differs from `3.731s / 3,026 词元`; more than one question appears.

- [ ] **Step 3: Add the exact state/DOM assertion and observe red**

Use `replay-state.test.mjs` for state order and `artifact.test.mjs` for DOM copy/telemetry. Preserve the failing timestamp evidence.

- [ ] **Step 4: Fix only the causal state or render boundary**

Do not change verified question copy or telemetry to make the UI easier. Rebuild and rerun all six timestamps plus a backward seek from 60s to 40s.

- [ ] **Step 5: Record, commit, copy, and push Round 4**

```bash
git add demo/interview-copilot-intro-p8 docs/qa/2026-07-22-interview-copilot-p8-html-demo.md
git commit -m 'fix: clarify candidate-first Expert follow-up'
git push origin main
```

---

### Task 9: Iteration 5 — offline portability and presentation readiness

**Files:**
- Modify as evidence requires: demo source/build/test files.
- Modify: `docs/qa/2026-07-22-interview-copilot-p8-html-demo.md`
- Generate/copy: final dist and Downloads HTML.

**Interfaces:**
- Consumes: Round 4 artifact.
- Produces: final presentation-ready single file and one verified portability correction.

- [ ] **Step 1: Test the copied file from `file://` with network unavailable**

In both Chrome and the in-app browser, open `/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html`. Exercise all nine slides, fullscreen, theme, keyboard, reduced motion, P8 play/pause, mute, 5s seek, replay, leave/return to Slide 4, and the complete 100.409-second playback at 1280×720, 1440×900, and 1920×1080.

- [ ] **Step 2: Select the highest-impact remaining presentation blocker**

Use this priority: cannot open/play offline → missing sound → navigation trap → core content clipping → replay state loss/corruption → unreadable controls → reduced-motion violation → minor polish.

- [ ] **Step 3: Add a regression or measured gate and observe failure**

Use `artifact.test.mjs` for portability/resource issues, deck/state tests for behavior, or exact browser geometry for viewport clipping. Record the failing device/browser/viewport and screenshot.

- [ ] **Step 4: Fix, rebuild, and rerun the entire deck and audio**

No acceptance is based on a partial clip. The final browser run must cover every slide and the entire P8 excerpt without network.

- [ ] **Step 5: Record, commit, copy, and push Round 5**

```bash
node demo/interview-copilot-intro-p8/scripts/build.mjs --copy
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
git add demo/interview-copilot-intro-p8 docs/qa/2026-07-22-interview-copilot-p8-html-demo.md
git commit -m 'fix: finish portable P8 presentation'
git push origin main
```

---

### Task 10: Final documentation, repository verification, and handoff

**Files:**
- Create: `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/html-p8-introduction-demo.md`
- Modify: `docs/qa/2026-07-22-interview-copilot-p8-html-demo.md`
- Verify: all demo source, tests, dist, and Downloads copy.

**Interfaces:**
- Consumes: five round records and final artifact.
- Produces: implementation note, completion audit, clean pushed `main`, and ready-to-open Downloads file.

- [ ] **Step 1: Write the implementation note**

The note must contain:

- Purpose — complete offline GLP introduction with a verified P8 proof slide.
- Entry points — template, timeline, replay state, deck, player, build script, tests, dist.
- Data flow — source clip → timeline → audio clock → state → transcript/question → builder → single HTML.
- Config/state — source timestamps, duration, candidate confirmation, generating/reveal times, anchor, telemetry, slide index, audio time.
- Gotchas — source extension mismatch, autoplay gesture, `file://` resource rules, deck/player keyboard ownership, backward-seek reconstruction, pause on slide exit, truthful replay label.

- [ ] **Step 2: Run fresh demo and production verification**

Run:

```bash
node demo/interview-copilot-intro-p8/scripts/build.mjs --copy
node --test demo/interview-copilot-intro-p8/test/*.test.mjs
cd web-app && npm test && npm run build && cd ..
git diff --check
shasum -a 256 'demo/interview-copilot-intro-p8/dist/Interview Copilot P8 Complete Introduction.html' '/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html'
```

Expected: every demo test and all production suites pass; production build exits zero; dist/copy hashes match; no whitespace errors.

- [ ] **Step 3: Complete the requirement audit**

In the QA journal, map each explicit requirement to evidence: complete intro, slide style, current UI reconstruction, P8-only content, 60–120-second audio, progressive captions, candidate-first monitoring, one inline question, real telemetry, value explanation, offline single file, controls/accessibility, five actual problems/fixes, commits/pushes, Downloads copy.

- [ ] **Step 4: Commit and push final documentation if it changed after Round 5**

```bash
git add docs/qa/2026-07-22-interview-copilot-p8-html-demo.md demo/interview-copilot-intro-p8
git commit -m 'docs: complete P8 HTML demo acceptance'
git push origin main
git status --short --branch
```

Expected: `main...origin/main` with no app-repository changes; the Obsidian note remains in its own vault workflow.

- [ ] **Step 5: Leave the final artifact open**

Open `/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html` at Slide 1 and leave audio stopped. The user can start the full presentation immediately and reach the P8 proof slide with three Right-arrow presses.
