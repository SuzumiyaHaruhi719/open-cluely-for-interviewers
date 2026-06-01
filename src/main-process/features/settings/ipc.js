const { shell } = require('electron');
const { execFile } = require('child_process');

function registerSettingsIpc({
  ipcMain,
  app,
  asrService,
  getAppEnvironment,
  setAppEnvironment,
  getAppState,
  setAppState,
  getAppStatePath,
  saveApplicationEnvironment,
  saveAppState,
  geminiRuntime,
  windowController,
  keyboardShortcuts
}) {
  ipcMain.handle('open-sound-settings', async () => {
    try {
      if (process.platform === 'win32') {
        await shell.openExternal('ms-settings:sound');
      } else if (process.platform === 'darwin') {
        execFile('open', ['/System/Library/PreferencePanes/Sound.prefPane']);
      } else {
        await shell.openExternal('pavucontrol://');
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to open OS sound settings:', error);
      return { success: false, error: error.message };
    }
  });

  // Switch the macOS system default output device by name. Darwin-only;
  // returns a structured not-supported error on Windows/Linux so the renderer
  // can fall back without exceptions.
  //
  // Uses the `SwitchAudioSource` CLI (brew install switchaudio-osx) — the
  // standard 3rd-party tool for scripting macOS audio routing. Apple does not
  // expose a stable AppleScript / built-in CLI for this. If the binary is
  // missing we surface a clear install hint so the user can fix it in one
  // command rather than seeing an opaque ENOENT.
  //
  // Note: this only changes the *default output device*. Actual capture still
  // relies on the existing loopback path (which follows the system default
  // and therefore needs BlackHole / an Aggregate Device for content to be
  // captureable).
  ipcMain.handle('set-macos-default-output', async (_event, payload = {}) => {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'not-supported', platform: process.platform };
    }
    const deviceLabel = String(payload?.deviceLabel || '').trim();
    if (!deviceLabel) {
      return { success: false, error: 'empty-device-label' };
    }
    return await new Promise((resolve) => {
      execFile('SwitchAudioSource', ['-t', 'output', '-s', deviceLabel], (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ENOENT') {
            resolve({
              success: false,
              error: 'switchaudiosource-missing',
              hint: 'Install with: brew install switchaudio-osx'
            });
            return;
          }
          console.error('SwitchAudioSource failed:', error.message, stderr);
          resolve({ success: false, error: error.message, stderr: String(stderr || '').trim() });
          return;
        }
        resolve({ success: true, stdout: String(stdout || '').trim() });
      });
    });
  });

  ipcMain.handle('get-settings', () => {
    const appEnvironment = getAppEnvironment();
    const appState = getAppState();
    const dashscopeApiKey = typeof appState?.dashscopeApiKey === 'string' ? appState.dashscopeApiKey : '';
    const dashscopeAiModel = typeof appState?.dashscopeAiModel === 'string' && appState.dashscopeAiModel
      ? appState.dashscopeAiModel
      : geminiRuntime.getDefaultDashscopeAiModel();
    const xfyunAppId = typeof appState?.xfyunAppId === 'string' ? appState.xfyunAppId : '';
    const xfyunApiKey = typeof appState?.xfyunApiKey === 'string' ? appState.xfyunApiKey : '';
    // Volcengine ASR creds (staged — returned raw so the Settings UI can show
    // them; nothing consumes them for capture yet).
    const volcAppId = typeof appState?.volcAppId === 'string' ? appState.volcAppId : '';
    const volcAccessToken = typeof appState?.volcAccessToken === 'string' ? appState.volcAccessToken : '';
    const volcResourceId = typeof appState?.volcResourceId === 'string' ? appState.volcResourceId : '';
    const resumeText = typeof appState?.resumeText === 'string' ? appState.resumeText : '';
    const jobDescription = typeof appState?.jobDescription === 'string' ? appState.jobDescription : '';
    const asrProvider = ['xfyun', 'volc'].includes(appState?.asrProvider) ? appState.asrProvider : 'paraformer';
    const interviewerMode = ['expert', 'customize'].includes(appState?.interviewerMode) ? appState.interviewerMode : 'fast';
    const activePipelineId = typeof appState?.activePipelineId === 'string' ? appState.activePipelineId : null;

    return {
      asrProvider,
      dashscopeApiKey,
      dashscopeAiModel,
      xfyunAppId,
      xfyunApiKey,
      volcAppId,
      volcAccessToken,
      volcResourceId,
      resumeText,
      jobDescription,
      interviewerMode,
      activePipelineId,
      hasDashscopeApiKey: dashscopeApiKey.length > 0,
      hasXfyunCredentials: xfyunAppId.length > 0 && xfyunApiKey.length > 0,
      dashscopeAiModels: geminiRuntime.getDashscopeAiModels(),
      defaultDashscopeAiModel: geminiRuntime.getDefaultDashscopeAiModel(),
      keyboardShortcuts,
      hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
      startHidden: appEnvironment.startHidden,
      windowOpacityLevel: windowController.getWindowOpacityLevel()
    };
  });

  ipcMain.handle('save-settings', async (_event, settings = {}) => {
    console.log('IPC: save-settings called');

    try {
      const appEnvironment = getAppEnvironment();
      const previousAsrProvider = (() => {
        const current = getAppState();
        return ['xfyun', 'volc'].includes(current?.asrProvider) ? current.asrProvider : 'paraformer';
      })();
      const has = (k) => Object.prototype.hasOwnProperty.call(settings, k);
      const current = getAppState() || {};

      // CRITICAL: build a patch from ONLY the fields present in this payload.
      // A partial save (e.g. {resumeText, jobDescription} when starting an
      // interview, or {interviewerMode} from the mode toggle) must NEVER blank
      // the fields it omits — doing so wiped the user's API keys repeatedly.
      const patch = {};
      if (has('dashscopeApiKey')) patch.dashscopeApiKey = String(settings.dashscopeApiKey || '').trim();
      if (has('xfyunAppId')) patch.xfyunAppId = String(settings.xfyunAppId || '').trim();
      if (has('xfyunApiKey')) patch.xfyunApiKey = String(settings.xfyunApiKey || '').trim();
      if (has('volcAppId')) patch.volcAppId = String(settings.volcAppId || '').trim();
      if (has('volcAccessToken')) patch.volcAccessToken = String(settings.volcAccessToken || '').trim();
      if (has('volcResourceId')) patch.volcResourceId = String(settings.volcResourceId || '').trim();
      if (has('resumeText')) patch.resumeText = String(settings.resumeText || '').trim();
      if (has('jobDescription')) patch.jobDescription = String(settings.jobDescription || '').trim();
      if (has('asrProvider')) {
        const r = String(settings.asrProvider || '').trim().toLowerCase();
        patch.asrProvider = ['xfyun', 'volc'].includes(r) ? r : 'paraformer';
      }
      if (has('interviewerMode')) {
        const r = String(settings.interviewerMode || '').trim().toLowerCase();
        patch.interviewerMode = ['expert', 'customize'].includes(r) ? r : 'fast';
      }

      // Side-effecting settings (active model / language / opacity): apply + persist
      // only when present; otherwise keep current so a partial save is a no-op here.
      let nextDashscopeAiModel = current.dashscopeAiModel;
      if (has('dashscopeAiModel')) {
        nextDashscopeAiModel = geminiRuntime.setActiveDashscopeAiModel(settings.dashscopeAiModel);
        patch.dashscopeAiModel = nextDashscopeAiModel;
      }
      let nextProgrammingLanguage = geminiRuntime.getActiveProgrammingLanguage();
      if (has('programmingLanguage')) {
        nextProgrammingLanguage = geminiRuntime.setActiveProgrammingLanguage(settings.programmingLanguage);
        patch.programmingLanguage = nextProgrammingLanguage;
      }
      if (has('windowOpacityLevel')) {
        patch.windowOpacityLevel = windowController.setWindowOpacityLevel(settings.windowOpacityLevel);
      }

      const nextAsrProvider = patch.asrProvider !== undefined ? patch.asrProvider : previousAsrProvider;

      const updatedEnvironment = saveApplicationEnvironment(app, {
        hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
        startHidden: appEnvironment.startHidden,
        maxScreenshots: appEnvironment.maxScreenshots,
        screenshotDelay: appEnvironment.screenshotDelay,
        nodeEnv: appEnvironment.nodeEnv,
        nodeOptions: appEnvironment.nodeOptions
      });

      const updatedAppState = saveAppState(app, patch);

      setAppEnvironment(updatedEnvironment);
      setAppState(updatedAppState);

      if (previousAsrProvider !== nextAsrProvider && asrService?.stopAllStreams) {
        console.log(`ASR provider switched ${previousAsrProvider} → ${nextAsrProvider}; stopping previous streams`);
        try { asrService.stopAllStreams(); } catch (_) {}
      }

      console.log('Saved app state to:', getAppStatePath(app));
      console.log('Settings saved to:', updatedEnvironment.envPath);
      console.log('Applied DashScope AI model:', nextDashscopeAiModel);
      console.log('Applied programming language:', nextProgrammingLanguage);
      if (patch.windowOpacityLevel !== undefined) console.log(`Applied window opacity level: ${patch.windowOpacityLevel}/10`);

      geminiRuntime.initializeDashscopeService(nextDashscopeAiModel, nextProgrammingLanguage);

      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerSettingsIpc
};
