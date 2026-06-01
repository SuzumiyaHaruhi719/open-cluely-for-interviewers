// ============================================================================
// Volcengine / Doubao (豆包) streaming ASR service — SAUC v3 "bigmodel".
// ----------------------------------------------------------------------------
// Mirrors the public surface of the Xunfei + Paraformer services so it slots
// into the asr-router unchanged. Speaks Volcengine's binary WebSocket protocol.
//
// Endpoint:  wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
// Auth:      headers X-Api-App-Key (APP ID), X-Api-Access-Key (Access Token),
//            X-Api-Resource-Id (e.g. volc.seedasr.sauc.duration). v3 needs no
//            secret key — APP ID + Access Token only.
// Audio:     raw 16 kHz / 16-bit LE / mono PCM (same as the other providers).
//
// Binary frame (big-endian):
//   byte0: (protocolVersion<<4) | headerSize(4-byte units, =1)
//   byte1: (messageType<<4) | flags
//   byte2: (serialization<<4) | compression
//   byte3: reserved (0)
//   [int32 sequence]      — present when flags has the seq bit
//   uint32 payloadSize
//   payload               — gzip(JSON) for config, gzip(PCM) for audio
//
//   messageType: 0x1 full-client-request, 0x2 audio-only-request,
//                0x9 full-server-response, 0xF server-error
//   flags:       0x1 positive seq, 0x2 last-no-seq, 0x3 last-with-seq
//   serialization: 0x1 JSON, 0x0 none(raw); compression: 0x1 gzip
//
// NOTE: the protocol framing here follows Volcengine's v3 docs but has not been
// verified end-to-end against the live service from this build — see the
// implementation note. The stt-debug stream surfaces every frame for debugging.
// ============================================================================

const crypto = require('crypto');
const zlib = require('zlib');
const {
  createSttHistoryManager,
  normalizeSttSource
} = require('../asr-shared/stt-history');

const VOLC_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
const VOLC_SAMPLE_RATE = 16000;

const PROTOCOL_VERSION = 0x1;
const HEADER_SIZE = 0x1;
const MSG_FULL_CLIENT = 0x1;
const MSG_AUDIO_ONLY = 0x2;
const MSG_FULL_SERVER = 0x9;
const MSG_SERVER_ERROR = 0xF;
const FLAG_POS_SEQ = 0x1;
const FLAG_LAST_SEQ = 0x3;
const SER_JSON = 0x1;
const SER_RAW = 0x0;
const COMP_GZIP = 0x1;

function buildFrame({ messageType, flags, serialization, compression, sequence, payload }) {
  const header = Buffer.alloc(4);
  header[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  header[1] = (messageType << 4) | flags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0;
  const parts = [header];
  if (flags === FLAG_POS_SEQ || flags === FLAG_LAST_SEQ) {
    const seq = Buffer.alloc(4);
    seq.writeInt32BE(sequence | 0, 0);
    parts.push(seq);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length >>> 0, 0);
  parts.push(size, payload);
  return Buffer.concat(parts);
}

// Parse a server frame → { messageType, payload(Buffer, un-gzipped if needed) }.
function parseFrame(buf) {
  if (!buf || buf.length < 4) return null;
  const messageType = (buf[1] >> 4) & 0x0F;
  const flags = buf[1] & 0x0F;
  const compression = buf[2] & 0x0F;
  let offset = 4;
  if (flags === FLAG_POS_SEQ || flags === FLAG_LAST_SEQ) offset += 4; // skip seq
  if (buf.length < offset + 4) return { messageType, payload: Buffer.alloc(0) };
  const payloadSize = buf.readUInt32BE(offset);
  offset += 4;
  let payload = buf.subarray(offset, offset + payloadSize);
  if (compression === COMP_GZIP && payload.length) {
    try { payload = zlib.gunzipSync(payload); } catch (_) { /* leave raw */ }
  }
  return { messageType, payload };
}

function buildConfigPayload(resourceId) {
  const config = {
    user: { uid: 'open-cluely' },
    audio: { format: 'pcm', rate: VOLC_SAMPLE_RATE, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel',
      enable_punc: true,
      result_type: 'single',
      show_utterances: true
    }
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(config), 'utf8'));
}

function createVolcengineAsrService({
  WebSocket,
  desktopCapturer,
  getVolcCredentials,
  getGeminiService,
  sendToRenderer
}) {
  const sockets = { mic: null, system: null };
  const streaming = { mic: false, system: false };
  const sessionStarted = { mic: false, system: false };
  const pendingPartial = { mic: '', system: '' };
  const sequence = { mic: 1, system: 1 };
  const sttChunkCounters = { mic: 0, system: 0 };
  const sttDroppedChunkCounters = { mic: 0, system: 0 };

  function emitSttDebug({ source = null, level = 'info', event = 'event', message = '', meta = null } = {}) {
    sendToRenderer('stt-debug', {
      ts: new Date().toISOString(),
      source: source === 'mic' || source === 'system' ? source : null,
      level, event, message, meta
    });
  }

  const sttHistoryManager = createSttHistoryManager({ getGeminiService, emitSttDebug, mergeWindowMs: 3500 });

  function cleanupSocket(ws) { if (ws) { try { ws.terminate(); } catch (_) {} } }

  function resetSourceState(source) {
    const r = normalizeSttSource(source);
    sttChunkCounters[r] = 0; sttDroppedChunkCounters[r] = 0; pendingPartial[r] = '';
    sessionStarted[r] = false; streaming[r] = false; sockets[r] = null; sequence[r] = 1;
    sttHistoryManager.resetSttHistoryBuffer(r);
  }

  function isSourceStreaming(source) { return Boolean(streaming[normalizeSttSource(source)]); }

  function handleServerMessage(resolved, raw) {
    const frame = parseFrame(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
    if (!frame) return;
    if (frame.messageType === MSG_SERVER_ERROR) {
      let reason = 'Volcengine error';
      try { reason = JSON.parse(frame.payload.toString('utf8')).error || reason; } catch (_) {}
      emitSttDebug({ source: resolved, level: 'error', event: 'server-error', message: reason });
      sendToRenderer('vosk-error', { source: resolved, error: `Doubao error (${resolved}): ${reason}` });
      sttHistoryManager.flushSttHistoryBuffer(resolved, 'server-error');
      resetSourceState(resolved);
      return;
    }
    if (frame.messageType !== MSG_FULL_SERVER) return;

    let parsed;
    try { parsed = JSON.parse(frame.payload.toString('utf8')); } catch (_) { return; }

    if (!sessionStarted[resolved]) {
      sessionStarted[resolved] = true;
      sendToRenderer('vosk-status', { source: resolved, status: 'listening', message: `Listening (${resolved === 'system' ? 'Host' : 'You'})...` });
      emitSttDebug({ source: resolved, event: 'session-begin', message: 'Doubao session started' });
    }

    const result = parsed && parsed.result ? parsed.result : null;
    if (!result) return;
    const rollingText = String(result.text || '').trim();
    const utterances = Array.isArray(result.utterances) ? result.utterances : [];

    // A "definite" utterance is final; otherwise the rolling text is a partial.
    const definite = utterances.filter((u) => u && u.definite && typeof u.text === 'string' && u.text.trim());
    if (definite.length) {
      for (const u of definite) {
        const finalText = u.text.trim();
        sendToRenderer('vosk-final', { source: resolved, text: finalText });
        sttHistoryManager.queueSttHistorySegment(resolved, finalText);
      }
      pendingPartial[resolved] = '';
      emitSttDebug({ source: resolved, event: 'turn-final', message: 'Final transcript', meta: { count: definite.length } });
    } else if (rollingText) {
      pendingPartial[resolved] = rollingText;
      sendToRenderer('vosk-partial', { source: resolved, text: rollingText });
    }
  }

  function startStream(source) {
    const resolved = normalizeSttSource(source);
    const creds = getVolcCredentials() || {};
    const appKey = String(creds.appId || '').trim();
    const accessKey = String(creds.accessToken || '').trim();
    const resourceId = String(creds.resourceId || '').trim() || 'volc.seedasr.sauc.duration';

    if (!appKey || !accessKey) {
      sendToRenderer('vosk-error', { source: resolved, error: 'Doubao APP ID / Access Token not configured. Add them in Settings.' });
      return { success: false, error: 'Doubao credentials not configured.' };
    }
    if (isSourceStreaming(resolved)) {
      return { success: true, message: `${resolved} already streaming` };
    }

    try {
      resetSourceState(resolved);
      sendToRenderer('vosk-status', { source: resolved, status: 'loading', message: `Connecting (${resolved})...` });
      emitSttDebug({ source: resolved, event: 'start-request', message: 'Opening Doubao WebSocket', meta: { resourceId, sampleRate: VOLC_SAMPLE_RATE } });

      const headers = {
        'X-Api-App-Key': appKey,
        'X-Api-Access-Key': accessKey,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': crypto.randomUUID(),
        'X-Api-Connect-Id': crypto.randomUUID()
      };
      const ws = new WebSocket(VOLC_ENDPOINT, { headers });
      sockets[resolved] = ws;

      ws.on('open', () => {
        streaming[resolved] = true;
        sequence[resolved] = 1;
        try {
          ws.send(buildFrame({
            messageType: MSG_FULL_CLIENT, flags: FLAG_POS_SEQ, serialization: SER_JSON, compression: COMP_GZIP,
            sequence: sequence[resolved], payload: buildConfigPayload(resourceId)
          }));
          emitSttDebug({ source: resolved, event: 'ws-open', message: 'Doubao connected; sent config' });
        } catch (e) {
          emitSttDebug({ source: resolved, level: 'error', event: 'config-send-failed', message: e.message });
        }
      });
      ws.on('message', (raw) => handleServerMessage(resolved, raw));
      ws.on('error', (error) => {
        emitSttDebug({ source: resolved, level: 'error', event: 'ws-error', message: error?.message || 'websocket error' });
        sttHistoryManager.flushSttHistoryBuffer(resolved, 'ws-error');
        sendToRenderer('vosk-error', { source: resolved, error: `Connection error (${resolved}): ${error?.message || 'unknown'}` });
        resetSourceState(resolved);
      });
      ws.on('close', (code, reason) => {
        emitSttDebug({ source: resolved, event: 'ws-close', message: 'Doubao WebSocket closed', meta: { code, reason: reason?.toString() || '' } });
        if (streaming[resolved]) {
          const trailing = pendingPartial[resolved];
          if (trailing) { sendToRenderer('vosk-final', { source: resolved, text: trailing }); sttHistoryManager.queueSttHistorySegment(resolved, trailing); }
          sttHistoryManager.flushSttHistoryBuffer(resolved, 'ws-close');
          resetSourceState(resolved);
          sendToRenderer('vosk-stopped', { source: resolved });
        }
      });
      return { success: true };
    } catch (error) {
      emitSttDebug({ source: resolved, level: 'error', event: 'start-failed', message: error?.message || 'start failed' });
      streaming[resolved] = false;
      return { success: false, error: error?.message || 'start failed' };
    }
  }

  function handleAudioChunk({ source, data }) {
    const resolved = normalizeSttSource(source);
    const ws = sockets[resolved];
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        sequence[resolved] += 1;
        ws.send(buildFrame({
          messageType: MSG_AUDIO_ONLY, flags: FLAG_POS_SEQ, serialization: SER_RAW, compression: COMP_GZIP,
          sequence: sequence[resolved], payload: zlib.gzipSync(Buffer.from(data))
        }));
        sttChunkCounters[resolved] += 1;
        if (sttChunkCounters[resolved] % 50 === 0) {
          emitSttDebug({ source: resolved, event: 'chunk-heartbeat', message: 'Streaming audio', meta: { chunks: sttChunkCounters[resolved], dropped: sttDroppedChunkCounters[resolved] } });
        }
      } catch (e) {
        sttDroppedChunkCounters[resolved] += 1;
      }
      return;
    }
    sttDroppedChunkCounters[resolved] += 1;
    if (sttDroppedChunkCounters[resolved] % 25 === 0) {
      emitSttDebug({ source: resolved, level: 'error', event: 'chunk-dropped', message: 'Audio chunk dropped', meta: { dropped: sttDroppedChunkCounters[resolved], readyState: ws ? ws.readyState : 'no-ws' } });
    }
  }

  function stopVoiceRecognition({ source } = {}) {
    const stopSource = (src) => {
      const r = normalizeSttSource(src);
      const ws = sockets[r];
      if (!ws) { sttHistoryManager.flushSttHistoryBuffer(r, 'stop-noop'); sttChunkCounters[r] = 0; sttDroppedChunkCounters[r] = 0; return; }
      try {
        if (ws.readyState === WebSocket.OPEN) {
          // Last audio frame (empty) with the last-packet flag tells the server to finalize.
          sequence[r] += 1;
          ws.send(buildFrame({ messageType: MSG_AUDIO_ONLY, flags: FLAG_LAST_SEQ, serialization: SER_RAW, compression: COMP_GZIP, sequence: -Math.abs(sequence[r]), payload: zlib.gzipSync(Buffer.alloc(0)) }));
        }
      } catch (e) {
        emitSttDebug({ source: r, level: 'error', event: 'stop-error', message: e?.message || 'stop error' });
      }
      sttHistoryManager.flushSttHistoryBuffer(r, 'stop-request');
      sendToRenderer('vosk-status', { source: r, status: 'stopped', message: 'Stopped' });
      streaming[r] = false; sttChunkCounters[r] = 0; sttDroppedChunkCounters[r] = 0;
    };
    if (source === 'all') { stopSource('mic'); stopSource('system'); } else { stopSource(source === 'system' ? 'system' : 'mic'); }
    return { success: true };
  }

  async function getDesktopSources() {
    try { const s = await desktopCapturer.getSources({ types: ['screen'] }); return s.map((x) => ({ id: x.id, name: x.name })); }
    catch (error) { console.error('Error getting desktop sources:', error.message); return []; }
  }

  async function transcribeAudio() {
    return { success: false, error: 'File transcription is not supported with Doubao streaming in this build. Use streaming.' };
  }

  function dispose() {
    sttHistoryManager.flushAllSttHistoryBuffers('cleanup');
    cleanupSocket(sockets.mic); cleanupSocket(sockets.system);
    resetSourceState('mic'); resetSourceState('system');
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

module.exports = { createVolcengineAsrService, buildFrame, parseFrame };
