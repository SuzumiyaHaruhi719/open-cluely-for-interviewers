// Legacy provider-neutral router retained for compatibility tests and older
// embedders. The current desktop product wires Doubao directly and does not
// expose provider selection.
//
// `dispose()` tears down every underlying service. New product wiring should
// depend on the fixed Doubao service directly instead of extending this file.

function createAsrRouter({ providers, getAsrProvider }) {
  // providers: { paraformer: <service>, volc: <service>, ... }
  // The 'paraformer' provider is the canonical fallback for shared helpers
  // (emitSttDebug, getDesktopSources) so callers always see a stable
  // reference even when an unknown provider id is set in app-state.
  const canonical = providers.paraformer;
  if (!canonical) {
    throw new Error('asr-router requires at least the paraformer provider');
  }

  function getActive() {
    const key = getAsrProvider();
    return providers[key] || canonical;
  }

  return {
    startAssemblyAiStream: (source) => getActive().startAssemblyAiStream(source),
    handleAudioChunk: (payload) => getActive().handleAudioChunk(payload),
    stopVoiceRecognition: (payload) => getActive().stopVoiceRecognition(payload),
    transcribeAudio: (base64) => getActive().transcribeAudio(base64),

    emitSttDebug: (payload) => canonical.emitSttDebug(payload),
    flushAllSttHistoryBuffers: (reason) => {
      for (const service of Object.values(providers)) {
        try { service.flushAllSttHistoryBuffers?.(reason); } catch (_) {}
      }
    },
    getDesktopSources: () => canonical.getDesktopSources(),
    resetSttHistoryBuffers: () => {
      for (const service of Object.values(providers)) {
        try { service.resetSttHistoryBuffers?.(); } catch (_) {}
      }
    },

    dispose: () => {
      for (const service of Object.values(providers)) {
        try { service.dispose(); } catch (_) {}
      }
    },

    stopAllStreams: () => {
      for (const service of Object.values(providers)) {
        try { service.stopVoiceRecognition({ source: 'all' }); } catch (_) {}
      }
    }
  };
}

module.exports = {
  createAsrRouter
};
