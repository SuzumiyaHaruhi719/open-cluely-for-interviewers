// Thin router that lets the rest of the app talk to a single ASR object while
// transparently switching between Paraformer and Xunfei RTASR based on
// appState.asrProvider. The router exposes the exact same surface as the
// underlying services, so the IPC bridge / windowController / screenshot
// manager don't need to know which one is active.
//
// `dispose()` tears down every underlying service. Provider change handling
// (stopping the previously-active streams) lives in start-application.js so
// it can run before saveAppState completes.

function createAsrRouter({ providers, getAsrProvider }) {
  // providers: { paraformer: <service>, xfyun: <service> }
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
