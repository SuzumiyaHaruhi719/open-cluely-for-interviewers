import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const artifactUrl = new URL('../dist/Interview Copilot P8 Complete Introduction.html', import.meta.url);

test('built artifact is a complete offline P8 introduction', async () => {
  const html = await readFile(artifactUrl, 'utf8');
  const frameMatch = html.match(/<iframe[^>]+class="live-demo-frame"[^>]+src="data:text\/html;base64,([A-Za-z0-9+/=]+)"/i);
  assert.ok(frameMatch, 'literal product iframe is embedded');
  const productFrame = Buffer.from(frameMatch[1], 'base64').toString('utf8');
  assert.equal((html.match(/data-slide-id=/g) ?? []).length, 9);
  assert.match(productFrame, /data:audio\/mpeg;base64,[A-Za-z0-9+/=]+/);
  assert.match(productFrame, /00:00 \/ 08:13/);
  assert.match(productFrame, /max="493517"/);
  assert.doesNotMatch(html, /播放 1 分 40 秒真实演示/);
  assert.match(productFrame, /用户运营专家（P8）/);
  assert.match(html, /为什么这句追问值得问/);
  assert.match(productFrame, /3,026 词元/);
  assert.match(productFrame, /3\.7 s/);
  assert.match(productFrame, /为什么这样问/);
  assert.match(productFrame, /预期证据/);
  assert.match(productFrame, /class="one-shot-app one-shot-app--live"/);
  assert.match(productFrame, /class="summary-modal"/);
  assert.match(productFrame, /真实产品数据回放/);
  assert.match(html, /data:image\/png;base64,[A-Za-z0-9+/=]+/);
  assert.match(html, /GLP-dark 设计令牌 \(v2\.0\)/);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\.|src="https?:\/\/|href="https?:\/\//i);
  assert.doesNotMatch(productFrame, /fonts\.googleapis|cdn\.|src="https?:\/\/|href="https?:\/\//i);
  assert.doesNotMatch(html, /物业|消防|园区运营/);
  assert.doesNotMatch(productFrame, /物业|消防|园区运营/);
  assert.doesNotMatch(html, /__(?:DEMO|PRODUCT)_[A-Z0-9_]+__/);
  assert.doesNotMatch(productFrame, /__(?:DEMO|PRODUCT|ICON)_[A-Z0-9_]+__/);
});
