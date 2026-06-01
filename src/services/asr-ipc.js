// Generic ASR IPC bridge. Used to live under services/assembly-ai/ when there
// was only one provider; now it sits on top of the asr-router which dispatches
// to Paraformer or Xunfei RTASR based on appState.asrProvider.

// Per-frame audio payload cap. A compromised renderer (XSS) could otherwise
// flood the main process with arbitrary-sized buffers, OOMing it or pinning
// the WS write queue forever. 64 KiB is generous for any real audio codec
// at any reasonable sample rate × frame size (typical PCM 16 kHz mono 100 ms
// frame ≈ 3.2 KiB; even 48 kHz stereo 100 ms ≈ 19 KiB).
const MAX_AUDIO_CHUNK_BYTES = 64 * 1024;
const ALLOWED_AUDIO_SOURCES = new Set(['mic', 'system']);

function registerAsrIpc({ ipcMain, asrService }) {
  ipcMain.handle('start-voice-recognition', (_event, { source } = {}) => {
    const resolvedSource = source === 'system' ? 'system' : 'mic';
    console.log(`IPC: start-voice-recognition [${resolvedSource}]`);
    asrService.emitSttDebug({
      source: resolvedSource,
      event: 'ipc-start',
      message: 'Renderer requested source start'
    });

    return asrService.startAssemblyAiStream(resolvedSource);
  });

  ipcMain.on('audio-chunk', (_event, payload = {}) => {
    // Validate inbound payload shape — renderer is the only legit
    // caller but defense-in-depth against an XSS-driven flood is
    // cheap. Drop the frame silently if it's malformed or oversized.
    if (typeof payload !== 'object' || payload === null) return;
    if (!ALLOWED_AUDIO_SOURCES.has(payload.source)) return;
    const audio = payload.data;
    if (audio == null) return;
    const length = audio.length ?? audio.byteLength;
    if (typeof length !== 'number' || length <= 0 || length > MAX_AUDIO_CHUNK_BYTES) {
      console.warn(`[ASR-IPC] dropped oversized audio-chunk source=${payload.source} length=${length}`);
      return;
    }
    asrService.handleAudioChunk(payload);
  });

  ipcMain.handle('stop-voice-recognition', (_event, { source } = {}) => {
    console.log(`IPC: stop-voice-recognition [${source}]`);
    return asrService.stopVoiceRecognition({ source });
  });

  ipcMain.handle('get-desktop-sources', async () => {
    return asrService.getDesktopSources();
  });

  ipcMain.handle('transcribe-audio', async (_event, base64Audio) => {
    console.log('IPC: transcribe-audio called, size:', base64Audio?.length || 0);
    return asrService.transcribeAudio(base64Audio);
  });
}

module.exports = {
  registerAsrIpc
};
