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
import type { AsrStopResult } from './asr-relay';

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
  /** Native Seed ASR 2.0 acoustic speaker cluster, when supplied. */
  speakerId?: number;
}

export interface VolcSessionDeps {
  /** The `ws` WebSocket constructor (injected so tests can stub the transport). */
  WebSocket: WsConstructor;
  /** Volc APP ID (X-Api-App-Key). Required. */
  appId: string;
  /** Volc Access Token (X-Api-Access-Key). Required. */
  accessToken: string;
  /** Volc Seed-ASR 2.0 resource id. Legacy 1.0 resources are rejected. */
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
  /** Bounded wait for the terminal response after the last-packet frame. */
  stopTimeoutMs?: number;
}

export const VOLC_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
// Seed ASR 2.0 needs the optimized bidirectional endpoint for real rolling
// captions. With enable_nonstream=true it also performs the accurate second
// pass that supplies definite utterances + native speaker clusters. The plain
// /bigmodel endpoint rejects this account's Seed resource, while _nostream
// waits for >15 s / the terminal packet and therefore only looks sentence-live.
export const VOLC_WS_URL_ASYNC = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
export const VOLC_WS_URL_NOSTREAM = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream';

/** Pick the v3 endpoint: Seed ASR 2.0 → optimized bidirectional, legacy → /bigmodel. */
export function endpointForResource(resourceId: string): string {
  return /seedasr/i.test(resourceId) ? VOLC_WS_URL_ASYNC : VOLC_WS_URL;
}
export const VOLC_DEFAULT_SAMPLE_RATE = 16000;
// Long Seed 2.0 utterances can need several seconds to finish speaker
// clustering after the terminal PCM frame. Keep the wait bounded but large
// enough to receive the provider's final negative-sequence response.
export const VOLC_DEFAULT_STOP_TIMEOUT_MS = 6000;
// Product policy: Doubao means Seed-ASR 2.0. Never silently send interview audio
// to the legacy BigASR 1.0 resource when the deployment lacks 2.0 entitlement.
export const VOLC_DEFAULT_RESOURCE_ID = 'volc.seedasr.sauc.duration';
export const VOLC_DEFAULT_MODEL = 'bigmodel';

export function isDoubaoAsr2Resource(resourceId: string): boolean {
  return /^volc\.seedasr\./i.test(resourceId.trim());
}

/** Convert opaque transport failures into a safe, operator-actionable message. */
export function formatDoubaoAsr2Error(message: string): string {
  const normalized = String(message || '').trim();
  if (/\b403\b/.test(normalized)) {
    return '豆包 ASR 2.0 权限不足（HTTP 403），请检查当前 App ID / Access Token 是否已开通所选 Seed-ASR 2.0 资源';
  }
  return normalized || '豆包 ASR 2.0 连接失败';
}

/** Preserve Volcengine's documented `{code,message}` error instead of hiding it. */
export function parseVolcServerError(payload: Buffer): string {
  const raw = payload.toString('utf8').trim();
  if (!raw) return '豆包 ASR 2.0 返回了空错误响应';
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const nestedError =
      typeof value.error === 'object' && value.error !== null
        ? (value.error as Record<string, unknown>)
        : null;
    const message = [
      typeof value.error === 'string' ? value.error : '',
      typeof value.message === 'string' ? value.message : '',
      typeof value.msg === 'string' ? value.msg : '',
      typeof nestedError?.message === 'string' ? nestedError.message : '',
      typeof nestedError?.Message === 'string' ? nestedError.Message : ''
    ].find((candidate) => candidate.trim().length > 0)?.trim();
    const code = [value.code, value.status_code, nestedError?.code, nestedError?.Code].find(
      (candidate) =>
        (typeof candidate === 'number' && Number.isFinite(candidate)) ||
        (typeof candidate === 'string' && candidate.trim().length > 0)
    );
    if (message && code !== undefined) return `${message}（错误码 ${String(code)}）`;
    if (message) return message;
    if (code !== undefined) return `豆包 ASR 2.0 请求失败（错误码 ${String(code)}）`;
  } catch {
    // Some upstream/proxy failures are plain text; preserve that text verbatim.
  }
  return raw;
}

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
  flags: number;
  sequence: number | null;
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
  let sequence: number | null = null;
  if (flags === FLAG_POS_SEQ || flags === FLAG_LAST_SEQ) {
    if (buf.length < offset + 4) return { messageType, flags, sequence, payload: Buffer.alloc(0) };
    sequence = buf.readInt32BE(offset);
    offset += 4;
  }
  if (buf.length < offset + 4) return { messageType, flags, sequence, payload: Buffer.alloc(0) };
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
  return { messageType, flags, sequence, payload };
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
      show_utterances: true,
      // Optimized bidirectional mode: expose fast rolling text, then replace it
      // with the accurate nostream second pass that carries definite/speaker.
      enable_nonstream: true,
      enable_accelerate_text: true,
      // Mid-range acceleration keeps first text responsive without maximizing
      // provisional-hypothesis churn; the second pass remains final truth.
      accelerate_score: 10,
      enable_speaker_info: true,
      ssd_version: '200'
    }
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(config), 'utf8'));
}

function asSpeakerId(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const speakerId = typeof value === 'number' ? value : Number(value.trim());
  return Number.isInteger(speakerId) && speakerId >= 0 ? speakerId : undefined;
}

function speakerIdFromRecord(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['speakerId', 'speaker_id', 'speaker'] as const) {
    const speakerId = asSpeakerId(record[key]);
    if (speakerId !== undefined) return speakerId;
  }
  return undefined;
}

function speakerIdFromUtterance(utterance: Record<string, unknown>): number | undefined {
  const direct = speakerIdFromRecord(utterance);
  if (direct !== undefined) return direct;

  let additions: unknown = utterance.additions;
  if (typeof additions === 'string') {
    try {
      additions = JSON.parse(additions);
    } catch {
      return undefined;
    }
  }
  return speakerIdFromRecord(additions);
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
  const definite = utterances.flatMap((utterance): VolcTranscript[] => {
    if (!utterance || typeof utterance !== 'object' || Array.isArray(utterance)) return [];
    const record = utterance as Record<string, unknown>;
    if (record.definite !== true || typeof record.text !== 'string') return [];
    const text = record.text.trim();
    if (!text) return [];
    const speakerId = speakerIdFromUtterance(record);
    return [{ text, isFinal: true, ...(speakerId === undefined ? {} : { speakerId }) }];
  });
  if (definite.length) {
    return definite;
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
  stop(): Promise<AsrStopResult>;
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
  const stopTimeoutMs = deps.stopTimeoutMs ?? VOLC_DEFAULT_STOP_TIMEOUT_MS;

  let ready = false;
  let started = false; // true once the first server frame arrives (session-begin)
  let finished = false;
  let stopRequested = false;
  let finalReceived = false;
  let sequence = 1;
  let socket: WsLike | null = null;
  // Keep one real PCM frame in hand so stop() can mark actual audio—not an
  // empty synthetic packet—as the protocol's negative-sequence last packet.
  // This adds at most one browser worklet frame of latency (normally 40 ms).
  let pendingPcm: Buffer | null = null;
  let stopPromise: Promise<AsrStopResult> | null = null;
  let resolveStop: ((result: AsrStopResult) => void) | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  function fail(message: string): void {
    if (finished) return;
    const safeMessage = formatDoubaoAsr2Error(message);
    try {
      onError?.(safeMessage);
    } finally {
      if (stopPromise) {
        finishStop({ finalReceived, timedOut: false, reason: safeMessage }, false);
      } else {
        finished = true;
        ready = false;
        teardown(false);
      }
    }
  }

  function teardown(graceful: boolean): void {
    const sock = socket;
    socket = null;
    if (!sock) return;
    try {
      if (graceful || typeof sock.terminate !== 'function') sock.close();
      else sock.terminate();
    } catch {
      /* ignore teardown errors */
    }
  }

  function finishStop(result: AsrStopResult, graceful: boolean): void {
    const resolve = resolveStop;
    if (!resolve) return;
    resolveStop = null;
    if (stopTimer !== null) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    finished = true;
    ready = false;
    teardown(graceful);
    resolve(result);
  }

  if (!isDoubaoAsr2Resource(resourceId)) {
    fail('Doubao ASR 2.0 requires a volc.seedasr.* resource');
    return inertSession();
  }

  function handleServerFrame(raw: unknown): void {
    if (finished) return;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const frame = parseFrame(buf);
    if (!frame) return;
    if (frame.messageType === MSG_SERVER_ERROR) {
      fail(parseVolcServerError(frame.payload));
      return;
    }
    if (frame.messageType !== MSG_FULL_SERVER) return;
    if (!started) {
      started = true;
      ready = true;
      onReady?.();
    }
    for (const t of extractTranscripts(frame.payload)) {
      if (t.isFinal) finalReceived = true;
      onTranscript(t);
    }
    if (stopPromise && (frame.flags === FLAG_LAST_SEQ || (frame.sequence ?? 0) < 0)) {
      finishStop({ finalReceived, timedOut: false }, true);
    }
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
    if (wasFinished) return;
    if (stopPromise) {
      finishStop(
        {
          finalReceived,
          timedOut: false,
          reason: 'Doubao socket closed before the terminal response'
        },
        false
      );
      return;
    }
    fail('Doubao socket closed unexpectedly');
  });

  function sendAudio(pcm: Buffer): void {
    if (finished || stopRequested || !socket) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      if (pendingPcm) {
        sequence += 1;
        socket.send(
          buildFrame({
            messageType: MSG_AUDIO_ONLY,
            flags: FLAG_POS_SEQ,
            serialization: SER_RAW,
            compression: COMP_GZIP,
            sequence,
            payload: zlib.gzipSync(pendingPcm)
          })
        );
      }
      pendingPcm = Buffer.from(pcm);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'failed to send audio frame');
    }
  }

  function stop(): Promise<AsrStopResult> {
    if (stopPromise) return stopPromise;
    if (finished) {
      return Promise.resolve({
        finalReceived,
        timedOut: false,
        reason: 'Doubao session already closed'
      });
    }
    stopRequested = true;
    stopPromise = new Promise<AsrStopResult>((resolve) => {
      resolveStop = resolve;
    });
    const sock = socket;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      finishStop({ finalReceived, timedOut: false, reason: 'Doubao socket is not open' }, false);
      return stopPromise;
    }
    try {
      // Seed ASR expects the final real audio segment itself to carry the
      // negative sequence / last-packet flag. An empty follow-up can leave the
      // nostream endpoint waiting indefinitely.
      sequence += 1;
      const terminalPcm = pendingPcm ?? Buffer.alloc(0);
      pendingPcm = null;
      sock.send(
        buildFrame({
          messageType: MSG_AUDIO_ONLY,
          flags: FLAG_LAST_SEQ,
          serialization: SER_RAW,
          compression: COMP_GZIP,
          sequence: -Math.abs(sequence),
          payload: zlib.gzipSync(terminalPcm)
        })
      );
    } catch (error) {
      finishStop(
        {
          finalReceived,
          timedOut: false,
          reason: error instanceof Error ? error.message : 'failed to send Doubao last packet'
        },
        false
      );
      return stopPromise;
    }
    stopTimer = setTimeout(() => {
      finishStop(
        { finalReceived, timedOut: true, reason: 'Doubao finalization timeout' },
        false
      );
    }, Math.max(1, stopTimeoutMs));
    return stopPromise;
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
    async stop() {
      return {
        finalReceived: false,
        timedOut: false,
        reason: 'Doubao session unavailable'
      };
    },
    get isReady() {
      return false;
    }
  };
}
