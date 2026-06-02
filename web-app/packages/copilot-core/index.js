'use strict';

const path = require('node:path');

// The desktop app's interviewer brain lives in the repo's src/ tree and is
// Electron-free (verified: no `require('electron')` under any of these paths —
// only fs/path/global fetch). We re-export it here so server code imports one
// stable package (`@open-cluely/copilot-core`) instead of reaching across the
// repo. ONE source of truth: the Electron app and its 26 tests keep importing
// the exact same files, unchanged.
const REPO_SRC = path.join(__dirname, '..', '..', '..', 'src');

const interviewerRuntime = require(path.join(REPO_SRC, 'main-process', 'features', 'interviewer', 'interviewer-runtime'));
const expertOrchestrator = require(path.join(REPO_SRC, 'main-process', 'features', 'interviewer', 'expert-orchestrator'));
const config = require(path.join(REPO_SRC, 'config'));
const presets = require(path.join(REPO_SRC, 'services', 'ai', 'pipeline', 'presets'));
const presetLibrary = require(path.join(REPO_SRC, 'services', 'ai', 'pipeline', 'preset-library'));

const { createInterviewerRuntime } = interviewerRuntime;

// Map the web SessionConfig shape onto the app-state field names the runtime reads.
function applyConfig(appState, partial = {}) {
  if (typeof partial.mode === 'string') appState.interviewerMode = partial.mode;
  if (typeof partial.resumeText === 'string') appState.resumeText = partial.resumeText;
  if (typeof partial.jobDescription === 'string') appState.jobDescription = partial.jobDescription;
  if (typeof partial.outputLanguage === 'string') appState.outputLanguage = partial.outputLanguage;
  if ('activePipelineId' in partial) appState.activePipelineId = partial.activePipelineId || null;
  return appState;
}

/**
 * Create a headless interviewer session: an in-memory app-state + the existing
 * desktop runtime, with renderer pushes routed to `emit(channel, payload)`.
 *
 * This mirrors the desktop runtime's collaborators EXACTLY
 * (getAppState / sendToRenderer / saveSessionState), so server behavior matches
 * the desktop app. `emit` receives the same channels the desktop renderer gets:
 *   - 'interviewer-progress'      → per-phase progress
 *   - 'session-context-updated'   → consolidated Block H state for the next turn
 * The server adapts those channels to the wire protocol (see @open-cluely/contract).
 *
 * @param {object} opts
 * @param {string} [opts.apiKey]        DashScope key (x-api-key for the Anthropic-shape endpoint)
 * @param {object} [opts.config]        partial SessionConfig
 * @param {(channel: string, payload: unknown) => void} [opts.emit]
 * @param {string|null} [opts.pipelinesDir]  dir for Customize-mode pipeline files
 */
function createHeadlessSession({ apiKey = '', config: cfg = {}, emit = () => {}, pipelinesDir = null } = {}) {
  const appState = applyConfig(
    {
      dashscopeApiKey: String(apiKey || ''),
      interviewerMode: 'fast',
      resumeText: '',
      jobDescription: '',
      outputLanguage: '',
      activePipelineId: null,
      interviewerSessionState: null
    },
    cfg
  );

  const runtime = createInterviewerRuntime({
    getAppState: () => appState,
    // A broken UI push must never break the generation chain.
    sendToRenderer: (channel, payload) => {
      try {
        emit(channel, payload);
      } catch (_) {
        /* swallow */
      }
    },
    saveSessionState: (next) => {
      appState.interviewerSessionState = next;
    },
    pipelinesDir
  });

  return {
    /** Merge a partial SessionConfig into this session's state. */
    configure(partial) {
      applyConfig(appState, partial || {});
    },
    setApiKey(key) {
      appState.dashscopeApiKey = String(key || '');
    },
    /** Run one analysis turn. Resolves to the runtime's result object. */
    analyze(args) {
      return runtime.analyzeCandidateAnswer(args || {});
    },
    isConfigured: runtime.isConfigured,
    getMode: runtime.getMode,
    getState: () => ({ ...appState })
  };
}

module.exports = {
  createHeadlessSession,
  // Brain re-exports for any consumer that wants the lower-level pieces.
  createInterviewerRuntime,
  runPipelineChain: expertOrchestrator.runPipelineChain,
  runExpertChain: expertOrchestrator.runExpertChain,
  EXPERT_PRESET: presets.EXPERT_PRESET,
  EXPERT_FAST_PRESET: presets.EXPERT_FAST_PRESET,
  presetLibrary,
  config,
  REPO_SRC
};
