import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../src/index.template.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const deckScript = await readFile(new URL('../src/deck.mjs', import.meta.url), 'utf8');

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
  assert.match(css, /\.slide\.active/);
  assert.doesNotMatch(html, /物业|消防|园区运营/);
});

test('presentation directly reuses the legacy GLP value-deck visual system', () => {
  for (const legacyStructure of [
    'class="statusbar"',
    'class="deck"',
    'class="slide hero-slide active"',
    'class="wrap"',
    'class="cols c55"',
    'class="shot',
    'class="progress"',
    'class="navctl"',
    'class="nbtn"'
  ]) assert.match(html, new RegExp(legacyStructure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(css, /--surface-page:\s*#0F1115/);
  assert.match(css, /--surface-elevated:\s*#1C2028/);
  assert.match(css, /--brand-500:\s*#2FD47A/);
  assert.match(css, /\.statusbar\s*\{[^}]*height:\s*36px/s);
  assert.match(css, /\.wrap\s*\{[^}]*max-width:\s*1240px/s);
  assert.match(css, /h1\s*\{[^}]*clamp\(38px,\s*4\.6vw,\s*56px\)/s);
  assert.match(css, /\.slide\.active/);
  assert.doesNotMatch(html, /hero-orbit/);
  assert.doesNotMatch(css, /--canvas:\s*#f5f6f7/i);
});

test('P8 proof keeps deck navigation clear of replay controls', () => {
  assert.match(deckScript, /body\.dataset\.activeSlide\s*=/);
  assert.match(css, /body\[data-active-slide="p8-demo"\]\s+\.navctl\s*\{[^}]*top:\s*48px[^}]*right:\s*20px[^}]*bottom:\s*auto/s);
});

test('P8 proof gives the reconstructed workspace full slide width', () => {
  assert.match(css, /\.live-demo-slide\s+\.wrap\s*\{[^}]*max-width:\s*1540px[^}]*padding:\s*0\s+18px/s);
  assert.match(css, /\.live-demo-shell\s*\{[^}]*height:\s*min\(735px,\s*calc\(100vh\s*-\s*152px\)\)/s);
});

test('P8 proof embeds the literal product page instead of a schematic replay', () => {
  assert.match(html, /<div class="live-demo-shell[^>]*>\s*<iframe class="live-demo-frame"/s);
  assert.match(html, /id="product-frame-payload"[^>]*>__PRODUCT_FRAME_BASE64__<\/script>/);
  assert.match(html, /title="面试官 Copilot · P8 真实产品回放"/);
  assert.doesNotMatch(html, /id="product-replay"|class="replay-app"|class="copilot-shell"/);
});
