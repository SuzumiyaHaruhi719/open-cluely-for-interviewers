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

test('Expert question exposes the full decision logic', () => {
  assert.match(html, /候选人原话/);
  assert.match(html, /为什么这样问/);
  assert.match(html, /预期证据/);
  assert.match(html, /3,026 词元/);
  assert.match(html, /3\.7 s/);
  assert.match(html, /vexpert_flash_v2/);
});

test('context and completion summary are full product surfaces', () => {
  for (const label of ['能力维度', '已追问主题', '仍待验证', '综合判断', '已展示信号', '风险与未验证项', '建议补充证据']) {
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
