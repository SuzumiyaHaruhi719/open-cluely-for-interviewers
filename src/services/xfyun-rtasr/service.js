// ============================================================================
// Xunfei (科大讯飞) Realtime ASR service
// ----------------------------------------------------------------------------
// Mirrors the public surface of services/assembly-ai/service.js so it slots
// into the asr-router unchanged.
//
// Protocol: https://www.xfyun.cn/doc/asr/rtasr/API.html
//   URL:    wss://rtasr.xfyun.cn/v1/ws?appid=<appid>&ts=<ts>&signa=<signa>
//   Auth:   signa = base64( HMAC-SHA1( apiKey, MD5(appid + ts) ) )
//   Audio:  raw 16 kHz / 16-bit LE / mono PCM, 40 ms frames recommended
//   End:    send the literal JSON string {"end": true} once done
//
// Result frame shape:
//   { action: 'started' | 'result' | 'error', code, data, desc }
//   data is a JSON-encoded string with cn.st.{rt[].ws[].cw[].w} and
//   .type which is "0" for final or "1" for partial (counter-intuitive
//   compared to most providers; see docs).
// ============================================================================

const crypto = require('crypto');
const {
  createSttHistoryManager,
  normalizeSttSource
} = require('../asr-shared/stt-history');

const XFYUN_SAMPLE_RATE = 16000;
const XFYUN_HOST = 'rtasr.xfyun.cn';

function buildHandshakeUrl({ appId, apiKey }) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const baseString = appId + ts;
  const md5Digest = crypto.createHash('md5').update(baseString).digest('hex');
  const hmac = crypto.createHmac('sha1', apiKey).update(md5Digest).digest();
  const signa = encodeURIComponent(hmac.toString('base64'));
  return `wss://${XFYUN_HOST}/v1/ws?appid=${encodeURIComponent(appId)}&ts=${ts}&signa=${signa}`;
}

function extractTextFromResult(parsedData) {
  // data.cn.st.rt[].ws[].cw[].w
  try {
    const segments = parsedData?.cn?.st?.rt;
    if (!Array.isArray(segments)) return '';
    const out = [];
    for (const rt of segments) {
      const ws = Array.isArray(rt?.ws) ? rt.ws : [];
      for (const w of ws) {
        const cw = Array.isArray(w?.cw) ? w.cw : [];
        for (const c of cw) {
          if (typeof c?.w === 'string') out.push(c.w);
        }
      }
    }
    return out.join('').trim();
  } catch (_) {
    return '';
  }
}

function createXfyunRtasrService({
  WebSocket,
  desktopCapturer,
  getXfyunCredentials,
  getGeminiService,
  sendToRenderer
}) {
  const sockets = { mic: null, system: null };
  const streaming = { mic: false, system: false };
  const sessionStarted = { mic: false, system: false };
  const pendingPartial = { mic: '', system: '' };

  const sttChunkCounters = { mic: 0, system: 0 };
  const sttDroppedChunkCounters = { mic: 0, system: 0 };

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
    try { ws.terminate(); } catch (_) {}
  }

  function resetSourceState(source) {
    const resolved = normalizeSttSource(source);
    sttChunkCounters[resolved] = 0;
    sttDroppedChunkCounters[resolved] = 0;
    pendingPartial[resolved] = '';
    sessionStarted[resolved] = false;
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
    sessionStarted.mic = false;
    sessionStarted.system = false;
    pendingPartial.mic = '';
    pendingPartial.system = '';
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

  function startStream(source) {
    const resolved = normalizeSttSource(source);
    const creds = getXfyunCredentials() || {};
    const appId = String(creds.appId || '').trim();
    const apiKey = String(creds.apiKey || '').trim();

    if (!appId || !apiKey) {
      emitSttDebug({
        source: resolved,
        level: 'error',
        event: 'missing-credentials',
        message: 'Xunfei appId / apiKey not configured in Settings'
      });
      sendToRenderer('vosk-error', {
        source: resolved,
        error: 'Xunfei appId / apiKey not configured. Add them in Settings.'
      });
      return { success: false, error: 'Xunfei appId / apiKey not configured.' };
    }

    if (isSourceStreaming(resolved)) {
      return {
        success: true,
        message: resolved === 'system' ? 'System audio already streaming' : 'Mic already streaming'
      };
    }

    try {
      const wsUrl = buildHandshakeUrl({ appId, apiKey });

      sttChunkCounters[resolved] = 0;
      sttDroppedChunkCounters[resolved] = 0;
      pendingPartial[resolved] = '';
      sttHistoryManager.resetSttHistoryBuffer(resolved);

      sendToRenderer('vosk-status', {
        source: resolved,
        status: 'loading',
        message: `Connecting (${resolved})...`
      });

      emitSttDebug({
        source: resolved,
        event: 'start-request',
        message: 'Opening Xunfei RTASR WebSocket',
        meta: { sampleRate: XFYUN_SAMPLE_RATE }
      });

      const ws = new WebSocket(wsUrl);
      sockets[resolved] = ws;

      ws.on('open', () => {
        streaming[resolved] = true;
        emitSttDebug({
          source: resolved,
          event: 'ws-open',
          message: 'Xunfei WebSocket connected'
        });
      });

      ws.on('message', (rawMessage) => {
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

        const action = msg?.action;
        const code = String(msg?.code ?? '');

        if (action === 'started' || (action === 'result' && !sessionStarted[resolved])) {
          if (!sessionStarted[resolved]) {
            sessionStarted[resolved] = true;
            sendToRenderer('vosk-status', {
              source: resolved,
              status: 'listening',
              message: `Listening (${resolved === 'system' ? 'Host' : 'You'})...`
            });
            emitSttDebug({
              source: resolved,
              event: 'session-begin',
              message: 'Xunfei session started'
            });
          }
        }

        if (action === 'error' || (code && code !== '0' && action !== 'result')) {
          const reason = msg?.desc || 'Xunfei error';
          emitSttDebug({
            source: resolved,
            level: 'error',
            event: 'server-error',
            message: reason,
            meta: { code }
          });
          sendToRenderer('vosk-error', {
            source: resolved,
            error: `Xunfei error (${resolved}): ${reason}`
          });
          sttHistoryManager.flushSttHistoryBuffer(resolved, 'server-error');
          resetSourceState(resolved);
          return;
        }

        if (action === 'result' && typeof msg.data === 'string') {
          let parsedData;
          try {
            parsedData = JSON.parse(msg.data);
          } catch (_) {
            return;
          }
          const text = extractTextFromResult(parsedData);
          if (!text) return;

          // Xunfei convention: data.cn.st.type === "0" final, "1" partial.
          const sentenceType = String(parsedData?.cn?.st?.type ?? '');
          const isFinal = sentenceType === '0';

          if (isFinal) {
            // Final accumulates pending partial then commits.
            const finalText = (pendingPartial[resolved] + text).trim() || text;
            sendToRenderer('vosk-final', { source: resolved, text: finalText });
            sttHistoryManager.queueSttHistorySegment(resolved, finalText);
            pendingPartial[resolved] = '';
            emitSttDebug({
              source: resolved,
              event: 'turn-final',
              message: 'Final transcript received',
              meta: { chars: finalText.length }
            });
          } else {
            // Partial — Xunfei sends rolling partials per segment.
            pendingPartial[resolved] = text;
            sendToRenderer('vosk-partial', { source: resolved, text });
          }
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
          message: 'Xunfei WebSocket closed',
          meta: { code, reason: reason?.toString() || '' }
        });
        if (streaming[resolved]) {
          // Promote any lingering partial.
          const trailing = pendingPartial[resolved];
          if (trailing) {
            sendToRenderer('vosk-final', { source: resolved, text: trailing });
            sttHistoryManager.queueSttHistorySegment(resolved, trailing);
            pendingPartial[resolved] = '';
          }
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

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(data));
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
          readyState: ws ? ws.readyState : 'no-ws'
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

      if (!ws) {
        sttHistoryManager.flushSttHistoryBuffer(resolved, 'stop-noop');
        sttChunkCounters[resolved] = 0;
        sttDroppedChunkCounters[resolved] = 0;
        return;
      }

      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ end: true }));
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
    return {
      success: false,
      error: 'File transcription is not supported with Xunfei RTASR in this build. Use streaming.'
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
    startAssemblyAiStream: startStream,
    stopVoiceRecognition,
    transcribeAudio
  };
}

module.exports = {
  createXfyunRtasrService
};
