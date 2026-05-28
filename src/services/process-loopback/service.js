// Per-process audio loopback on Windows 10 21H2+.
//
// Wraps the application-loopback npm package, which ships a small sidecar
// .exe based on Microsoft's ApplicationLoopback Win32 sample. The sidecar
// uses ActivateAudioInterfaceAsync with AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
// (PROCESS_LOOPBACK_INCLUDE_TARGET_PROCESS_TREE) — the only way to get
// per-process loopback on Windows; Chromium's getDisplayMedia path always
// captures the system mix (crbug.com/40947205).
//
// Sidecar emits raw little-endian PCM at 44100 Hz stereo int16 (matches the
// MS sample's default WAVEFORMATEX). We mix stereo -> mono and downsample
// to 16 kHz so the bytes match the format the ASR providers already expect
// from the renderer's microphone / system path.

const SIDECAR_SAMPLE_RATE = 44100;
const SIDECAR_CHANNELS = 2;
const TARGET_SAMPLE_RATE = 16000;

// Min duration of mono int16 samples we accumulate before flushing to ASR.
// 100ms @ 16k mono = 1600 samples = 3200 bytes. Matches the renderer's
// audio-pipeline TARGET_FRAME_MS so paraformer sees the same chunk cadence
// whichever capture path is active.
const TARGET_FRAME_MS = 100;
const TARGET_FRAME_SAMPLES = Math.round((TARGET_SAMPLE_RATE * TARGET_FRAME_MS) / 1000);

function isWindowsSupported() {
  return process.platform === 'win32' && process.arch === 'x64';
}

function mixStereoInt16ToMono(stereoChunk) {
  // stereoChunk: Buffer or Uint8Array, little-endian int16 L,R,L,R,...
  const view = Buffer.isBuffer(stereoChunk)
    ? stereoChunk
    : Buffer.from(stereoChunk.buffer, stereoChunk.byteOffset, stereoChunk.byteLength);
  // Drop any trailing odd byte / unpaired sample. Sidecar should never emit
  // those but defensive code keeps the rest of the pipeline crash-free.
  const usableBytes = view.length - (view.length % 4);
  const monoSamples = usableBytes / 4;
  const out = Buffer.allocUnsafe(monoSamples * 2);
  for (let i = 0; i < monoSamples; i += 1) {
    const left = view.readInt16LE(i * 4);
    const right = view.readInt16LE(i * 4 + 2);
    const avg = (left + right) >> 1;
    out.writeInt16LE(avg, i * 2);
  }
  return out;
}

// Average-bucket downsampler. Same approach as audio-pipeline.js — adequate
// quality for speech, no LPF artefacts that bite a mono speech model.
function downsampleInt16(monoBuffer, inRate, outRate) {
  if (inRate === outRate || monoBuffer.length < 4) return monoBuffer;
  const ratio = inRate / outRate;
  const inSamples = monoBuffer.length >> 1;
  const outSamples = Math.floor(inSamples / ratio);
  const out = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(inSamples, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += monoBuffer.readInt16LE(j * 2);
      count += 1;
    }
    const avg = count > 0 ? Math.round(sum / count) : 0;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, avg)), i * 2);
  }
  return out;
}

function createProcessLoopbackService({ asrService, sendToRenderer, logger = console }) {
  let appLoopback = null;
  let active = null; // { pid, startedAt, leftoverMono, framesEmitted }

  function tryLoadAppLoopback() {
    if (appLoopback) return appLoopback;
    try {
      appLoopback = require('application-loopback');
      return appLoopback;
    } catch (error) {
      logger.warn('process-loopback: application-loopback not available:', error.message);
      return null;
    }
  }

  function emitDebug(level, event, message, meta = null) {
    try {
      asrService?.emitSttDebug?.({ source: 'system', level, event, message, meta });
    } catch (_) {}
  }

  async function listAudioProcesses() {
    if (!isWindowsSupported()) {
      return { supported: false, processes: [], reason: 'platform-not-windows' };
    }
    const al = tryLoadAppLoopback();
    if (!al) {
      return { supported: false, processes: [], reason: 'sidecar-missing' };
    }
    try {
      const windows = await al.getActiveWindowProcessIds();
      // Deduplicate by processId so users see one entry per app, not per
      // window. Prefer the longest title since it usually has more context
      // (e.g. "Discord — channel #foo" vs "Discord").
      const byPid = new Map();
      for (const w of windows) {
        if (!w?.processId) continue;
        const prev = byPid.get(w.processId);
        if (!prev || String(w.title || '').length > String(prev.title || '').length) {
          byPid.set(w.processId, { processId: w.processId, title: w.title || '' });
        }
      }
      const processes = Array.from(byPid.values()).sort((a, b) => {
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      });
      return { supported: true, processes };
    } catch (error) {
      logger.warn('process-loopback: enumerate failed:', error);
      return { supported: false, processes: [], reason: error.message };
    }
  }

  async function start(processId) {
    if (!isWindowsSupported()) {
      throw new Error('Per-process audio capture is only supported on Windows 10/11 x64.');
    }
    const al = tryLoadAppLoopback();
    if (!al) {
      throw new Error('application-loopback module is not available.');
    }
    if (active) {
      throw new Error(`Process loopback already running for PID ${active.pid}.`);
    }
    const pidStr = String(processId || '').trim();
    if (!pidStr) {
      throw new Error('processId is required.');
    }

    // The renderer is responsible for opening the ASR WebSocket via
    // startVoiceRecognition('system') BEFORE calling us. Mirrors how the
    // mic / screen-loopback paths work — keeps WS lifecycle in one place.
    active = {
      pid: pidStr,
      startedAt: Date.now(),
      leftoverMono: Buffer.alloc(0),
      framesEmitted: 0,
      bytesIn: 0
    };

    emitDebug('info', 'process-loopback-start', `Capturing audio from PID ${pidStr}`, { pid: pidStr });

    try {
      al.startAudioCapture(pidStr, {
        onData: (chunk) => {
          if (!active || active.pid !== pidStr) return;
          try {
            active.bytesIn += chunk.byteLength;
            const stereoBuf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            const mono = mixStereoInt16ToMono(stereoBuf);
            const downsampled = downsampleInt16(mono, SIDECAR_SAMPLE_RATE, TARGET_SAMPLE_RATE);
            active.leftoverMono = active.leftoverMono.length === 0
              ? downsampled
              : Buffer.concat([active.leftoverMono, downsampled]);

            const frameBytes = TARGET_FRAME_SAMPLES * 2;
            while (active.leftoverMono.length >= frameBytes) {
              const frame = active.leftoverMono.subarray(0, frameBytes);
              active.leftoverMono = active.leftoverMono.subarray(frameBytes);
              // handleAudioChunk expects { source, data }. data must be a
              // raw Buffer / ArrayBuffer / TypedArray of int16 PCM at
              // 16kHz mono — the same shape the renderer sends today.
              try {
                asrService.handleAudioChunk({ source: 'system', data: frame });
                active.framesEmitted += 1;
              } catch (handleError) {
                emitDebug('error', 'process-loopback-handle-failed', handleError.message, { pid: pidStr });
              }
            }
          } catch (chunkError) {
            emitDebug('error', 'process-loopback-chunk-failed', chunkError.message, { pid: pidStr });
          }
        }
      });
    } catch (error) {
      active = null;
      throw new Error(`Sidecar failed to start: ${error.message}`);
    }

    sendToRenderer?.('process-loopback-status', { listening: true, pid: pidStr });
    return { success: true, pid: pidStr };
  }

  async function stop() {
    if (!active) return { success: true, alreadyStopped: true };
    const { pid } = active;
    const al = tryLoadAppLoopback();
    try {
      if (al) al.stopAudioCapture(pid);
    } catch (error) {
      logger.warn('process-loopback: stopAudioCapture threw:', error);
    }
    emitDebug('info', 'process-loopback-stop', `Stopped audio capture for PID ${pid}`, {
      pid,
      bytesIn: active.bytesIn,
      framesEmitted: active.framesEmitted,
      durationMs: Date.now() - active.startedAt
    });
    active = null;

    sendToRenderer?.('process-loopback-status', { listening: false, pid: null });
    return { success: true, pid };
  }

  function isActive() {
    return active !== null;
  }

  function getStatus() {
    if (!active) return { listening: false };
    return {
      listening: true,
      pid: active.pid,
      bytesIn: active.bytesIn,
      framesEmitted: active.framesEmitted,
      durationMs: Date.now() - active.startedAt
    };
  }

  return {
    listAudioProcesses,
    start,
    stop,
    isActive,
    getStatus
  };
}

module.exports = {
  createProcessLoopbackService,
  isWindowsSupported,
  // Exported for unit-testing the resampling math:
  _mixStereoInt16ToMono: mixStereoInt16ToMono,
  _downsampleInt16: downsampleInt16
};
