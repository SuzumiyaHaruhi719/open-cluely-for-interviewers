const { invokeWithFallback } = require('./helpers');

function createInvokeActions(ipcRenderer) {
  return {
    toggleStealth: invokeWithFallback(ipcRenderer, {
      channel: 'toggle-stealth',
      label: 'toggleStealth',
      fallback: (error) => ({ error: error.message })
    }),

    emergencyHide: invokeWithFallback(ipcRenderer, {
      channel: 'emergency-hide',
      label: 'emergencyHide',
      fallback: (error) => ({ error: error.message })
    }),

    minimizeWindow: invokeWithFallback(ipcRenderer, {
      channel: 'window-minimize',
      label: 'minimizeWindow',
      fallback: (error) => ({ error: error.message })
    }),

    takeStealthScreenshot: invokeWithFallback(ipcRenderer, {
      channel: 'take-stealth-screenshot',
      label: 'takeStealthScreenshot',
      fallback: (error) => ({ error: error.message })
    }),

    analyzeStealth: invokeWithFallback(ipcRenderer, {
      channel: 'analyze-stealth',
      label: 'analyzeStealth',
      fallback: (error) => ({ error: error.message })
    }),

    analyzeStealthWithContext: invokeWithFallback(ipcRenderer, {
      channel: 'analyze-stealth-with-context',
      label: 'analyzeStealthWithContext',
      fallback: (error) => ({ error: error.message })
    }),

    askAiWithSessionContext: invokeWithFallback(ipcRenderer, {
      channel: 'ask-ai-with-session-context',
      label: 'askAiWithSessionContext',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    clearStealth: invokeWithFallback(ipcRenderer, {
      channel: 'clear-stealth',
      label: 'clearStealth',
      fallback: (error) => ({ error: error.message })
    }),

    getScreenshotsCount: invokeWithFallback(ipcRenderer, {
      channel: 'get-screenshots-count',
      label: 'getScreenshotsCount',
      fallback: () => 0
    }),

    getWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'get-window-bounds',
      label: 'getWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    setWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'set-window-bounds',
      label: 'setWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    setWindowSizePreset: invokeWithFallback(ipcRenderer, {
      channel: 'set-window-size-preset',
      label: 'setWindowSizePreset',
      transformArgs: (args) => [{ preset: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    startVoiceRecognition: invokeWithFallback(ipcRenderer, {
      channel: 'start-voice-recognition',
      label: 'startVoiceRecognition',
      transformArgs: (args) => [{ source: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    stopVoiceRecognition: invokeWithFallback(ipcRenderer, {
      channel: 'stop-voice-recognition',
      label: 'stopVoiceRecognition',
      transformArgs: (args) => [{ source: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    sendAudioChunk: (source, audioData) => {
      ipcRenderer.send('audio-chunk', { source, data: audioData });
    },

    getDesktopSources: invokeWithFallback(ipcRenderer, {
      channel: 'get-desktop-sources',
      label: 'getDesktopSources',
      fallback: () => []
    }),

    transcribeAudio: invokeWithFallback(ipcRenderer, {
      channel: 'transcribe-audio',
      label: 'transcribeAudio',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    addVoiceTranscript: invokeWithFallback(ipcRenderer, {
      channel: 'add-voice-transcript',
      label: 'addVoiceTranscript',
      fallback: (error) => ({ error: error.message })
    }),

    suggestResponse: invokeWithFallback(ipcRenderer, {
      channel: 'suggest-response',
      label: 'suggestResponse',
      fallback: (error) => ({ error: error.message })
    }),

    generateMeetingNotes: invokeWithFallback(ipcRenderer, {
      channel: 'generate-meeting-notes',
      label: 'generateMeetingNotes',
      fallback: (error) => ({ error: error.message })
    }),

    generateFollowUpEmail: invokeWithFallback(ipcRenderer, {
      channel: 'generate-follow-up-email',
      label: 'generateFollowUpEmail',
      fallback: (error) => ({ error: error.message })
    }),

    answerQuestion: invokeWithFallback(ipcRenderer, {
      channel: 'answer-question',
      label: 'answerQuestion',
      fallback: (error) => ({ error: error.message })
    }),

    getConversationInsights: invokeWithFallback(ipcRenderer, {
      channel: 'get-conversation-insights',
      label: 'getConversationInsights',
      fallback: (error) => ({ error: error.message })
    }),

    clearConversationHistory: invokeWithFallback(ipcRenderer, {
      channel: 'clear-conversation-history',
      label: 'clearConversationHistory',
      fallback: (error) => ({ error: error.message })
    }),

    getConversationHistory: invokeWithFallback(ipcRenderer, {
      channel: 'get-conversation-history',
      label: 'getConversationHistory',
      fallback: (error) => ({ error: error.message })
    }),

    getSettings: invokeWithFallback(ipcRenderer, {
      channel: 'get-settings',
      label: 'getSettings',
      fallback: (error) => ({ error: error.message })
    }),

    saveSettings: invokeWithFallback(ipcRenderer, {
      channel: 'save-settings',
      label: 'saveSettings',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    openSoundSettings: invokeWithFallback(ipcRenderer, {
      channel: 'open-sound-settings',
      label: 'openSoundSettings',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    setMacosDefaultOutput: invokeWithFallback(ipcRenderer, {
      channel: 'set-macos-default-output',
      label: 'setMacosDefaultOutput',
      transformArgs: (args) => [{ deviceLabel: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    listAudioProcesses: invokeWithFallback(ipcRenderer, {
      channel: 'process-audio-list',
      label: 'listAudioProcesses',
      fallback: (error) => ({ supported: false, processes: [], reason: error.message })
    }),

    startProcessAudio: invokeWithFallback(ipcRenderer, {
      channel: 'process-audio-start',
      label: 'startProcessAudio',
      transformArgs: (args) => [{ processId: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    stopProcessAudio: invokeWithFallback(ipcRenderer, {
      channel: 'process-audio-stop',
      label: 'stopProcessAudio',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    getProcessAudioStatus: invokeWithFallback(ipcRenderer, {
      channel: 'process-audio-status',
      label: 'getProcessAudioStatus',
      fallback: () => ({ listening: false })
    }),

    setThemePreference: invokeWithFallback(ipcRenderer, {
      channel: 'set-theme-preference',
      label: 'setThemePreference',
      transformArgs: (args) => [{ theme: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    closeApp: invokeWithFallback(ipcRenderer, {
      channel: 'close-app',
      label: 'closeApp',
      fallback: (error) => ({ error: error.message })
    }),

    getMobileServerStatus: invokeWithFallback(ipcRenderer, {
      channel: 'mobile-server-get-status',
      label: 'getMobileServerStatus',
      fallback: () => ({ listening: false, port: 7823, urls: [], clientCount: 0, error: null })
    }),

    interviewerAnalyzeAnswer: invokeWithFallback(ipcRenderer, {
      channel: 'interviewer-analyze-answer',
      label: 'interviewerAnalyzeAnswer',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    interviewerIsConfigured: invokeWithFallback(ipcRenderer, {
      channel: 'interviewer-is-configured',
      label: 'interviewerIsConfigured',
      fallback: () => ({ configured: false })
    }),

    // ── Customizable pipeline (SP2/SP3) ──────────────────────────────────────
    pipelineList: invokeWithFallback(ipcRenderer, { channel: 'pipeline-list', label: 'pipelineList', fallback: () => ({ success: false, pipelines: [] }) }),
    pipelineGet: invokeWithFallback(ipcRenderer, { channel: 'pipeline-get', label: 'pipelineGet', fallback: (e) => ({ success: false, error: e.message, pipeline: null }) }),
    pipelineBlockTypes: invokeWithFallback(ipcRenderer, { channel: 'pipeline-block-types', label: 'pipelineBlockTypes', fallback: () => ({ success: false, blockTypes: [], portTypes: [] }) }),
    pipelineValidate: invokeWithFallback(ipcRenderer, { channel: 'pipeline-validate', label: 'pipelineValidate', fallback: (e) => ({ success: false, ok: false, errors: [e.message] }) }),
    pipelineSave: invokeWithFallback(ipcRenderer, { channel: 'pipeline-save', label: 'pipelineSave', fallback: (e) => ({ success: false, error: e.message }) }),
    pipelineDelete: invokeWithFallback(ipcRenderer, { channel: 'pipeline-delete', label: 'pipelineDelete', fallback: (e) => ({ success: false, error: e.message }) }),
    pipelineExport: invokeWithFallback(ipcRenderer, { channel: 'pipeline-export', label: 'pipelineExport', fallback: (e) => ({ success: false, error: e.message }) }),
    pipelineImport: invokeWithFallback(ipcRenderer, { channel: 'pipeline-import', label: 'pipelineImport', fallback: (e) => ({ success: false, error: e.message }) }),
    pipelineSetActive: invokeWithFallback(ipcRenderer, { channel: 'pipeline-set-active', label: 'pipelineSetActive', fallback: (e) => ({ success: false, error: e.message }) }),
    interviewerSetMode: invokeWithFallback(ipcRenderer, { channel: 'interviewer-set-mode', label: 'interviewerSetMode', fallback: (e) => ({ success: false, error: e.message }) }),

    uploadResume: invokeWithFallback(ipcRenderer, {
      channel: 'resume-upload',
      label: 'uploadResume',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    resumeChat: invokeWithFallback(ipcRenderer, {
      channel: 'resume-chat',
      label: 'resumeChat',
      transformArgs: (args) => [{ messages: args[0]?.messages }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    listSessions: invokeWithFallback(ipcRenderer, {
      channel: 'session-list',
      label: 'listSessions',
      fallback: () => ({ success: false, sessions: [] })
    }),

    loadSession: invokeWithFallback(ipcRenderer, {
      channel: 'session-load',
      label: 'loadSession',
      transformArgs: (args) => [{ id: args[0] }],
      fallback: (error) => ({ success: false, session: null, error: error.message })
    }),

    createSession: invokeWithFallback(ipcRenderer, {
      channel: 'session-create',
      label: 'createSession',
      transformArgs: (args) => [{ title: args[0]?.title, mode: args[0]?.mode, interviewType: args[0]?.interviewType }],
      fallback: (error) => ({ success: false, session: null, error: error.message })
    }),

    renameSession: invokeWithFallback(ipcRenderer, {
      channel: 'session-rename',
      label: 'renameSession',
      transformArgs: (args) => [{ id: args[0], title: args[1] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    deleteSession: invokeWithFallback(ipcRenderer, {
      channel: 'session-delete',
      label: 'deleteSession',
      transformArgs: (args) => [{ id: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    appendToSession: invokeWithFallback(ipcRenderer, {
      channel: 'session-append',
      label: 'appendToSession',
      transformArgs: (args) => [{ id: args[0], message: args[1] }],
      fallback: (error) => ({ success: false, session: null, error: error.message })
    }),

    updateSessionContext: invokeWithFallback(ipcRenderer, {
      channel: 'session-update-context',
      label: 'updateSessionContext',
      transformArgs: (args) => [{ id: args[0], resumeText: args[1]?.resumeText, jobDescription: args[1]?.jobDescription }],
      fallback: (error) => ({ success: false, session: null, error: error.message })
    })
  };
}

module.exports = {
  createInvokeActions
};
