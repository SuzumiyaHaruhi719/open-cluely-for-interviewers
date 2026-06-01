const fs = require('fs');
const path = require('path');

const APP_STATE_DIR_NAME = 'cache';
const APP_STATE_FILE_NAME = 'app-state.json';

function getDefaultAppState() {
  return {
    asrProvider: null,
    dashscopeApiKey: null,
    dashscopeAiModel: null,
    resumeChatModel: null,
    outputLanguage: null,
    xfyunAppId: null,
    xfyunApiKey: null,
    // Volcengine (火山引擎) ASR — STAGED, not yet connected. These are stored so
    // the offline interview path can later switch its ASR to a 'volcengine'
    // provider once an access token is available. Empty → null. No client reads
    // them yet; offline currently runs on the existing mic→Paraformer pipeline.
    volcAppId: null,
    volcAccessToken: null,
    volcResourceId: null,
    windowOpacityLevel: 10,
    resumeText: null,
    jobDescription: null,
    interviewerMode: 'fast',
    interviewerSessionState: null,
    activePipelineId: null,
    activeSessionId: null
  };
}

function sanitizeAppState(state) {
  const nextState = getDefaultAppState();

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const asrProvider = String(state.asrProvider ?? '').trim().toLowerCase();
    if (['paraformer', 'xfyun', 'volc'].includes(asrProvider)) {
      nextState.asrProvider = asrProvider;
    }

    if (typeof state.dashscopeApiKey === 'string') {
      const dashscopeApiKey = state.dashscopeApiKey.trim();
      nextState.dashscopeApiKey = dashscopeApiKey || null;
    }

    if (typeof state.dashscopeAiModel === 'string' && state.dashscopeAiModel.trim()) {
      nextState.dashscopeAiModel = state.dashscopeAiModel.trim();
    }

    if (typeof state.resumeChatModel === 'string') {
      const resumeChatModel = state.resumeChatModel.trim();
      nextState.resumeChatModel = resumeChatModel || null;
    }

    if (typeof state.outputLanguage === 'string') {
      const outputLanguage = state.outputLanguage.trim().toLowerCase();
      nextState.outputLanguage = (outputLanguage === 'zh' || outputLanguage === 'en') ? outputLanguage : null;
    }

    if (typeof state.xfyunAppId === 'string') {
      const xfyunAppId = state.xfyunAppId.trim();
      nextState.xfyunAppId = xfyunAppId || null;
    }

    if (typeof state.xfyunApiKey === 'string') {
      const xfyunApiKey = state.xfyunApiKey.trim();
      nextState.xfyunApiKey = xfyunApiKey || null;
    }

    // Volcengine ASR creds (staged). Same trim → empty→null contract as the
    // other provider keys; no validation beyond string/trim because no client
    // consumes them yet.
    if (typeof state.volcAppId === 'string') {
      const volcAppId = state.volcAppId.trim();
      nextState.volcAppId = volcAppId || null;
    }

    if (typeof state.volcAccessToken === 'string') {
      const volcAccessToken = state.volcAccessToken.trim();
      nextState.volcAccessToken = volcAccessToken || null;
    }

    if (typeof state.volcResourceId === 'string') {
      const volcResourceId = state.volcResourceId.trim();
      nextState.volcResourceId = volcResourceId || null;
    }

    if (typeof state.resumeText === 'string') {
      const resumeText = state.resumeText.trim();
      nextState.resumeText = resumeText || null;
    }

    if (typeof state.jobDescription === 'string') {
      const jobDescription = state.jobDescription.trim();
      nextState.jobDescription = jobDescription || null;
    }

    const windowOpacityLevel = Number.parseInt(String(state.windowOpacityLevel ?? ''), 10);
    if (Number.isFinite(windowOpacityLevel)) {
      nextState.windowOpacityLevel = Math.min(Math.max(windowOpacityLevel, 1), 10);
    }


    const interviewerMode = String(state.interviewerMode ?? '').trim().toLowerCase();
    if (interviewerMode === 'expert' || interviewerMode === 'fast' || interviewerMode === 'customize') {
      nextState.interviewerMode = interviewerMode;
    }

    // Active custom pipeline id for Customize mode (resolved against the preset
    // library at run time). Null = fall back to the Expert preset.
    if (typeof state.activePipelineId === 'string') {
      const activePipelineId = state.activePipelineId.trim();
      nextState.activePipelineId = activePipelineId || null;
    }

    // Expert Block H consolidation output. Persisted as-is when it's a plain
    // object (array/scalar shapes are rejected → stays null). Block H owns the
    // field shape; the sanitizer only guards the object|null contract so a
    // corrupt file can't poison the next turn's Block C input.
    if (state.interviewerSessionState && typeof state.interviewerSessionState === 'object' && !Array.isArray(state.interviewerSessionState)) {
      nextState.interviewerSessionState = state.interviewerSessionState;
    }

    if (typeof state.activeSessionId === 'string') {
      const activeSessionId = state.activeSessionId.trim();
      nextState.activeSessionId = activeSessionId || null;
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
  // Atomic write: serialize to a temp file then rename over the real one. A
  // crash/kill mid-write leaves EITHER the intact old file OR the fully-written
  // new one — never a half-written/corrupt file that would load as empty defaults
  // and wipe the user's API keys.
  const finalPath = getAppStatePath(app);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, finalPath);
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
    // The file is unreadable/corrupt. Preserve it (don't let it be silently
    // overwritten with defaults) so the user's settings can be recovered, then
    // fall back to defaults for this run.
    try {
      if (fs.existsSync(appStatePath)) {
        fs.copyFileSync(appStatePath, `${appStatePath}.corrupt-${Date.now()}`);
      }
    } catch (_) { /* best-effort backup */ }
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
