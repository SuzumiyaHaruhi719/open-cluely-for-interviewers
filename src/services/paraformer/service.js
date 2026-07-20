// ============================================================================
// DashScope Paraformer Realtime ASR service
// ----------------------------------------------------------------------------
// Mirrors the public surface of services/assembly-ai/service.js so the rest of
// the app (IPC handlers, renderer event names: vosk-status / vosk-final /
// vosk-partial / vosk-error / vosk-stopped) doesn't need to know which provider
// is active.
//
// Protocol: wss://dashscope.aliyuncs.com/api-ws/v1/inference/
//   1. Send run-task JSON event (task_id = UUID, streaming=duplex)
//   2. Wait for task-started event -> renderer goes to 'listening'
//   3. Stream binary PCM frames (8 kHz, 16-bit LE, mono — downsampled from
//      the renderer's native 16 kHz capture)
//   4. Receive result-generated events; each contains payload.output.sentence
//      with text and sentence_end flag. We emit partials while sentence_end is
//      false, and emit a final once sentence_end becomes true. On sentence_end
//      the sentence object also carries emo_tag + emo_confidence (8k-v2 only),
//      which we forward to the interviewer copilot for affect-aware coaching.
//   5. Send finish-task to close gracefully; server replies with task-finished.
// ============================================================================

const { randomUUID } = require('crypto');
const {
  createSttHistoryManager,
  normalizeSttSource
} = require('../asr-shared/stt-history');

// paraformer-realtime-8k-v2 requires an 8000 Hz mono PCM stream and is
// Chinese-only. It returns emo_tag (positive/neutral/negative) +
// emo_confidence on sentence_end events, which we forward to the
// interviewer copilot so the prompt can factor in candidate affect.
// The renderer's audio pipeline captures at 16 kHz;
// we downsample 16k -> 8k here so each provider owns its own rate.
const PARAFORMER_SAMPLE_RATE = 8000;
const PARAFORMER_INPUT_SAMPLE_RATE = 16000;
const PARAFORMER_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
const PARAFORMER_MODEL = 'paraformer-realtime-8k-v2';

function downsampleInt16Buffer(buffer, inputRate, outputRate) {
  if (inputRate === outputRate || !buffer || buffer.length < 4) return buffer;
  const ratio = inputRate / outputRate;
  const inputSamples = buffer.length >> 1;
  const outputSamples = Math.floor(inputSamples / ratio);
  const out = Buffer.allocUnsafe(outputSamples * 2);
  for (let i = 0; i < outputSamples; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(inputSamples, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += buffer.readInt16LE(j * 2);
      count += 1;
    }
    const avg = count > 0 ? Math.round(sum / count) : 0;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, avg)), i * 2);
  }
  return out;
}

function createParaformerService({
  WebSocket,
  desktopCapturer,
  getDashscopeApiKey,
  getGeminiService,
  sendToRenderer
}) {
  const sockets = { mic: null, system: null };
  const taskIds = { mic: null, system: null };
  const taskStarted = { mic: false, system: false };
  const streaming = { mic: false, system: false };
  const pendingSentenceText = { mic: '', system: '' };

  const sttChunkCounters = { mic: 0, system: 0 };
  const sttDroppedChunkCounters = { mic: 0, system: 0 };

  // Idle-timeout reconnect tracking. When DashScope's server closes a task
  // because its VAD hasn't heard speech for ~60s, we silently restart the
  // task instead of bubbling up a hard error. Capped to avoid runaway loops
  // if the error isn't actually idle-shaped.
  const RECONNECT_BACKOFF_MS = 600;
  const MAX_RECONNECT_ATTEMPTS_PER_WINDOW = 8;
  const RECONNECT_WINDOW_MS = 5 * 60 * 1000;
  const reconnectState = {
    mic: { wantsActive: false, attempts: [], inFlight: false },
    system: { wantsActive: false, attempts: [], inFlight: false }
  };

  function isIdleTimeoutFailure(code, message) {
    const haystack = `${code || ''} ${message || ''}`.toLowerCase();
    return /idle|timeout|timed.?out|超时|no.?audio|no.?speech|inactive|expired/.test(haystack);
  }

  function pruneReconnectAttempts(source) {
    const now = Date.now();
    reconnectState[source].attempts = reconnectState[source].attempts.filter((t) => now - t < RECONNECT_WINDOW_MS);
  }

  function scheduleReconnect(source) {
    const resolved = normalizeSttSource(source);
    const state = reconnectState[resolved];
    if (!state.wantsActive || state.inFlight) return false;

    pruneReconnectAttempts(resolved);
    if (state.attempts.length >= MAX_RECONNECT_ATTEMPTS_PER_WINDOW) {
      emitSttDebug({
        source: resolved,
        level: 'warn',
        event: 'reconnect-capped',
        message: `Hit ${MAX_RECONNECT_ATTEMPTS_PER_WINDOW} reconnect attempts in ${RECONNECT_WINDOW_MS / 60000} min; giving up`
      });
      return false;
    }

    state.attempts.push(Date.now());
    state.inFlight = true;
    emitSttDebug({
      source: resolved,
      level: 'info',
      event: 'idle-reconnect',
      message: `Idle timeout detected; restarting task (attempt ${state.attempts.length}/${MAX_RECONNECT_ATTEMPTS_PER_WINDOW})`
    });

    setTimeout(() => {
      // Renderer-side capture is still running; we just open a fresh task
      // and the next chunk in handleAudioChunk picks it up.
      Promise.resolve(startStream(resolved))
        .catch((error) => {
          emitSttDebug({
            source: resolved,
            level: 'error',
            event: 'reconnect-failed',
            message: error?.message || 'reconnect failed'
          });
        })
        .finally(() => {
          state.inFlight = false;
        });
    }, RECONNECT_BACKOFF_MS);

    return true;
  }

  function emitSttDebug({ source = null, level = 'info', event = 'event', message = '', meta = null } = {}) {
    sendToRenderer('stt-debug', {
      ts: new Date().toISOString(),
      source: source === 'mic' || source === 'system' ? source : null,
      level,
      event,
      message,
      meta
    });
  }

  const sttHistoryManager = createSttHistoryManager({
    getGeminiService,
    emitSttDebug,
    mergeWindowMs: 3500
  });

  function cleanupSocket(ws) {
    if (!ws) return;
    try {
      ws.terminate();
    } catch (error) {
      console.error('Error tearing down Paraformer WebSocket:', error);
    }
  }

  function resetSourceState(source) {
    const resolved = normalizeSttSource(source);
    sttChunkCounters[resolved] = 0;
    sttDroppedChunkCounters[resolved] = 0;
    pendingSentenceText[resolved] = '';
    taskIds[resolved] = null;
    taskStarted[resolved] = false;
    streaming[resolved] = false;
    sockets[resolved] = null;
    sttHistoryManager.resetSttHistoryBuffer(resolved);
  }

  function cleanupTransientResources() {
    sttHistoryManager.flushAllSttHistoryBuffers('cleanup');
    cleanupSocket(sockets.mic);
    cleanupSocket(sockets.system);
    sockets.mic = null;
    sockets.system = null;
    streaming.mic = false;
    streaming.system = false;
    taskStarted.mic = false;
    taskStarted.system = false;
    taskIds.mic = null;
    taskIds.system = null;
    pendingSentenceText.mic = '';
    pendingSentenceText.system = '';
    sttChunkCounters.mic = 0;
    sttChunkCounters.system = 0;
    sttDroppedChunkCounters.mic = 0;
    sttDroppedChunkCounters.system = 0;
    sttHistoryManager.resetSttHistoryBuffer('mic');
    sttHistoryManager.resetSttHistoryBuffer('system');
  }

  function isSourceStreaming(source) {
    return Boolean(streaming[normalizeSttSource(source)]);
  }

  function buildRunTaskPayload(taskId) {
    return {
      header: {
        action: 'run-task',
        task_id: taskId,
        streaming: 'duplex'
      },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: PARAFORMER_MODEL,
        parameters: {
          sample_rate: PARAFORMER_SAMPLE_RATE,
          format: 'pcm'
        },
        input: {}
      }
    };
  }

  function buildFinishTaskPayload(taskId) {
    return {
      header: {
        action: 'finish-task',
        task_id: taskId,
        streaming: 'duplex'
      },
      payload: { input: {} }
    };
  }

  function extractSentence(msg) {
    const output = msg?.payload?.output;
    const sentence = output?.sentence;
    if (!sentence || typeof sentence !== 'object') return null;
    const text = typeof sentence.text === 'string' ? sentence.text.trim() : '';
    if (!text) return null;
    const isFinal = sentence.sentence_end === true || sentence.end_flag === true;
    // emo_tag / emo_confidence appear on the final sentence object for
    // paraformer-realtime-8k-v2. Defensively also check output level in
    // case the server moves them later.
    const emoTag = sentence.emo_tag ?? output?.emo_tag ?? null;
    const emoConfidenceRaw = sentence.emo_confidence ?? output?.emo_confidence ?? null;
    const emoConfidence = typeof emoConfidenceRaw === 'number' ? emoConfidenceRaw : null;
    const emotion = isFinal && emoTag ? { tag: String(emoTag), confidence: emoConfidence } : null;
    return { text, isFinal, sentenceId: sentence.sentence_id ?? null, emotion };
  }

  function startStream(source) {
    const resolved = normalizeSttSource(source);
    const apiKey = String(getDashscopeApiKey() || '').trim();

    // Mark that the consumer (renderer) wants this source alive — any
    // server-side task-failed that looks like idle timeout will trigger
    // a transparent reconnect. Cleared by stopVoiceRecognition.
    reconnectState[resolved].wantsActive = true;

    if (!apiKey) {
      emitSttDebug({
        source: resolved,
        level: 'error',
        event: 'missing-api-key',
        message: 'DashScope API key not configured in Settings'
      });
      sendToRenderer('vosk-error', {
        source: resolved,
        error: 'DashScope API key not configured. Add it in Settings.'
      });
      return { success: false, error: 'DashScope API key not configured. Add it in Settings.' };
    }

    if (isSourceStreaming(resolved)) {
      emitSttDebug({
        source: resolved,
        event: 'start-skipped',
        message: 'Start requested while source is already streaming'
      });
      return {
        success: true,
        message: resolved === 'system' ? 'System audio already streaming' : 'Mic already streaming'
      };
    }

    try {
      const taskId = randomUUID().replace(/-/g, '');
      taskIds[resolved] = taskId;
      taskStarted[resolved] = false;
      pendingSentenceText[resolved] = '';

      sttChunkCounters[resolved] = 0;
      sttDroppedChunkCounters[resolved] = 0;
      sttHistoryManager.resetSttHistoryBuffer(resolved);

      sendToRenderer('vosk-status', {
        source: resolved,
        status: 'loading',
        message: `Connecting (${resolved})...`
      });

      emitSttDebug({
        source: resolved,
        event: 'start-request',
        message: 'Opening Paraformer WebSocket',
        meta: { model: PARAFORMER_MODEL, taskId }
      });

      const ws = new WebSocket(PARAFORMER_WS_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-DataInspection': 'enable'
        }
      });

      sockets[resolved] = ws;

      ws.on('open', () => {
        try {
          ws.send(JSON.stringify(buildRunTaskPayload(taskId)));
          streaming[resolved] = true;
          emitSttDebug({
            source: resolved,
            event: 'ws-open',
            message: 'Paraformer WebSocket connected; run-task sent'
          });
        } catch (err) {
          emitSttDebug({
            source: resolved,
            level: 'error',
            event: 'run-task-send-failed',
            message: err?.message || 'run-task send failed'
          });
        }
      });

      ws.on('message', (rawMessage, isBinary) => {
        if (isBinary) {
          // Paraformer streams JSON only; binary frames from server are unexpected.
          return;
        }
        let msg;
        try {
          msg = JSON.parse(rawMessage.toString());
        } catch (parseError) {
          emitSttDebug({
            source: resolved,
            level: 'error',
            event: 'parse-error',
            message: parseError.message
          });
          return;
        }

        const event = msg?.header?.event;

        if (event === 'task-started') {
          taskStarted[resolved] = true;
          emitSttDebug({
            source: resolved,
            event: 'session-begin',
            message: 'Paraformer task started',
            meta: { taskId: msg?.header?.task_id }
          });
          sendToRenderer('vosk-status', {
            source: resolved,
            status: 'listening',
            message: `Listening (${resolved === 'system' ? 'Host' : 'You'})...`
          });
          return;
        }

        if (event === 'result-generated') {
          const sentence = extractSentence(msg);
          if (!sentence) return;

          if (sentence.isFinal) {
            emitSttDebug({
              source: resolved,
              event: 'turn-final',
              message: 'Final transcript received',
              meta: {
                chars: sentence.text.length,
                sentenceId: sentence.sentenceId,
                emotion: sentence.emotion
              }
            });
            sendToRenderer('vosk-final', {
              source: resolved,
              text: sentence.text,
              emotion: sentence.emotion
            });
            sttHistoryManager.queueSttHistorySegment(resolved, sentence.text);
            pendingSentenceText[resolved] = '';
          } else {
            pendingSentenceText[resolved] = sentence.text;
            sendToRenderer('vosk-partial', { source: resolved, text: sentence.text });
          }
          return;
        }

        if (event === 'task-finished') {
          emitSttDebug({
            source: resolved,
            event: 'termination',
            message: 'Paraformer task finished',
            meta: { taskId: msg?.header?.task_id }
          });

          // Promote any lingering partial to a final so the renderer doesn't lose it.
          const trailing = pendingSentenceText[resolved];
          if (trailing) {
            sendToRenderer('vosk-final', { source: resolved, text: trailing });
            sttHistoryManager.queueSttHistorySegment(resolved, trailing);
            pendingSentenceText[resolved] = '';
          }

          sttHistoryManager.flushSttHistoryBuffer(resolved, 'termination');
          resetSourceState(resolved);
          sendToRenderer('vosk-stopped', { source: resolved });
          return;
        }

        if (event === 'task-failed') {
          const code = msg?.header?.error_code || 'task-failed';
          const reason = msg?.header?.error_message || 'task failed';
          const idle = isIdleTimeoutFailure(code, reason);

          emitSttDebug({
            source: resolved,
            level: idle ? 'warn' : 'error',
            event: 'task-failed',
            message: reason,
            meta: { code, idle }
          });

          // Drop the dead socket / task ids but keep the source 'streaming'
          // so handleAudioChunk knows we're transitioning, not stopping.
          try { sockets[resolved]?.terminate(); } catch (_) {}
          sockets[resolved] = null;
          taskIds[resolved] = null;
          taskStarted[resolved] = false;
          sttHistoryManager.flushSttHistoryBuffer(resolved, idle ? 'idle-reconnect' : 'task-failed');

          if (idle && reconnectState[resolved].wantsActive) {
            // Don't surface the failure to the renderer — schedule a
            // transparent reconnect. The next chunk after the new task
            // starts flows through normally.
            if (scheduleReconnect(resolved)) {
              return;
            }
            // If reconnect was capped, fall through to surface the error.
          }

          streaming[resolved] = false;
          sendToRenderer('vosk-error', {
            source: resolved,
            error: `Paraformer error (${resolved}): ${reason}`
          });
          resetSourceState(resolved);
          return;
        }
      });

      ws.on('error', (error) => {
        emitSttDebug({
          source: resolved,
          level: 'error',
          event: 'ws-error',
          message: error?.message || 'websocket error'
        });
        sttHistoryManager.flushSttHistoryBuffer(resolved, 'ws-error');
        sendToRenderer('vosk-error', {
          source: resolved,
          error: `Connection error (${resolved}): ${error?.message || 'unknown'}`
        });
        resetSourceState(resolved);
      });

      ws.on('close', (code, reason) => {
        emitSttDebug({
          source: resolved,
          event: 'ws-close',
          message: 'Paraformer WebSocket closed',
          meta: { code, reason: reason?.toString() || '' }
        });
        if (streaming[resolved]) {
          sttHistoryManager.flushSttHistoryBuffer(resolved, 'ws-close');
          resetSourceState(resolved);
          sendToRenderer('vosk-stopped', { source: resolved });
        }
      });

      return { success: true };
    } catch (error) {
      emitSttDebug({
        source: resolved,
        level: 'error',
        event: 'start-failed',
        message: error?.message || 'start failed'
      });
      streaming[resolved] = false;
      return { success: false, error: error?.message || 'start failed' };
    }
  }

  function handleAudioChunk({ source, data }) {
    const resolved = normalizeSttSource(source);
    const ws = sockets[resolved];

    if (ws && ws.readyState === WebSocket.OPEN && taskStarted[resolved]) {
      const pcm16k = Buffer.from(data);
      const pcm8k = downsampleInt16Buffer(pcm16k, PARAFORMER_INPUT_SAMPLE_RATE, PARAFORMER_SAMPLE_RATE);
      ws.send(pcm8k);
      sttChunkCounters[resolved] += 1;
      if (sttChunkCounters[resolved] % 50 === 0) {
        emitSttDebug({
          source: resolved,
          event: 'chunk-heartbeat',
          message: 'Streaming audio chunks',
          meta: {
            chunks: sttChunkCounters[resolved],
            dropped: sttDroppedChunkCounters[resolved]
          }
        });
      }
      return;
    }

    sttDroppedChunkCounters[resolved] += 1;
    if (sttDroppedChunkCounters[resolved] % 25 === 0) {
      emitSttDebug({
        source: resolved,
        level: 'error',
        event: 'chunk-dropped',
        message: 'Audio chunk dropped',
        meta: {
          dropped: sttDroppedChunkCounters[resolved],
          readyState: ws ? ws.readyState : 'no-ws',
          taskStarted: taskStarted[resolved]
        }
      });
    }
  }

  function stopVoiceRecognition({ source } = {}) {
    emitSttDebug({
      source: source === 'system' || source === 'mic' ? source : null,
      event: 'ipc-stop',
      message: `Stop requested for ${source || 'default'}`
    });

    const stopSource = (src) => {
      const resolved = normalizeSttSource(src);
      const ws = sockets[resolved];

      // Clear the reconnect-want flag so an in-flight task-failed event
      // doesn't trigger an unwanted reconnect after the user stopped.
      reconnectState[resolved].wantsActive = false;
      reconnectState[resolved].inFlight = false;

      if (!ws) {
        sttHistoryManager.flushSttHistoryBuffer(resolved, 'stop-noop');
        emitSttDebug({
          source: resolved,
          event: 'stop-noop',
          message: 'Stop requested but no active socket found'
        });
        sttChunkCounters[resolved] = 0;
        sttDroppedChunkCounters[resolved] = 0;
        return;
      }

      try {
        if (ws.readyState === WebSocket.OPEN && taskIds[resolved]) {
          ws.send(JSON.stringify(buildFinishTaskPayload(taskIds[resolved])));
        }
      } catch (error) {
        emitSttDebug({
          source: resolved,
          level: 'error',
          event: 'stop-error',
          message: error?.message || 'stop error'
        });
      }

      sttHistoryManager.flushSttHistoryBuffer(resolved, 'stop-request');
      sendToRenderer('vosk-status', {
        source: resolved,
        status: 'stopped',
        message: 'Stopped'
      });

      streaming[resolved] = false;
      sttChunkCounters[resolved] = 0;
      sttDroppedChunkCounters[resolved] = 0;

      emitSttDebug({
        source: resolved,
        event: 'stop-issued',
        message: 'finish-task sent to Paraformer'
      });
    };

    if (source === 'all') {
      stopSource('mic');
      stopSource('system');
    } else {
      stopSource(source === 'system' ? 'system' : 'mic');
    }

    return { success: true };
  }

  async function getDesktopSources() {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return sources.map((source) => ({ id: source.id, name: source.name }));
    } catch (error) {
      console.error('Error getting desktop sources:', error.message);
      return [];
    }
  }

  async function transcribeAudio() {
    // Paraformer file transcription uses a different async API; not wired into
    // this app's UI today. The streaming path is the supported flow.
    return {
      success: false,
      error: 'File transcription is not supported with Paraformer in this build. Use streaming.'
    };
  }

  function dispose() {
    cleanupTransientResources();
    sttHistoryManager.dispose();
  }

  function resetSttHistoryBuffers() {
    sttHistoryManager.resetSttHistoryBuffer('mic');
    sttHistoryManager.resetSttHistoryBuffer('system');
  }

  return {
    dispose,
    emitSttDebug,
    flushAllSttHistoryBuffers: sttHistoryManager.flushAllSttHistoryBuffers,
    getDesktopSources,
    handleAudioChunk,
    resetSttHistoryBuffers,
    startAssemblyAiStream: startStream, // alias for IPC compatibility
    stopVoiceRecognition,
    transcribeAudio
  };
}

module.exports = {
  createParaformerService
};
