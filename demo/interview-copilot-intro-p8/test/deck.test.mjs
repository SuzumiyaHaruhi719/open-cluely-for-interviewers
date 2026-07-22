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
  assert.match(css, /\.slide\.is-active/);
  assert.doesNotMatch(html, /物业|消防|园区运营/);
});

test('P8 proof keeps deck navigation clear of replay controls', () => {
  assert.match(deckScript, /body\.dataset\.activeSlide\s*=/);
  assert.match(css, /body\[data-active-slide="p8-demo"\]\s+\.deck-nav\s*\{[^}]*left:\s*26px[^}]*right:\s*auto/s);
});
