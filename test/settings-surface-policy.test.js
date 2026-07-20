const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('desktop Settings exposes fixed Doubao 2.0 without provider or credential controls', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'windows', 'assistant', 'renderer.html'),
    'utf8'
  );
  const settingsHtml = html.slice(
    html.indexOf('id="settings-panel"'),
    html.indexOf('<!-- Close confirmation -->')
  );

  assert.match(settingsHtml, /豆包 Seed ASR 2\.0/);
  for (const retiredId of [
    'setting-asr-provider',
    'setting-xfyun-appid',
    'setting-xfyun-key',
    'setting-volc-appid',
    'setting-volc-access-token',
    'setting-volc-resource-id',
    'setting-volc-model'
  ]) {
    assert.doesNotMatch(settingsHtml, new RegExp(`id=["']${retiredId}["']`));
  }
  assert.doesNotMatch(settingsHtml, /流式 1\.0|bigasr|科大讯飞/);
  assert.doesNotMatch(settingsHtml, /id=["'][^"']*(?:auto|follow-up)[^"']*["']/i);
  assert.doesNotMatch(settingsHtml, /自动追问(?:开关|间隔)|专家追问(?:开关|间隔)/);
});
