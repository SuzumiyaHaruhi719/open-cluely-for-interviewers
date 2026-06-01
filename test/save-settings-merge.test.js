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
      getActiveProgrammingLanguage: () => 'javascript',
      setActiveProgrammingLanguage: (l) => l || 'javascript',
      initializeDashscopeService: () => {}
    },
    windowController: { setWindowOpacityLevel: (n) => n || 10 },
    keyboardShortcuts: {}
  });
  return { app, handlers, dir, get: () => appStateLib.loadAppState(app) };
}

test('partial save-settings preserves API keys it does not mention', async () => {
  const h = harness();
  // Seed real creds.
  appStateLib.saveAppState(h.app, { dashscopeApiKey: 'sk-keepme', xfyunApiKey: 'xk', volcAppId: 'va1' });

  // Partial save like "start interview" / "load sample" sends ONLY these.
  await h.handlers['save-settings'](null, { resumeText: 'resume here', jobDescription: 'jd here' });

  const s = h.get();
  assert.strictEqual(s.dashscopeApiKey, 'sk-keepme', 'dashscope key preserved by partial save');
  assert.strictEqual(s.xfyunApiKey, 'xk', 'xfyun key preserved');
  assert.strictEqual(s.volcAppId, 'va1', 'volc app id preserved');
  assert.strictEqual(s.resumeText, 'resume here');
  assert.strictEqual(s.jobDescription, 'jd here');
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test('full save-settings can still clear a key when explicitly emptied', async () => {
  const h = harness();
  appStateLib.saveAppState(h.app, { dashscopeApiKey: 'sk-old' });
  // Settings panel sends the field present-but-empty → that DOES clear it.
  await h.handlers['save-settings'](null, { dashscopeApiKey: '' });
  assert.strictEqual(h.get().dashscopeApiKey, null);
  fs.rmSync(h.dir, { recursive: true, force: true });
});
