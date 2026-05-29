const fs = require('fs');
const path = require('path');

const APP_STATE_DIR_NAME = 'cache';
const APP_STATE_FILE_NAME = 'app-state.json';

function getDefaultAppState() {
  return {
    asrProvider: null,
    dashscopeApiKey: null,
    dashscopeAiModel: null,
    xfyunAppId: null,
    xfyunApiKey: null,
    programmingLanguage: null,
    windowOpacityLevel: 10,
    themePreference: null,
    resumeText: null,
    jobDescription: null,
    interviewerMode: 'fast'
  };
}

function sanitizeAppState(state) {
  const nextState = getDefaultAppState();

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const asrProvider = String(state.asrProvider ?? '').trim().toLowerCase();
    if (['paraformer', 'xfyun'].includes(asrProvider)) {
      nextState.asrProvider = asrProvider;
    }

    if (typeof state.dashscopeApiKey === 'string') {
      const dashscopeApiKey = state.dashscopeApiKey.trim();
      nextState.dashscopeApiKey = dashscopeApiKey || null;
    }

    if (typeof state.dashscopeAiModel === 'string' && state.dashscopeAiModel.trim()) {
      nextState.dashscopeAiModel = state.dashscopeAiModel.trim();
    }

    if (typeof state.xfyunAppId === 'string') {
      const xfyunAppId = state.xfyunAppId.trim();
      nextState.xfyunAppId = xfyunAppId || null;
    }

    if (typeof state.xfyunApiKey === 'string') {
      const xfyunApiKey = state.xfyunApiKey.trim();
      nextState.xfyunApiKey = xfyunApiKey || null;
    }

    if (typeof state.resumeText === 'string') {
      const resumeText = state.resumeText.trim();
      nextState.resumeText = resumeText || null;
    }

    if (typeof state.jobDescription === 'string') {
      const jobDescription = state.jobDescription.trim();
      nextState.jobDescription = jobDescription || null;
    }

    if (typeof state.programmingLanguage === 'string' && state.programmingLanguage.trim()) {
      nextState.programmingLanguage = state.programmingLanguage.trim();
    }

    const windowOpacityLevel = Number.parseInt(String(state.windowOpacityLevel ?? ''), 10);
    if (Number.isFinite(windowOpacityLevel)) {
      nextState.windowOpacityLevel = Math.min(Math.max(windowOpacityLevel, 1), 10);
    }

    const themePreference = String(state.themePreference ?? '').trim().toLowerCase();
    if (themePreference === 'dark' || themePreference === 'light') {
      nextState.themePreference = themePreference;
    }

    const interviewerMode = String(state.interviewerMode ?? '').trim().toLowerCase();
    if (interviewerMode === 'expert' || interviewerMode === 'fast') {
      nextState.interviewerMode = interviewerMode;
    }
  }

  return nextState;
}

function getAppStateBaseDir(app) {
  // Dev: project root next to package.json so devs can inspect state easily.
  if (app && !app.isPackaged) {
    return path.join(__dirname, '..', '..', '..');
  }

  // Packaged: userData (e.g. %APPDATA%/<productName> on Windows). Critical for
  // portable builds — the EXE extracts to a temp dir each launch, so writing
  // beside the EXE means state is wiped every run.
  if (app) {
    return app.getPath('userData');
  }

  return path.join(__dirname, '..', '..', '..');
}

function getAppStateDir(app) {
  return path.join(getAppStateBaseDir(app), APP_STATE_DIR_NAME);
}

function getAppStatePath(app) {
  return path.join(getAppStateDir(app), APP_STATE_FILE_NAME);
}

function ensureAppStateDir(app) {
  fs.mkdirSync(getAppStateDir(app), { recursive: true });
}

function writeAppStateFile(app, state) {
  ensureAppStateDir(app);
  fs.writeFileSync(
    getAppStatePath(app),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8'
  );
}

function loadAppState(app) {
  const appStatePath = getAppStatePath(app);

  try {
    ensureAppStateDir(app);

    if (!fs.existsSync(appStatePath)) {
      const defaultState = getDefaultAppState();
      writeAppStateFile(app, defaultState);
      return defaultState;
    }

    const fileContent = fs.readFileSync(appStatePath, 'utf8');
    const sanitizedState = sanitizeAppState(JSON.parse(fileContent));
    writeAppStateFile(app, sanitizedState);
    return sanitizedState;
  } catch (error) {
    console.error('Failed to load app state:', error);
    return getDefaultAppState();
  }
}

function saveAppState(app, partialState = {}) {
  ensureAppStateDir(app);

  const currentState = loadAppState(app);
  const nextState = sanitizeAppState({
    ...currentState,
    ...partialState
  });

  writeAppStateFile(app, nextState);

  return nextState;
}

module.exports = {
  getDefaultAppState,
  getAppStatePath,
  loadAppState,
  saveAppState
};
