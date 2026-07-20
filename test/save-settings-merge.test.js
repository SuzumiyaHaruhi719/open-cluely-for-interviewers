const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { registerSettingsIpc } = require('../src/main-process/features/settings/ipc');
const appStateLib = require('../src/services/state/app-state');

// Drives the real save-settings handler with mocked collaborators + the real
// app-state store, to prove a PARTIAL save (the bug that kept wiping API keys)
// preserves fields it doesn't mention.
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-save-'));
  const app = { isPackaged: true, getPath: () => dir };
  let state = appStateLib.loadAppState(app);
  const handlers = {};
  registerSettingsIpc({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    app,
    asrService: { stopAllStreams: () => {} },
    getAppEnvironment: () => ({ hideFromScreenCapture: false, startHidden: false, maxScreenshots: 5, screenshotDelay: 0, nodeEnv: 'test', nodeOptions: '' }),
    setAppEnvironment: () => {},
    getAppState: () => state,
    setAppState: (s) => { state = s; },
    getAppStatePath: appStateLib.getAppStatePath,
    saveApplicationEnvironment: (_app, env) => ({ ...env, envPath: 'x' }),
    saveAppState: appStateLib.saveAppState,
    geminiRuntime: {
      setActiveDashscopeAiModel: (m) => m || 'deepseek-v4-flash',
      getDefaultDashscopeAiModel: () => 'deepseek-v4-flash',
      getDashscopeAiModels: () => ['deepseek-v4-flash'],
      getActiveProgrammingLanguage: () => 'javascript',
      setActiveProgrammingLanguage: (l) => l || 'javascript',
      initializeDashscopeService: () => {}
    },
    windowController: {
      getWindowOpacityLevel: () => 10,
      setWindowOpacityLevel: (n) => n || 10
    },
    keyboardShortcuts: {}
  });
  return { app, handlers, dir, get: () => appStateLib.loadAppState(app) };
}

test('partial save-settings preserves non-ASR state and ignores retired ASR secrets', async () => {
  const h = harness();
  // Seed one retained AI key plus stale ASR fields from an older build.
  appStateLib.saveAppState(h.app, { dashscopeApiKey: 'sk-keepme', xfyunApiKey: 'xk', volcAppId: 'va1' });

  // Partial save like "start interview" / "load sample" sends ONLY these.
  await h.handlers['save-settings'](null, { resumeText: 'resume here', jobDescription: 'jd here' });

  const s = h.get();
  assert.strictEqual(s.dashscopeApiKey, 'sk-keepme', 'dashscope key preserved by partial save');
  assert.strictEqual(Object.hasOwn(s, 'xfyunApiKey'), false);
  assert.strictEqual(Object.hasOwn(s, 'volcAppId'), false);
  assert.strictEqual(s.resumeText, 'resume here');
  assert.strictEqual(s.jobDescription, 'jd here');
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test('settings reports fixed Doubao readiness without exposing provider credentials', () => {
  const h = harness();
  const oldAppId = process.env.VOLC_APP_ID;
  const oldToken = process.env.VOLC_ACCESS_TOKEN;
  process.env.VOLC_APP_ID = 'environment-app';
  process.env.VOLC_ACCESS_TOKEN = 'environment-token';
  try {
    const settings = h.handlers['get-settings']();
    assert.strictEqual(settings.asrProvider, 'volc');
    assert.strictEqual(settings.hasAsrConfigured, true);
    for (const secret of [
      'xfyunAppId',
      'xfyunApiKey',
      'volcAppId',
      'volcAccessToken',
      'volcResourceId'
    ]) {
      assert.strictEqual(Object.hasOwn(settings, secret), false, `${secret} must not cross IPC`);
    }
  } finally {
    if (oldAppId === undefined) delete process.env.VOLC_APP_ID;
    else process.env.VOLC_APP_ID = oldAppId;
    if (oldToken === undefined) delete process.env.VOLC_ACCESS_TOKEN;
    else process.env.VOLC_ACCESS_TOKEN = oldToken;
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('full save-settings can still clear a key when explicitly emptied', async () => {
  const h = harness();
  appStateLib.saveAppState(h.app, { dashscopeApiKey: 'sk-old' });
  // Settings panel sends the field present-but-empty → that DOES clear it.
  await h.handlers['save-settings'](null, { dashscopeApiKey: '' });
  assert.strictEqual(h.get().dashscopeApiKey, null);
  fs.rmSync(h.dir, { recursive: true, force: true });
});
