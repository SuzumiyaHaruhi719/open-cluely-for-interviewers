const {
  app,
  dialog,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen
} = require('electron');
const WebSocket = require('ws');

const {
  loadApplicationEnvironment,
  saveApplicationEnvironment
} = require('../bootstrap/environment');
const {
  getKeyboardShortcuts
} = require('../config');
const {
  getAppStatePath,
  loadAppState,
  saveAppState
} = require('../services/state/app-state');
const { createAssistantWindow } = require('../windows/assistant/window');
const { createSafeSender } = require('./shared/safe-send');
const { createGeminiRuntime } = require('./features/assistant/gemini-runtime');
const { createScreenshotManager } = require('./features/assistant/screenshot-manager');
const { registerAssistantIpc } = require('./features/assistant/ipc');
const { createParaformerService } = require('../services/paraformer/service');
const { createXfyunRtasrService } = require('../services/xfyun-rtasr/service');
const { createAsrRouter } = require('../services/asr-router');
const { registerAsrIpc } = require('../services/asr-ipc');
const { registerSettingsIpc } = require('./features/settings/ipc');
const { createInterviewerRuntime } = require('./features/interviewer/interviewer-runtime');
const { registerInterviewerIpc } = require('./features/interviewer/ipc');
const { createProcessLoopbackService } = require('../services/process-loopback/service');
const { registerProcessLoopbackIpc } = require('../services/process-loopback/ipc');
const { createWindowController } = require('./features/window/window-controller');
const { DEFAULT_WINDOW_OPACITY_LEVEL } = require('./features/window/window-constants');
const { logStartupConfiguration } = require('./startup-logging');
const { createMobileServer } = require('./features/mobile-server/server');

function resolveStartupOptions(argv = process.argv) {
  const normalizedArgs = Array.isArray(argv)
    ? argv.map((value) => String(value || '').trim().toLowerCase())
    : [];

  const hasFlag = (flag) => normalizedArgs.includes(flag);

  return {
    startHidden: hasFlag('--start-hidden') || hasFlag('--background')
  };
}

async function startApplication() {
  // Main-process process-level error handlers. Without these, an
  // unhandled promise rejection in any IPC handler / fetch / async
  // worker would terminate the Electron main process (Node 22 default
  // unhandledRejection mode is `throw`). We log + continue so the app
  // survives transient backend errors. The preload already has
  // `uncaughtException` handlers for the renderer side.
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Main] unhandledRejection', { reason, promise });
  });
  process.on('uncaughtException', (err) => {
    console.error('[Main] uncaughtException', err);
  });

  let appEnvironment = null;
  let appState = null;
  let isShuttingDown = false;
  const startupOptions = resolveStartupOptions();

  const geminiRuntime = createGeminiRuntime({
    getDashscopeApiKey: () => appState?.dashscopeApiKey || ''
  });

  const keyboardShortcuts = getKeyboardShortcuts();

  let screenshotManager = null;
  let windowController = null;

  const baseSendToRenderer = createSafeSender(() => {
    if (!windowController) {
      return null;
    }

    return windowController.getMainWindow();
  });

  // Mobile server reports its own status (listening, URLs, client count) to
  // the desktop renderer via the un-augmented sender — we don't want it
  // bouncing back to mobile clients.
  const mobileServer = createMobileServer({
    getGeminiRuntime:    () => geminiRuntime,
    getScreenshotManager: () => screenshotManager,
    notifyDesktop:        baseSendToRenderer
  });

  // Augmented sender: events flow to both the Electron renderer and all
  // connected mobile WebSocket clients simultaneously.
  const sendToRenderer = (channel, data) => {
    baseSendToRenderer(channel, data);
    mobileServer.broadcast(channel, data);
  };

  const paraformerService = createParaformerService({
    WebSocket,
    desktopCapturer,
    getDashscopeApiKey: () => appState?.dashscopeApiKey || '',
    getGeminiService: () => geminiRuntime.getService(),
    sendToRenderer
  });

  const xfyunRtasrService = createXfyunRtasrService({
    WebSocket,
    desktopCapturer,
    getXfyunCredentials: () => ({
      appId: appState?.xfyunAppId || '',
      apiKey: appState?.xfyunApiKey || ''
    }),
    getGeminiService: () => geminiRuntime.getService(),
    sendToRenderer
  });

  const asrService = createAsrRouter({
    providers: {
      paraformer: paraformerService,
      xfyun: xfyunRtasrService
    },
    getAsrProvider: () => {
      const p = appState?.asrProvider;
      return p === 'xfyun' ? 'xfyun' : 'paraformer';
    }
  });

  windowController = createWindowController({
    app,
    screen,
    globalShortcut,
    createAssistantWindow,
    getAppEnvironment: () => appEnvironment,
    emitSttDebug: asrService.emitSttDebug,
    sendToRenderer,
    onTakeStealthScreenshot: async () => {
      if (screenshotManager) {
        await screenshotManager.takeStealthScreenshot();
      }
    }
  });

  screenshotManager = createScreenshotManager({
    app,
    getMainWindow: () => windowController.getMainWindow(),
    getAppEnvironment: () => appEnvironment,
    sendToRenderer
  });

  function loadPersistedAppState() {
    appState = loadAppState(app);

    const activeDashscopeAiModel = geminiRuntime.setActiveDashscopeAiModel(appState.dashscopeAiModel);
    const activeProgrammingLanguage = geminiRuntime.setActiveProgrammingLanguage(appState.programmingLanguage);
    const activeWindowOpacityLevel = windowController.setWindowOpacityLevel(appState.windowOpacityLevel);

    if (
      appState.dashscopeAiModel !== activeDashscopeAiModel ||
      appState.programmingLanguage !== activeProgrammingLanguage ||
      appState.windowOpacityLevel !== activeWindowOpacityLevel
    ) {
      appState = saveAppState(app, {
        dashscopeAiModel: activeDashscopeAiModel,
        programmingLanguage: activeProgrammingLanguage,
        windowOpacityLevel: activeWindowOpacityLevel
      });
    }

    const restoredAsrProvider = appState?.asrProvider === 'xfyun' ? 'xfyun' : 'paraformer';

    console.log('Loaded app state from:', getAppStatePath(app));
    console.log('Restored ASR provider:', restoredAsrProvider);
    console.log('Restored DashScope AI model:', activeDashscopeAiModel);
    console.log('Restored programming language:', activeProgrammingLanguage);
    console.log(`Restored window opacity level: ${activeWindowOpacityLevel}/10`);
  }

  function cleanupTransientResources() {
    try { processLoopbackService?.stop?.(); } catch (_) {}
    asrService.dispose();
    screenshotManager.cleanupTransientResources();
    windowController.unregisterShortcuts();
    mobileServer.close();
  }

  function quitApplication() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    cleanupTransientResources();
    windowController.destroyWindow();

    setTimeout(() => {
      app.exit(0);
    }, 50);
  }

  ipcMain.handle('mobile-server-get-status', () => mobileServer.getStatus());

  registerAssistantIpc({
    ipcMain,
    screenshotManager,
    windowController,
    geminiRuntime,
    asrService,
    sendToRenderer,
    quitApplication
  });

  registerAsrIpc({
    ipcMain,
    asrService
  });

  const interviewerRuntime = createInterviewerRuntime({
    getAppState: () => appState
  });

  registerInterviewerIpc({
    ipcMain,
    interviewerRuntime
  });

  const processLoopbackService = createProcessLoopbackService({
    asrService,
    sendToRenderer
  });

  registerProcessLoopbackIpc({
    ipcMain,
    processLoopbackService
  });

  registerSettingsIpc({
    ipcMain,
    app,
    asrService,
    getAppEnvironment: () => appEnvironment,
    setAppEnvironment: (nextEnvironment) => {
      appEnvironment = nextEnvironment;
    },
    getAppState: () => appState,
    setAppState: (nextAppState) => {
      appState = nextAppState;
    },
    getAppStatePath,
    saveApplicationEnvironment,
    saveAppState,
    geminiRuntime,
    windowController,
    keyboardShortcuts
  });

  app.whenReady().then(() => {
    try {
      appEnvironment = loadApplicationEnvironment(app);
    } catch (error) {
      console.error('Failed to load application environment:', error);
      dialog.showErrorBox('Open-Cluely Configuration Error', error.message);
      app.exit(1);
      return;
    }

    loadPersistedAppState();

    logStartupConfiguration({
      appEnvironment,
      appState,
      programmingLanguages: geminiRuntime.getProgrammingLanguages(),
      defaultProgrammingLanguage: geminiRuntime.getDefaultProgrammingLanguage()
    });

    geminiRuntime.initializeDashscopeService(
      geminiRuntime.getActiveDashscopeAiModel(),
      geminiRuntime.getActiveProgrammingLanguage()
    );

    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
    app.commandLine.appendSwitch('ignore-certificate-errors');
    app.commandLine.appendSwitch('allow-running-insecure-content');
    app.commandLine.appendSwitch('disable-web-security');
    app.commandLine.appendSwitch('enable-media-stream');

    const launchHidden = startupOptions.startHidden || appEnvironment.startHidden;
    console.log('App is ready, creating window...');
    console.log(`Startup mode: ${launchHidden ? 'hidden' : 'visible'}`);
    windowController.createWindow({ launchHidden });
    windowController.registerShortcuts();

    if (!launchHidden) {
      windowController.markVisible();
    }

    if (appState?.windowOpacityLevel == null) {
      windowController.setWindowOpacityLevel(DEFAULT_WINDOW_OPACITY_LEVEL);
    }

    console.log(`Window setup complete (${launchHidden ? 'hidden launch' : 'visible launch'})`);
  });

  app.on('window-all-closed', () => {
    // Keep running in background for stealth operation
  });

  app.on('activate', () => {
    if (!windowController.hasWindow()) {
      windowController.createWindow();
      windowController.markVisible();
    }
  });

  app.on('will-quit', () => {
    cleanupTransientResources();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('new-window', (event) => {
      event.preventDefault();
    });

    contents.on('will-navigate', (event, navigationUrl) => {
      const mainWindow = windowController.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (navigationUrl !== mainWindow.webContents.getURL()) {
        event.preventDefault();
      }
    });
  });

  process.title = 'SystemIdleProcess';
}

module.exports = {
  startApplication
};
