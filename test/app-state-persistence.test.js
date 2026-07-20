const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { saveAppState, loadAppState, getAppStatePath } = require('../src/services/state/app-state');

// Fake Electron app → state dir = <tmp>/cache (isPackaged:true uses getPath).
function fakeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-state-'));
  return { isPackaged: true, getPath: () => dir, _dir: dir };
}

test('app state preserves the AI key while purging retired ASR provider credentials', () => {
  const app = fakeApp();
  saveAppState(app, {
    dashscopeApiKey: 'sk-test-123456',
    asrProvider: 'xfyun',
    xfyunAppId: 'xa',
    xfyunApiKey: 'xk',
    volcAppId: 'va',
    volcAccessToken: 'vt',
    volcResourceId: 'volc.bigasr.sauc.duration'
  });

  // A later partial save must keep non-ASR state without resurrecting secrets.
  saveAppState(app, { interviewerMode: 'customize', activePipelineId: 'p1' });
  const s = loadAppState(app);
  assert.strictEqual(s.dashscopeApiKey, 'sk-test-123456', 'dashscope key preserved across partial save');
  for (const retired of [
    'asrProvider',
    'xfyunAppId',
    'xfyunApiKey',
    'volcAppId',
    'volcAccessToken',
    'volcResourceId'
  ]) {
    assert.strictEqual(Object.hasOwn(s, retired), false, `${retired} is no longer persisted`);
  }
  assert.strictEqual(s.interviewerMode, 'customize');
  assert.strictEqual(s.activePipelineId, 'p1');

  fs.rmSync(app._dir, { recursive: true, force: true });
});

test('writes are atomic — no .tmp left behind, file always valid JSON', () => {
  const app = fakeApp();
  saveAppState(app, { dashscopeApiKey: 'k' });
  const p = getAppStatePath(app);
  const dir = path.dirname(p);
  // No leftover temp files.
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no .tmp leftovers');
  // File parses.
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(p, 'utf8')));
  fs.rmSync(app._dir, { recursive: true, force: true });
});

test('corrupt state file is backed up, not silently overwritten', () => {
  const app = fakeApp();
  saveAppState(app, { dashscopeApiKey: 'k' });
  const p = getAppStatePath(app);
  fs.writeFileSync(p, '{ this is not valid json', 'utf8');
  loadAppState(app); // triggers the corrupt path
  const backups = fs.readdirSync(path.dirname(p)).filter((f) => f.includes('.corrupt-'));
  assert.ok(backups.length >= 1, 'corrupt file was backed up');
  fs.rmSync(app._dir, { recursive: true, force: true });
});
