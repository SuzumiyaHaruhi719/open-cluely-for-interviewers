// ============================================================================
// Volcengine / Doubao (豆包) realtime ASR client (focused, web edition)
// ----------------------------------------------------------------------------
// REUSE NOTE: this mirrors paraformer-client.ts's shape (injected WS ctor +
// onTranscript/onReady/onError, a session with sendAudio/stop/isReady) so it
// drops into the same asr-relay slot. The binary FRAME PROTOCOL (header layout,
// gzip, sequence) and the `result`/`utterances.definite` parsing are PORTED
// VERBATIM from the proven desktop client at
//   src/services/volcengine-asr/service.js
// (buildFrame / parseFrame / config payload / handleServerMessage). We ported
// rather than imported because the desktop module is CommonJS + Electron-shaped
// (emits `vosk-*` channels, normalizes mic/system, pulls a stt-history merger)
// and the test contract in test/volcengine-frame.test.js exercises the same
// build→parse round-trip we reproduce here.
//
// Endpoint:  wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
// Auth:      headers X-Api-App-Key (APP ID), X-Api-Access-Key (Access Token),
//            X-Api-Resource-Id. v3 needs APP ID + Access Token only (no secret).
// Audio:     raw 16 kHz / 16-bit LE / mono PCM (the browser worklet emits this).
//
// Binary frame (big-endian):
//   byte0: (protocolVersion<<4) | headerSize(4-byte units, =1)
//   byte1: (messageType<<4) | flags
//   byte2: (serialization<<4) | compression
//   byte3: reserved (0)
//   [int32 sequence]      — present when flags has the seq bit
//   uint32 payloadSize
//   payload               — gzip(JSON) for config, gzip(PCM) for audio
// ============================================================================

import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

// Minimal structural type for the `ws` WebSocket we depend on — declared here
// (like paraformer-client) so tests can inject a fake constructor without
// pulling the real socket in.
export interface WsLike {
  readonly readyState: number;
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: any[]) => void): void;
  send(data: string | Buffer): void;
  close(): void;
  terminate?(): void;
}

export interface WsConstructor {
  new (url: string, options?: { headers?: Record<string, string> }): WsLike;
  readonly OPEN: number;
}

/** A recognized sentence (partial or final) — same shape as Paraformer's. */
export interface VolcTranscript {
  text: string;
  isFinal: boolean;
}

export interface VolcSessionDeps {
  /** The `ws` WebSocket constructor (injected so tests can stub the transport). */
  WebSocket: WsConstructor;
  /** Volc APP ID (X-Api-App-Key). Required. */
  appId: string;
  /** Volc Access Token (X-Api-Access-Key). Required. */
  accessToken: string;
  /** Volc resource id. Defaults to the 1.0 hourly model most accounts have. */
  resourceId?: string;
  /** Optional model name override for the config frame (`request.model_name`). */
  model?: string;
  /** Sample rate of the PCM we forward. Browser worklet emits 16 kHz. */
  sampleRate?: number;
  /** Called for every partial/final transcript this session produces. */
  onTranscript: (t: VolcTranscript) => void;
  /** Called once when the upstream session is ready (first server frame). */
  onReady?: () => void;
  /** Called on a terminal error with a human-readable message. */
  onError?: (message: string) => void;
}

export const VOLC_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
// The seedasr (2.0) models are rejected on /bigmodel (handshake HTTP 400
// "resourceId not allowed") and must use /bigmodel_nostream; the bigasr (1.0)
// models work on /bigmodel. Verified live against the account.
export const VOLC_WS_URL_NOSTREAM = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream';

/** Pick the v3 endpoint a resource id is served on: seedasr (2.0) → nostream, else /bigmodel. */
export function endpointForResource(resourceId: string): string {
  return /seedasr/i.test(resourceId) ? VOLC_WS_URL_NOSTREAM : VOLC_WS_URL;
}
export const VOLC_DEFAULT_SAMPLE_RATE = 16000;
// Default to the 1.0 hourly model — the resource most accounts have granted.
// The 2.0 (volc.seedasr.*) model must be explicitly enabled on the account or
// the handshake returns 400 "resourceId not allowed" (per the desktop client).
export const VOLC_DEFAULT_RESOURCE_ID = 'volc.bigasr.sauc.duration';
export const VOLC_DEFAULT_MODEL = 'bigmodel';

// --- Frame protocol constants (PORTED VERBATIM from the desktop service) -----
const PROTOCOL_VERSION = 0x1;
const HEADER_SIZE = 0x1;
const MSG_FULL_CLIENT = 0x1;
const MSG_AUDIO_ONLY = 0x2;
const MSG_FULL_SERVER = 0x9;
const MSG_SERVER_ERROR = 0xf;
const FLAG_POS_SEQ = 0x1;
const FLAG_LAST_SEQ = 0x3;
const SER_JSON = 0x1;
const SER_RAW = 0x0;
const COMP_GZIP = 0x1;

export interface FrameInput {
  messageType: number;
  flags: number;
  serialization: number;
  compression: number;
  sequence: number;
  payload: Buffer;
}

export interface ParsedFrame {
  messageType: number;
  payload: Buffer;
}

/**
 * Build a Volcengine binary frame. PORTED VERBATIM from the desktop service's
 * `buildFrame` (src/services/volcengine-asr/service.js) — same byte layout, seq
 * placement, and big-endian payload size.
 */
export function buildFrame({
  messageType,
  flags,
  serialization,
  compression,
  sequence,
  payload
}: FrameInput): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  header[1] = (messageType << 4) | flags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0;
  const parts: Buffer[] = [header];
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

/**
 * Parse a server frame → { messageType, payload (un-gzipped if needed) }.
 * PORTED VERBATIM from the desktop service's `parseFrame`.
 */
export function parseFrame(buf: Buffer): ParsedFrame | null {
  if (!buf || buf.length < 4) return null;
  const messageType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;
  const compression = buf[2] & 0x0f;
  let offset = 4;
  if (flags === FLAG_POS_SEQ || flags === FLAG_LAST_SEQ) offset += 4; // skip seq
  if (buf.length < offset + 4) return { messageType, payload: Buffer.alloc(0) };
  const payloadSize = buf.readUInt32BE(offset);
  offset += 4;
  let payload = buf.subarray(offset, offset + payloadSize);
  if (compression === COMP_GZIP && payload.length) {
    try {
      payload = zlib.gunzipSync(payload);
    } catch {
      /* leave raw */
    }
  }
  return { messageType, payload };
}

/** Build the gzip(JSON) config payload sent on open. Mirrors the desktop service. */
export function buildConfigPayload(model: string, sampleRate: number): Buffer {
  const config = {
    user: { uid: 'open-cluely-web' },
    audio: { format: 'pcm', rate: sampleRate, bits: 16, channel: 1 },
    request: {
      model_name: model,
      enable_punc: true,
      result_type: 'single',
      show_utterances: true
    }
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(config), 'utf8'));
}

/**
 * Extract transcripts from a parsed `full-server-response` payload. Mirrors the
 * desktop `handleServerMessage`: a "definite" utterance is FINAL; otherwise the
 * rolling `result.text` is a PARTIAL. Returns every transcript the frame yields
 * (0..n finals, or 1 partial), so the caller can emit each in order.
 */
export function extractTranscripts(payload: Buffer): VolcTranscript[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    return [];
  }
  const result = (parsed as { result?: unknown }).result as
    | { text?: unknown; utterances?: unknown }
    | undefined;
  if (!result || typeof result !== 'object') return [];

  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  const definite = utterances
    .filter(
      (u): u is { text: string; definite: boolean } =>
        !!u && (u as { definite?: unknown }).definite === true && typeof (u as { text?: unknown }).text === 'string'
    )
    .map((u) => u.text.trim())
    .filter((t) => t.length > 0);
  if (definite.length) {
    return definite.map((text) => ({ text, isFinal: true as const }));
  }
  const rollingText = typeof result.text === 'string' ? result.text.trim() : '';
  if (rollingText) return [{ text: rollingText, isFinal: false }];
  return [];
}

/** A single live Volc recognition session over one upstream WebSocket. */
export interface VolcSession {
  /** Forward one PCM frame (16-bit LE mono) to the recognizer. */
  sendAudio(pcm: Buffer): void;
  /** Gracefully finish (send the last-packet frame) and close the socket. */
  stop(): void;
  /** True once the upstream session is ready to accept audio. */
  readonly isReady: boolean;
}

/**
 * Open a Doubao / Volcengine realtime ASR session. The socket connects with the
 * access-token auth headers, sends the gzip config frame on open, then forwards
 * gzip'd PCM audio frames with an incrementing sequence. Server `result` frames
 * become onTranscript calls. Audio sent before the socket is OPEN is dropped
 * (the desktop client behaves the same).
 */
export function createVolcSession(deps: VolcSessionDeps): VolcSession {
  const { WebSocket, appId, accessToken, onTranscript, onReady, onError } = deps;
  const resourceId = (deps.resourceId ?? '').trim() || VOLC_DEFAULT_RESOURCE_ID;
  const model = (deps.model ?? '').trim() || VOLC_DEFAULT_MODEL;
  const sampleRate = deps.sampleRate ?? VOLC_DEFAULT_SAMPLE_RATE;

  let ready = false;
  let started = false; // true once the first server frame arrives (session-begin)
  let finished = false;
  let sequence = 1;
  let socket: WsLike | null = null;

  function fail(message: string): void {
    if (finished) return;
    finished = true;
    try {
      onError?.(message);
    } finally {
      teardown();
    }
  }

  function teardown(): void {
    const sock = socket;
    socket = null;
    if (!sock) return;
    try {
      if (typeof sock.terminate === 'function') sock.terminate();
      else sock.close();
    } catch {
      /* ignore teardown errors */
    }
  }

  function handleServerFrame(raw: unknown): void {
    if (finished) return;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const frame = parseFrame(buf);
    if (!frame) return;
    if (frame.messageType === MSG_SERVER_ERROR) {
      let reason = 'Volcengine error';
      try {
        reason = JSON.parse(frame.payload.toString('utf8')).error || reason;
      } catch {
        /* keep default */
      }
      fail(reason);
      return;
    }
    if (frame.messageType !== MSG_FULL_SERVER) return;
    if (!started) {
      started = true;
      ready = true;
      onReady?.();
    }
    for (const t of extractTranscripts(frame.payload)) onTranscript(t);
  }

  try {
    socket = new WebSocket(endpointForResource(resourceId), {
      headers: {
        'X-Api-App-Key': appId,
        'X-Api-Access-Key': accessToken,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': randomUUID(),
        'X-Api-Connect-Id': randomUUID()
      }
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : 'failed to open Doubao socket');
    return inertSession();
  }

  socket.on('open', () => {
    try {
      socket?.send(
        buildFrame({
          messageType: MSG_FULL_CLIENT,
          flags: FLAG_POS_SEQ,
          serialization: SER_JSON,
          compression: COMP_GZIP,
          sequence,
          payload: buildConfigPayload(model, sampleRate)
        })
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : 'failed to send Doubao config');
    }
  });

  socket.on('message', (raw: unknown) => handleServerFrame(raw));

  socket.on('error', (err: unknown) => {
    fail(err instanceof Error ? err.message : 'Doubao socket error');
  });

  socket.on('close', () => {
    const wasFinished = finished;
    socket = null;
    // Unexpected drop (not our own stop()): surface it so the relay tears the
    // source down instead of silently swallowing all further audio. fail() is a
    // no-op once finished, so a normal stop()->close does not double-fire.
    if (!wasFinished) fail('Doubao socket closed unexpectedly');
  });

  function sendAudio(pcm: Buffer): void {
    if (finished || !socket) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      sequence += 1;
      socket.send(
        buildFrame({
          messageType: MSG_AUDIO_ONLY,
          flags: FLAG_POS_SEQ,
          serialization: SER_RAW,
          compression: COMP_GZIP,
          sequence,
          payload: zlib.gzipSync(pcm)
        })
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : 'failed to send audio frame');
    }
  }

  function stop(): void {
    if (finished) {
      teardown();
      return;
    }
    finished = true;
    const sock = socket;
    try {
      if (sock && sock.readyState === WebSocket.OPEN) {
        // Empty audio frame with the last-packet flag tells the server to finalize.
        sequence += 1;
        sock.send(
          buildFrame({
            messageType: MSG_AUDIO_ONLY,
            flags: FLAG_LAST_SEQ,
            serialization: SER_RAW,
            compression: COMP_GZIP,
            sequence: -Math.abs(sequence),
            payload: zlib.gzipSync(Buffer.alloc(0))
          })
        );
      }
    } catch {
      /* ignore — we're tearing down anyway */
    }
    teardown();
  }

  return {
    sendAudio,
    stop,
    get isReady() {
      return ready;
    }
  };
}

/** A session that does nothing — returned when the socket failed to open. */
function inertSession(): VolcSession {
  return {
    sendAudio() {
      /* no-op */
    },
    stop() {
      /* no-op */
    },
    get isReady() {
      return false;
    }
  };
}
