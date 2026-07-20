// ============================================================================
// iFlytek (讯飞) 实时语音转写大模型 ASR client (web edition).
// ----------------------------------------------------------------------------
// REUSE NOTE: this mirrors volc-client.ts's exported shape (injected `ws` ctor +
// onTranscript/onReady/onError, a session with sendAudio/stop/isReady) so it
// drops into the same asr-relay slot. UNLIKE volc/paraformer, ONE cloud call
// returns BOTH the text AND the speaker id (角色分离 role_type=2) — so the relay
// uses the PLAIN text-session path for 'xfyun' and forwards the speakerId this
// client emits directly for downstream Flash role mapping.
//
// Endpoint:   ${XFYUN_WS_URL}/ast/communicate/v1?<signed query>
// Auth:       carried entirely in the handshake query params (HMAC-SHA1
//             signature over the sorted, url-encoded params) — no headers.
// Audio:      raw 16 kHz / 16-bit LE / mono PCM forwarded AS-IS as binary WS
//             frames (NO downsample — xfyun wants 16k). A TEXT frame
//             `{"end":true}` signals end-of-stream.
//
// PROTOCOL (verified live by a probe: handshake 101 + action:started + result):
//   - {"data":{"action":"started",...},"msg_type":"action"} → session ready.
//   - {"msg_type":"result","res_type":"asr","data":{"cn":{"st":{
//        "rt":[{"ws":[{"cw":[{"w":"词","rl":"0",...}], ...}]}],
//        "type":"0"|"1", ...}}, "ls":true|false}}
//       * Words = data.cn.st.rt[].ws[].cw[] each with its OWN `rl` (角色分离).
//       * type==="0" (string) = FINAL; "1" = intermediate/partial.
//       * Speaker is PER WORD: `rl="0"` = continue previous speaker, non-zero =
//         a distinct role. On FINALS we SPLIT a frame into consecutive
//         same-speaker runs (so fast hand-offs aren't collapsed to one speaker)
//         and emit each run with its own parseInt(rl,10) speaker. Partials carry
//         no speaker.
//   - action:"error" OR a top-level `code` !== "0" → onError(code/desc).
// ============================================================================

import crypto from 'node:crypto';
import type { AsrStopResult } from './asr-relay';

// Minimal structural type for the `ws` WebSocket we depend on — declared here
// (like volc-client) so tests can inject a fake constructor without pulling the
// real socket in.
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

/** A recognized segment (partial or final) — text + (on finals) the speaker id. */
export interface XfyunTranscript {
  text: string;
  isFinal: boolean;
  /** Speaker id from the `rl` field (角色分离). Present on finals; null otherwise. */
  speakerId?: number | null;
}

export interface XfyunSessionDeps {
  /** The `ws` WebSocket constructor (injected so tests can stub the transport). */
  WebSocket: WsConstructor;
  /** iFlytek APP ID (handshake `appId`). Required. */
  appId: string;
  /** iFlytek API key (handshake `accessKeyId`). Required. */
  apiKey: string;
  /** iFlytek API secret (HMAC-SHA1 signing key). Required. */
  apiSecret: string;
  /** Base WS URL, e.g. 'wss://office-api-ast-dx.iflyaisol.com/'. */
  wsUrl: string;
  /** Sample rate of the PCM we forward. xfyun wants 16 kHz (do NOT downsample). */
  sampleRate?: number;
  /** Called for every partial/final transcript this session produces. */
  onTranscript: (t: XfyunTranscript) => void;
  /** Called once when the upstream session is ready (action:started). */
  onReady?: () => void;
  /** Called on a terminal error with a human-readable message. */
  onError?: (message: string) => void;
  /** Bounded wait for the provider's last result after `{end:true}`. */
  stopTimeoutMs?: number;
}

export const XFYUN_DEFAULT_WS_URL = 'wss://office-api-ast-dx.iflyaisol.com/';
export const XFYUN_DEFAULT_SAMPLE_RATE = 16000;
export const XFYUN_DEFAULT_STOP_TIMEOUT_MS = 1500;

/** Recover provider detail that Node's HTTP parser hides behind an invalid-status error. */
export function formatXfyunTransportError(error: unknown): string {
  const value = error as { message?: unknown; rawPacket?: unknown } | null;
  const rawPacket = value?.rawPacket;
  const raw = Buffer.isBuffer(rawPacket)
    ? rawPacket.toString('utf8')
    : rawPacket instanceof Uint8Array
      ? Buffer.from(rawPacket).toString('utf8')
      : '';
  if (/\b35022\b|usedQuantity exceeds the limit/i.test(raw)) {
    return '讯飞实时转写额度已用尽（35022），请在讯飞控制台续费或补充可用额度';
  }
  return typeof value?.message === 'string' && value.message.trim()
    ? value.message.trim()
    : '讯飞实时转写连接失败';
}

/** Format a Date as ISO8601 with a fixed +0800 offset, e.g. 2026-06-04T15:39:44+0800. */
export function utcPlus0800(now: Date = new Date()): string {
  // Shift to UTC+8 then render the wall-clock parts; append the literal +0800.
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+0800`
  );
}

/**
 * Build the signed handshake URL. VERIFIED signature scheme: baseString = all
 * params EXCEPT signature, sorted ascending by key, each as
 * `encodeURIComponent(k)=encodeURIComponent(v)`, joined with '&'; then
 * signature = HMAC-SHA1(apiSecret, baseString) base64. Final URL appends
 * `&signature=<encoded signature>`.
 */
export function buildSignedUrl(deps: {
  appId: string;
  apiKey: string;
  apiSecret: string;
  wsUrl: string;
  sampleRate: number;
  now?: Date;
  uuid?: string;
}): string {
  const base = deps.wsUrl.replace(/\/+$/, '') + '/ast/communicate/v1?';
  const params: Record<string, string> = {
    accessKeyId: deps.apiKey,
    appId: deps.appId,
    audio_encode: 'pcm_s16le',
    lang: 'autodialect',
    role_type: '2',
    samplerate: String(deps.sampleRate),
    utc: utcPlus0800(deps.now),
    uuid: deps.uuid ?? crypto.randomUUID()
  };
  const baseString = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const signature = crypto.createHmac('sha1', deps.apiSecret).update(baseString).digest('base64');
  return base + baseString + '&signature=' + encodeURIComponent(signature);
}

/**
 * Extract transcript RUNS from a parsed `result` frame's `data`.
 *
 * iFlytek 角色分离 (role_type=2) tags `rl` PER WORD, and during fast turn-taking it
 * packs BOTH speakers' words into ONE `result` frame with different `rl` per word
 * (`rl="0"` = "continue the previous speaker"; non-zero values are distinct roles).
 * Collapsing such a frame to a single speaker mislabels everyone after the first
 * hand-off. So we SPLIT the frame into consecutive same-speaker RUNS:
 *
 *   • Walk words in order; "current speaker" starts at the carried `prevSpeaker`
 *     (last-known across frames, default 0).
 *   • rl="0" / missing / non-numeric = continue the current speaker.
 *   • A non-zero rl that DIFFERS from the current speaker starts a NEW run.
 *   • Each run's words are concatenated into its own text; on a FINAL frame each
 *     run becomes a final transcript carrying that run's `speakerId`.
 *
 * Partials (st.type !== "0") are transient, so we keep the old behavior: ONE run
 * of the concatenated text with `speakerId: null` (no per-word splitting).
 *
 * Returns the runs plus the speaker to carry forward (the LAST run's speaker, so
 * a following frame that opens with rl="0" inherits it). Returns null when the
 * frame has no recognizable words.
 */
export function extractResult(
  data: unknown,
  prevSpeaker: number | null
): { runs: XfyunTranscript[]; speaker: number | null } | null {
  const st = (data as { cn?: { st?: unknown } })?.cn?.st as
    | { rt?: unknown; type?: unknown }
    | undefined;
  if (!st || typeof st !== 'object') return null;

  // type is a STRING per the protocol: "0" = final, "1" = intermediate/partial.
  const isFinal = String(st.type) === '0';

  // Flatten the frame to an ordered list of { w, rl } words.
  const rtArr = Array.isArray(st.rt) ? st.rt : [];
  const words: Array<{ w: string; rl: number | null }> = [];
  for (const rt of rtArr) {
    const wsArr = Array.isArray((rt as { ws?: unknown })?.ws) ? (rt as { ws: unknown[] }).ws : [];
    for (const wsItem of wsArr) {
      const cwArr = Array.isArray((wsItem as { cw?: unknown })?.cw)
        ? (wsItem as { cw: unknown[] }).cw
        : [];
      for (const cw of cwArr) {
        const w = (cw as { w?: unknown })?.w;
        if (typeof w !== 'string' || w.length === 0) continue;
        const rlRaw = (cw as { rl?: unknown })?.rl;
        const n = typeof rlRaw === 'string' ? parseInt(rlRaw, 10) : NaN;
        // null = "continue current speaker" (covers rl="0", missing, non-numeric).
        const rl = Number.isFinite(n) && n !== 0 ? n : null;
        words.push({ w, rl });
      }
    }
  }

  if (words.length === 0) return null;

  // Partials: keep the legacy single-segment, no-speaker behavior. Still resolve a
  // carry-forward speaker (first non-"0" rl, else prevSpeaker) so a partial frame
  // doesn't lose the running speaker for the next frame.
  if (!isFinal) {
    const text = words.map((x) => x.w).join('');
    const firstNonZero = words.find((x) => x.rl !== null)?.rl ?? null;
    return {
      runs: [{ text, isFinal: false, speakerId: null }],
      speaker: firstNonZero ?? prevSpeaker
    };
  }

  // FINAL: split into consecutive same-speaker runs by per-word rl.
  const runs: XfyunTranscript[] = [];
  let current = prevSpeaker ?? 0; // carried last-known speaker (default 0).
  let buf = '';
  for (const { w, rl } of words) {
    if (rl !== null && rl !== current) {
      // Speaker changed: flush the accumulated run, then start the new speaker.
      if (buf) runs.push({ text: buf, isFinal: true, speakerId: current });
      current = rl;
      buf = w;
    } else {
      // rl="0"/missing/non-numeric, or same speaker → continue the current run.
      buf += w;
    }
  }
  if (buf) runs.push({ text: buf, isFinal: true, speakerId: current });

  if (runs.length === 0) return null;
  // Carry the LAST run's speaker forward for the next frame.
  return { runs, speaker: current };
}

/** A single live iFlytek recognition session over one upstream WebSocket. */
export interface XfyunSession {
  /** Forward one PCM frame (16-bit LE mono, 16 kHz) to the recognizer as-is. */
  sendAudio(pcm: Buffer): void;
  /** Gracefully finish (send {end:true}) and close the socket. */
  stop(): Promise<AsrStopResult>;
  /** True once the upstream session is ready (action:started) to accept audio. */
  readonly isReady: boolean;
}

/**
 * Open an iFlytek 实时语音转写大模型 session. The socket connects with the signed
 * handshake URL (auth is in the query, not headers), waits for action:started,
 * then forwards raw 16 kHz PCM as binary frames. Server `result` frames become
 * onTranscript calls (partials carry no speaker; finals carry parseInt(rl)).
 * NEVER throws to the caller — every failure routes through onError. Audio sent
 * before the socket is OPEN is dropped (mirrors the volc client).
 */
export function createXfyunSession(deps: XfyunSessionDeps): XfyunSession {
  const { WebSocket, appId, apiKey, apiSecret, onTranscript, onReady, onError } = deps;
  const wsUrl = (deps.wsUrl ?? '').trim() || XFYUN_DEFAULT_WS_URL;
  const sampleRate = deps.sampleRate ?? XFYUN_DEFAULT_SAMPLE_RATE;
  const stopTimeoutMs = deps.stopTimeoutMs ?? XFYUN_DEFAULT_STOP_TIMEOUT_MS;

  let ready = false;
  let finished = false;
  let stopRequested = false;
  let finalReceived = false;
  let lastSpeaker: number | null = null;
  let socket: WsLike | null = null;
  let stopPromise: Promise<AsrStopResult> | null = null;
  let resolveStop: ((result: AsrStopResult) => void) | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  function fail(message: string): void {
    if (finished) return;
    try {
      onError?.(message);
    } finally {
      if (stopPromise) {
        finishStop({ finalReceived, timedOut: false, reason: message }, false);
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

  function handleServerFrame(raw: unknown): void {
    if (finished) return;
    let msg: unknown;
    try {
      const text =
        typeof raw === 'string'
          ? raw
          : Buffer.isBuffer(raw)
            ? raw.toString('utf8')
            : Buffer.from(raw as ArrayBuffer).toString('utf8');
      msg = JSON.parse(text);
    } catch {
      return; // ignore non-JSON frames
    }
    const obj = msg as {
      msg_type?: unknown;
      res_type?: unknown;
      action?: unknown;
      code?: unknown;
      desc?: unknown;
      data?: unknown;
    };

    // Error: an explicit error action OR a top-level non-"0" code.
    if (obj.action === 'error' || (obj.code !== undefined && String(obj.code) !== '0')) {
      const desc = typeof obj.desc === 'string' && obj.desc ? obj.desc : 'iFlytek error';
      const code = obj.code !== undefined ? ` (code ${String(obj.code)})` : '';
      fail(`${desc}${code}`);
      return;
    }

    // Session ready: {"data":{"action":"started"},"msg_type":"action"}.
    if (obj.msg_type === 'action') {
      const action = (obj.data as { action?: unknown })?.action;
      if (action === 'started' && !ready) {
        ready = true;
        onReady?.();
      }
      if (
        stopPromise &&
        (action === 'finished' || action === 'stopped' || action === 'ended')
      ) {
        finishStop({ finalReceived, timedOut: false }, true);
      }
      return;
    }

    // Recognition result frame. A single frame may contain MULTIPLE speakers
    // during fast turn-taking, so extractResult returns consecutive same-speaker
    // RUNS — emit one transcript per run, each with its own speakerId.
    if (obj.msg_type === 'result' && obj.res_type === 'asr') {
      const extracted = extractResult(obj.data, lastSpeaker);
      if (!extracted) return;
      lastSpeaker = extracted.speaker;
      for (const run of extracted.runs) {
        if (run.isFinal) finalReceived = true;
        onTranscript(run);
      }
      if (stopPromise && (obj.data as { ls?: unknown })?.ls === true) {
        finishStop({ finalReceived, timedOut: false }, true);
      }
    }
  }

  let signedUrl: string;
  try {
    signedUrl = buildSignedUrl({ appId, apiKey, apiSecret, wsUrl, sampleRate });
  } catch (err) {
    fail(err instanceof Error ? err.message : 'failed to sign iFlytek URL');
    return inertSession();
  }

  try {
    socket = new WebSocket(signedUrl);
  } catch (err) {
    fail(err instanceof Error ? err.message : 'failed to open iFlytek socket');
    return inertSession();
  }

  // Auth is carried in the handshake query, so 'open' needs no config frame.
  socket.on('open', () => {
    /* nothing to send — the signed URL already authenticated us */
  });

  socket.on('message', (raw: unknown) => handleServerFrame(raw));

  socket.on('error', (err: unknown) => {
    fail(formatXfyunTransportError(err));
  });

  socket.on('close', () => {
    const wasFinished = finished;
    socket = null;
    // Unexpected drop (not our own stop()): notify so the relay tears the source down
    // instead of silently swallowing all further audio. fail() is a no-op if finished.
    if (wasFinished) return;
    if (stopPromise) {
      finishStop(
        {
          finalReceived,
          timedOut: false,
          reason: 'iFlytek socket closed before the last result'
        },
        false
      );
      return;
    }
    fail('iFlytek socket closed unexpectedly');
  });

  function sendAudio(pcm: Buffer): void {
    if (finished || stopRequested || !socket) return;
    // iFlytek rejects/ignores audio before it acks `action:started`; drop until ready.
    if (!ready || socket.readyState !== WebSocket.OPEN) return;
    try {
      // Forward the relay's 16 kHz PCM AS-IS as a raw binary frame.
      socket.send(pcm);
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
        reason: 'iFlytek session already closed'
      });
    }
    stopRequested = true;
    stopPromise = new Promise<AsrStopResult>((resolve) => {
      resolveStop = resolve;
    });
    const sock = socket;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      finishStop({ finalReceived, timedOut: false, reason: 'iFlytek socket is not open' }, false);
      return stopPromise;
    }
    try {
      // A TEXT frame {"end":true} tells the server to finalize. Keep accepting
      // result frames until `data.ls === true`, a terminal action, or timeout.
      sock.send(JSON.stringify({ end: true }));
    } catch (error) {
      finishStop(
        {
          finalReceived,
          timedOut: false,
          reason: error instanceof Error ? error.message : 'failed to send iFlytek end frame'
        },
        false
      );
      return stopPromise;
    }
    stopTimer = setTimeout(() => {
      finishStop(
        { finalReceived, timedOut: true, reason: 'iFlytek finalization timeout' },
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
function inertSession(): XfyunSession {
  return {
    sendAudio() {
      /* no-op */
    },
    async stop() {
      return {
        finalReceived: false,
        timedOut: false,
        reason: 'iFlytek session unavailable'
      };
    },
    get isReady() {
      return false;
    }
  };
}
