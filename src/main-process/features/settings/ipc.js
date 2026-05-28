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

  ipcMain.handle('get-settings', () => {
    const appEnvironment = getAppEnvironment();
    const appState = getAppState();
    const dashscopeApiKey = typeof appState?.dashscopeApiKey === 'string' ? appState.dashscopeApiKey : '';
    const dashscopeAiModel = typeof appState?.dashscopeAiModel === 'string' && appState.dashscopeAiModel
      ? appState.dashscopeAiModel
      : geminiRuntime.getDefaultDashscopeAiModel();
    const xfyunAppId = typeof appState?.xfyunAppId === 'string' ? appState.xfyunAppId : '';
    const xfyunApiKey = typeof appState?.xfyunApiKey === 'string' ? appState.xfyunApiKey : '';
    const resumeText = typeof appState?.resumeText === 'string' ? appState.resumeText : '';
    const jobDescription = typeof appState?.jobDescription === 'string' ? appState.jobDescription : '';
    const asrProvider = appState?.asrProvider === 'xfyun' ? 'xfyun' : 'paraformer';

    return {
      asrProvider,
      dashscopeApiKey,
      dashscopeAiModel,
      xfyunAppId,
      xfyunApiKey,
      resumeText,
      jobDescription,
      hasDashscopeApiKey: dashscopeApiKey.length > 0,
      hasXfyunCredentials: xfyunAppId.length > 0 && xfyunApiKey.length > 0,
      dashscopeAiModels: geminiRuntime.getDashscopeAiModels(),
      defaultDashscopeAiModel: geminiRuntime.getDefaultDashscopeAiModel(),
      programmingLanguage: geminiRuntime.getActiveProgrammingLanguage(),
      programmingLanguages: geminiRuntime.getProgrammingLanguages(),
      defaultProgrammingLanguage: geminiRuntime.getDefaultProgrammingLanguage(),
      keyboardShortcuts,
      hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
      startHidden: appEnvironment.startHidden,
      windowOpacityLevel: windowController.getWindowOpacityLevel(),
      themePreference: appState?.themePreference === 'dark' || appState?.themePreference === 'light'
        ? appState.themePreference
        : null
    };
  });

  ipcMain.handle('set-theme-preference', (_event, payload = {}) => {
    try {
      const requestedTheme = typeof payload === 'string'
        ? payload
        : payload?.theme;
      const normalizedTheme = String(requestedTheme || '').trim().toLowerCase();
      const themePreference = normalizedTheme === 'dark' ? 'dark' : 'light';

      const updatedAppState = saveAppState(app, { themePreference });
      setAppState(updatedAppState);

      return { success: true, themePreference };
    } catch (error) {
      console.error('Error saving theme preference:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-settings', async (_event, settings = {}) => {
    console.log('IPC: save-settings called');

    try {
      const appEnvironment = getAppEnvironment();
      const previousAsrProvider = (() => {
        const current = getAppState();
        return current?.asrProvider === 'xfyun' ? 'xfyun' : 'paraformer';
      })();
      const nextDashscopeApiKey = String(settings.dashscopeApiKey || '').trim();
      const nextDashscopeAiModel = geminiRuntime.setActiveDashscopeAiModel(settings.dashscopeAiModel);
      const nextXfyunAppId = String(settings.xfyunAppId || '').trim();
      const nextXfyunApiKey = String(settings.xfyunApiKey || '').trim();
      const requestedAsrProvider = String(settings.asrProvider || '').trim().toLowerCase();
      const nextAsrProvider = requestedAsrProvider === 'xfyun' ? 'xfyun' : 'paraformer';
      const nextResumeText = String(settings.resumeText || '').trim();
      const nextJobDescription = String(settings.jobDescription || '').trim();
      const nextProgrammingLanguage = geminiRuntime.setActiveProgrammingLanguage(settings.programmingLanguage);
      const nextWindowOpacityLevel = windowController.setWindowOpacityLevel(settings.windowOpacityLevel);

      const updatedEnvironment = saveApplicationEnvironment(app, {
        hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
        startHidden: appEnvironment.startHidden,
        maxScreenshots: appEnvironment.maxScreenshots,
        screenshotDelay: appEnvironment.screenshotDelay,
        nodeEnv: appEnvironment.nodeEnv,
        nodeOptions: appEnvironment.nodeOptions
      });

      const updatedAppState = saveAppState(app, {
        asrProvider: nextAsrProvider,
        dashscopeApiKey: nextDashscopeApiKey,
        dashscopeAiModel: nextDashscopeAiModel,
        xfyunAppId: nextXfyunAppId,
        xfyunApiKey: nextXfyunApiKey,
        resumeText: nextResumeText,
        jobDescription: nextJobDescription,
        programmingLanguage: nextProgrammingLanguage,
        windowOpacityLevel: nextWindowOpacityLevel
      });

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
      console.log(`Applied window opacity level: ${nextWindowOpacityLevel}/10`);

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
