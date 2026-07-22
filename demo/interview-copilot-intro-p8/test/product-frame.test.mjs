import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../src/product-frame.template.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/product-frame.css', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/product-frame.mjs', import.meta.url), 'utf8');

test('product frame uses the production interview-workspace hierarchy', () => {
  for (const signature of [
    'class="one-shot-app one-shot-app--live"',
    'class="interview-header"',
    'class="interview-workspace"',
    'class="chat-messages"',
    'class="context-drawer"',
    'class="interview-dock"',
    'class="chat-message lane-ai is-question-card"',
    'class="summary-modal"'
  ]) assert.match(html, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /copilot-shell|replay-app|replay-seal/);
});

test('theme control uses the production GLP ghost-icon button', () => {
  assert.match(html, /id="theme-toggle" class="glp-theme-toggle interview-header__theme"/);
  assert.doesNotMatch(html, /id="theme-toggle" class="theme-toggle/);
});

test('Expert question exposes the full decision logic', () => {
  assert.match(html, /候选人原话/);
  assert.match(html, /为什么这样问/);
  assert.match(html, /预期证据/);
  assert.match(html, /3,026 词元/);
  assert.match(html, /3\.7 s/);
  assert.match(html, /vexpert_flash_v2/);
});

test('context and completion summary are full product surfaces', () => {
  for (const label of ['能力维度', '已追问主题', '仍待验证', '完整记录 48 条', 'P8 评分模板', 'DeepSeek 专家评分']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(runtime, /contextAutoOpen/);
  assert.match(runtime, /summaryVisible/);
  assert.match(runtime, /pause-product-frame/);
});

test('demo-only CSS does not redraw the production system', () => {
  assert.doesNotMatch(css, /\.one-shot-app\s*\{|\.interview-header\s*\{|\.summary-modal\s*\{/);
  assert.match(css, /\.demo-replay-scrubber/);
});

test('accessibility copy stays out of the product grid and full questions align from the top', () => {
  assert.match(css, /\.sr-only\s*\{[^}]*position:\s*absolute\s*!important/s);
  assert.match(runtime, /chat\.scrollTop\s*=\s*Math\.max\(0,\s*card\.offsetTop\s*-\s*8\)/);
});

test('backward seeking after completion resumes from the selected time', () => {
  assert.match(runtime, /if\s*\(currentTimeMs\(\)\s*>=\s*DEMO_DURATION_MS\)/);
  assert.doesNotMatch(runtime, /if\s*\(audio\.ended\s*\|\|/);
});

test('replay progress remains visible and informative inside the embedded product', () => {
  assert.match(html, /class="interview-dock__recording demo-replay-timeline"/);
  assert.match(css, /\.demo-replay-timeline\s*\{[^}]*display:\s*grid[^}]*position:\s*absolute[^}]*left:\s*24px[^}]*right:\s*24px/s);
  assert.match(css, /\.demo-replay-scrubber\s*\{[^}]*--replay-percent:/s);
  assert.match(runtime, /progress\.style\.setProperty\('--replay-percent'/);
  assert.match(runtime, /progress\.setAttribute\('aria-valuetext'/);
});

test('product frame replays the complete P8 source instead of the old excerpt', () => {
  assert.match(runtime, /from '\.\/full-timeline\.mjs'/);
  assert.match(html, /max="493517"/);
  assert.match(html, /00:00 \/ 08:13/);
  assert.match(html, /data:audio\/mpeg;base64,__DEMO_AUDIO_BASE64__/);
  assert.doesNotMatch(html, /01:24|audio\/mp4/);
});

test('live captions preserve the Copilot row while patching progressive text', () => {
  assert.match(runtime, /data-live-caption="visual" aria-hidden="true"/);
  assert.match(runtime, /class="live-caption__sr" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(runtime, /LIVE_CAPTION_INTERVAL_MS/);
  assert.match(runtime, /setInterval\(advanceLiveCaptions, LIVE_CAPTION_INTERVAL_MS\)/);
  assert.match(runtime, /function patchTimelineText\(state\)/);
  assert.match(runtime, /timelineStructureSignature\(/);
  assert.doesNotMatch(runtime, /visibleText\.length/);
});

test('complete replay exposes a transparent and interruptible 60× fast-forward', () => {
  assert.match(html, /id="fast-forward"/);
  assert.match(html, /快进至总结/);
  assert.match(runtime, /from '\.\/fast-forward\.mjs'/);
  assert.match(runtime, /audio\.muted\s*=\s*true/);
  assert.match(runtime, /cancelFastForward/);
  assert.match(runtime, /60× 快进中/);
  assert.match(css, /\.demo-fast-forward/);
});

test('summary modal replays the real production pipeline and complete scored report', () => {
  assert.match(html, /id="summary-pipeline"/);
  assert.match(html, /id="summary-progress-fill"/);
  assert.match(html, /完整记录 48 条/);
  assert.match(html, /P8 评分模板/);
  assert.match(html, /DeepSeek/);
  assert.match(runtime, /from '\.\/summary-replay\.mjs'/);
  assert.match(runtime, /startSummaryReplay/);
  assert.match(runtime, /renderSummaryMarkdown/);
  assert.doesNotMatch(html, /1 分 24 秒|证据不足，暂不建议下最终结论/);
  assert.match(css, /\.summary-pipeline/);
});
