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
    'P8 面试流程与自动追问演示',
    '面试中需要同时记录回答、评估证据并决定追问',
    '系统在候选人原话下方显示一个建议追问',
    '声音、字幕、角色与追问按同一时间轴回放',
    '问题生成参考三类上下文',
    '系统在转写旁显示追问与证据上下文',
    '岗位标准、追问和证据采用统一结构',
    '当前版本包含岗位模板、Seed ASR 2.0 与自动追问',
    '面试流程演示：从岗位准备到面试总结'
  ]) assert.match(html, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /id="deck-prev"/);
  assert.match(html, /id="deck-next"/);
  assert.match(html, /id="deck-progress"/);
  assert.match(html, /id="deck-counter"/);
  assert.match(css, /\.slide\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.slide\.active/);
  assert.doesNotMatch(html, /物业|消防|园区运营/);
});

test('GLP value slide stays compact at the narrow presentation breakpoint', () => {
  assert.match(html, /class="slide value-slide"[^>]*data-slide-id="glp-value"/);
  assert.match(html, /class="grid g3 value-grid"/);
  assert.match(css, /\.value-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media\s*\(max-width:900px\)[\s\S]*?\.value-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
});

test('outer deck copy is descriptive and evidence-backed rather than promotional', () => {
  for (const copy of [
    '演示内容包括实时转写、声纹角色、证据缺口监测、追问和面试总结。',
    '未被追问的证据缺口会在面试总结与评分中保持未验证状态。',
    '建议问题由面试官决定是否采用，系统不替代候选人回答或面试判断。',
    '面试官决定是否采用建议问题，系统不替代面试判断。',
    '岗位标准、追问和证据采用统一结构',
    '当前版本包含岗位模板、Seed ASR 2.0 与自动追问',
    '面试流程演示：从岗位准备到面试总结',
    '流程包括岗位与简历准备、实时转写、追问和面试总结。'
  ]) assert.match(html, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const rejected of [
    '让每一场面试，都问到点子上',
    '最该追问的那一句',
    '招聘的成败在面试间里',
    '面试是最难做好的工作',
    '每一场没问到点子上的面试',
    '隐形成本',
    '30 分钟，分不出背稿和实干',
    '业务骨干不是职业面试官',
    '十个面试官，十把尺子',
    '没问到的证据不会出现在任何报告里',
    '我们的答案 · 一句话讲完',
    '只帮面试官问出更好的问题',
    '为什么这句追问值得问',
    '每一句追问，背后都有三份可检查的依据',
    '把注意力还给眼前的候选人',
    '专注倾听，不再分心设计问题',
    '关键证据，一个不漏',
    '被全神贯注地问到点子上',
    '本身就是专业度',
    '看清真实贡献',
    '现场补齐证据',
    '面试官专心听',
    '选好岗位和简历，就可以直接开始面试',
    '不是概念图：这套流程现在就能完整跑通',
    '让“会面试”，不再只依赖个人手感',
    '把好问题、好标准和真实证据，交到每一位面试官手边',
    '带上一个岗位，我们现场试一场',
    '上传 JD 和简历后就能开始；转写、追问和总结都在同一条时间线上。'
  ]) assert.doesNotMatch(html, new RegExp(rejected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
