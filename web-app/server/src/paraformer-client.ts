// ============================================================================
// Paraformer realtime ASR client (focused, web edition)
// ----------------------------------------------------------------------------
// REUSE NOTE: this is a focused re-implementation of the proven WS protocol in
// the desktop app (src/services/paraformer/service.js). We deliberately did NOT
// consume the desktop `createParaformerService` factory directly because it is
// Electron-renderer-shaped:
//   * it emits Electron `vosk-*` channels and pulls in desktopCapturer +
//     getGeminiService + a stt-history merger we don't need on the server;
//   * it normalizes sources to mic/system (web uses mic/display) and collapses
//     any non-'system' source to the SAME 'mic' socket slot, which would make
//     our two independent lanes (interviewer mic + interviewee display) collide;
//   * it hardcodes the Chinese-only `paraformer-realtime-8k-v2` model and
//     downsamples 16k->8k, whereas the browser already emits 16k mono s16le and
//     interviews are commonly English.
// What we REUSE verbatim from the desktop service: the run-task payload shape,
// the `result-generated` -> payload.output.sentence parsing with the
// `sentence_end` final flag, and the finish-task close handshake. The desktop
// factory is still re-exported from @open-cluely/copilot-core for parity.
//
// Protocol (https://help.aliyun.com/zh/model-studio/paraformer-real-time):
//   1. open wss with `Authorization: Bearer <DASHSCOPE_API_KEY>`
//   2. send a run-task JSON event (task_id, streaming=duplex)
//   3. on `task-started`, stream binary PCM frames (16 kHz, 16-bit LE, mono)
//   4. receive `result-generated` events; payload.output.sentence carries text
//      + sentence_end (false => partial, true => final)
//   5. send finish-task to close; server replies `task-finished`.
// ============================================================================

import { randomUUID } from 'node:crypto';

// Minimal structural type for the `ws` WebSocket we depend on. Declaring it
// here (instead of importing ws's types) lets tests inject a fake constructor
// without pulling the real socket in.
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

/** A recognized sentence (partial or final). */
export interface ParaformerTranscript {
  text: string;
  isFinal: boolean;
}

export interface ParaformerSessionDeps {
  /** The `ws` WebSocket constructor (injected so tests can stub the transport). */
  WebSocket: WsConstructor;
  apiKey: string;
  /** Sample rate of the PCM we forward. Browser worklet emits 16 kHz. */
  sampleRate?: number;
  /** DashScope model id. Defaults to the multilingual 16k realtime model. */
  model?: string;
  /** Called for every partial/final transcript this session produces. */
  onTranscript: (t: ParaformerTranscript) => void;
  /** Called once when the upstream task is ready to accept audio. */
  onReady?: () => void;
  /** Called on a terminal error with a human-readable message. */
  onError?: (message: string) => void;
}

export const PARAFORMER_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
export const PARAFORMER_DEFAULT_MODEL = 'paraformer-realtime-v2';
export const PARAFORMER_DEFAULT_SAMPLE_RATE = 16000;
/** The browser worklet always emits 16 kHz mono s16le (see web/src/lib/pcm.ts). */
export const BROWSER_INPUT_SAMPLE_RATE = 16000;

/**
 * Block-average downsample an int16 LE buffer (ported VERBATIM from the desktop
 * service's downsampleInt16Buffer). Used when the chosen model expects a lower
 * rate (e.g. paraformer-realtime-8k-v2 wants 8 kHz) than the browser's 16 kHz.
 */
export function downsampleInt16Buffer(buffer: Buffer, inputRate: number, outputRate: number): Buffer {
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

interface RunTaskPayload {
  header: { action: 'run-task'; task_id: string; streaming: 'duplex' };
  payload: {
    task_group: 'audio';
    task: 'asr';
    function: 'recognition';
    model: string;
    parameters: { sample_rate: number; format: 'pcm' };
    input: Record<string, never>;
  };
}

function buildRunTaskPayload(taskId: string, model: string, sampleRate: number): RunTaskPayload {
  return {
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model,
      parameters: { sample_rate: sampleRate, format: 'pcm' },
      input: {}
    }
  };
}

function buildFinishTaskPayload(taskId: string) {
  return {
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} }
  };
}

/**
 * Pull the recognized sentence out of a `result-generated` event. Mirrors the
 * desktop service's extractSentence: text + a sentence_end/end_flag final flag.
 */
export function extractSentence(msg: unknown): ParaformerTranscript | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const output = (msg as { payload?: { output?: unknown } }).payload?.output as
    | { sentence?: unknown }
    | undefined;
  const sentence = output?.sentence as
    | { text?: unknown; sentence_end?: unknown; end_flag?: unknown }
    | undefined;
  if (!sentence || typeof sentence !== 'object') return null;
  const text = typeof sentence.text === 'string' ? sentence.text.trim() : '';
  if (!text) return null;
  const isFinal = sentence.sentence_end === true || sentence.end_flag === true;
  return { text, isFinal };
}

/** A single live Paraformer recognition session over one upstream WebSocket. */
export interface ParaformerSession {
  /** Forward one PCM frame (16-bit LE mono) to the recognizer. */
  sendAudio(pcm: Buffer): void;
  /** Gracefully finish the task and close the socket. */
  stop(): void;
  /** True once the upstream task-started event has been received. */
  readonly isReady: boolean;
}

/**
 * Open a Paraformer realtime session. The socket connects, sends run-task, and
 * begins forwarding audio once `task-started` arrives. Audio sent before the
 * task is ready is dropped (the desktop client does the same) — callers should
 * buffer at the capture layer if they need zero-loss.
 */
export function createParaformerSession(deps: ParaformerSessionDeps): ParaformerSession {
  const { WebSocket, apiKey, onTranscript, onReady, onError } = deps;
  const model = deps.model ?? PARAFORMER_DEFAULT_MODEL;
  const sampleRate = deps.sampleRate ?? PARAFORMER_DEFAULT_SAMPLE_RATE;
  const taskId = randomUUID().replace(/-/g, '');

  let ready = false;
  let finished = false;
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

  try {
    socket = new WebSocket(PARAFORMER_WS_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, 'X-DashScope-DataInspection': 'enable' }
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : 'failed to open ASR socket');
    return inertSession();
  }

  socket.on('open', () => {
    try {
      socket?.send(JSON.stringify(buildRunTaskPayload(taskId, model, sampleRate)));
    } catch (err) {
      fail(err instanceof Error ? err.message : 'failed to send run-task');
    }
  });

  socket.on('message', (raw: unknown, isBinary?: boolean) => {
    if (finished) return; // session ended (stop()/task-finished/failed) — drop late frames
    if (isBinary) return; // Paraformer replies with JSON only.
    let msg: { header?: { event?: string; error_message?: string; error_code?: string } };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return; // ignore unparseable frames
    }
    const event = msg.header?.event;
    if (event === 'task-started') {
      ready = true;
      onReady?.();
      return;
    }
    if (event === 'result-generated') {
      const sentence = extractSentence(msg);
      if (sentence) onTranscript(sentence);
      return;
    }
    if (event === 'task-finished') {
      finished = true;
      teardown();
      return;
    }
    if (event === 'task-failed') {
      fail(msg.header?.error_message || msg.header?.error_code || 'ASR task failed');
    }
  });

  socket.on('error', (err: unknown) => {
    fail(err instanceof Error ? err.message : 'ASR socket error');
  });

  socket.on('close', () => {
    const wasFinished = finished;
    socket = null;
    // Unexpected drop (not our own stop()/task-finished): surface it so the relay
    // tears the source down instead of silently swallowing audio. fail() is a no-op
    // once finished, so a normal stop()/task-finished -> close does not double-fire.
    if (!wasFinished) fail('Paraformer socket closed unexpectedly');
  });

  function sendAudio(pcm: Buffer): void {
    if (finished || !ready || !socket) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    // The browser always emits 16 kHz; downsample if the model wants less.
    const framed =
      sampleRate < BROWSER_INPUT_SAMPLE_RATE
        ? downsampleInt16Buffer(pcm, BROWSER_INPUT_SAMPLE_RATE, sampleRate)
        : pcm;
    try {
      socket.send(framed);
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
        sock.send(JSON.stringify(buildFinishTaskPayload(taskId)));
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
function inertSession(): ParaformerSession {
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
