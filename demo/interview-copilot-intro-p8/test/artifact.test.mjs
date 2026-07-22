import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const artifactUrl = new URL('../dist/Interview Copilot P8 Complete Introduction.html', import.meta.url);

test('built artifact is a complete offline P8 introduction', async () => {
  const html = await readFile(artifactUrl, 'utf8');
  assert.equal((html.match(/data-slide-id=/g) ?? []).length, 9);
  assert.match(html, /data:audio\/mp4;base64,[A-Za-z0-9+/=]+/);
  assert.match(html, /播放 1 分 24 秒真实演示/);
  assert.doesNotMatch(html, /播放 1 分 40 秒真实演示/);
  assert.match(html, /用户运营专家（P8）/);
  assert.match(html, /为什么这句追问值得问/);
  assert.match(html, /3,026 词元/);
  assert.match(html, /3\.7 s/);
  assert.match(html, /真实产品数据回放/);
  assert.match(html, /data:image\/png;base64,[A-Za-z0-9+/=]+/);
  assert.match(html, /GLP-dark 设计令牌 \(v2\.0\)/);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\.|src="(?!data:)|href="https?:\/\//i);
  assert.doesNotMatch(html, /物业|消防|园区运营/);
  assert.doesNotMatch(html, /__DEMO_(?:DATA|STYLES|SCRIPT|AUDIO_BASE64)__/);
});
