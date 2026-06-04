// ============================================================================
// iFlytek (讯飞) 实时语音转写大模型 ASR client (web edition).
// ----------------------------------------------------------------------------
// REUSE NOTE: this mirrors volc-client.ts's exported shape (injected `ws` ctor +
// onTranscript/onReady/onError, a session with sendAudio/stop/isReady) so it
// drops into the same asr-relay slot. UNLIKE volc/paraformer, ONE cloud call
// returns BOTH the text AND the speaker id (角色分离 role_type=2) — so the relay
// uses the PLAIN text-session path for 'xfyun' and forwards the speakerId this
// client emits, skipping the local CAM++ diarizer entirely.
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
//       * Text  = concat of all data.cn.st.rt[].ws[].cw[].w
//       * type==="0" (string) = FINAL; "1" = intermediate/partial.
//       * Speaker = first non-"0" `rl` among the segment's cw (else last-known/0);
//         emitted as parseInt(rl,10) on FINALS only.
//   - action:"error" OR a top-level `code` !== "0" → onError(code/desc).
// ============================================================================

import crypto from 'node:crypto';

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
}

export const XFYUN_DEFAULT_WS_URL = 'wss://office-api-ast-dx.iflyaisol.com/';
export const XFYUN_DEFAULT_SAMPLE_RATE = 16000;

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
 * Extract a transcript from a parsed `result` frame's `data`. Concatenates all
 * cw words for the text, picks the segment speaker as the first non-"0" rl (else
 * the last-known speaker carried in via `prevSpeaker`), and marks FINAL when
 * st.type === "0". Returns the resolved speaker so the caller can carry it.
 */
export function extractResult(
  data: unknown,
  prevSpeaker: number | null
): { transcript: XfyunTranscript; speaker: number | null } | null {
  const st = (data as { cn?: { st?: unknown } })?.cn?.st as
    | { rt?: unknown; type?: unknown }
    | undefined;
  if (!st || typeof st !== 'object') return null;

  const rtArr = Array.isArray(st.rt) ? st.rt : [];
  let text = '';
  let segSpeaker: number | null = null;
  for (const rt of rtArr) {
    const wsArr = Array.isArray((rt as { ws?: unknown })?.ws) ? (rt as { ws: unknown[] }).ws : [];
    for (const wsItem of wsArr) {
      const cwArr = Array.isArray((wsItem as { cw?: unknown })?.cw)
        ? (wsItem as { cw: unknown[] }).cw
        : [];
      for (const cw of cwArr) {
        const w = (cw as { w?: unknown })?.w;
        if (typeof w === 'string') text += w;
        // First non-"0" rl wins as the segment speaker ("0" = continue previous).
        if (segSpeaker === null) {
          const rl = (cw as { rl?: unknown })?.rl;
          const n = typeof rl === 'string' ? parseInt(rl, 10) : NaN;
          if (Number.isFinite(n) && n !== 0) segSpeaker = n;
        }
      }
    }
  }

  // type is a STRING per the protocol: "0" = final, "1" = intermediate/partial.
  const isFinal = String(st.type) === '0';
  // Carry the last-known speaker forward when the segment only had "0" (continue).
  const resolved = segSpeaker ?? prevSpeaker ?? 0;
  if (!text) return null;
  return {
    transcript: { text, isFinal, speakerId: isFinal ? resolved : null },
    speaker: segSpeaker ?? prevSpeaker
  };
}

/** A single live iFlytek recognition session over one upstream WebSocket. */
export interface XfyunSession {
  /** Forward one PCM frame (16-bit LE mono, 16 kHz) to the recognizer as-is. */
  sendAudio(pcm: Buffer): void;
  /** Gracefully finish (send {end:true}) and close the socket. */
  stop(): void;
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

  let ready = false;
  let finished = false;
  let lastSpeaker: number | null = null;
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
      return;
    }

    // Recognition result frame.
    if (obj.msg_type === 'result' && obj.res_type === 'asr') {
      const extracted = extractResult(obj.data, lastSpeaker);
      if (!extracted) return;
      lastSpeaker = extracted.speaker;
      onTranscript(extracted.transcript);
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
    fail(err instanceof Error ? err.message : 'iFlytek socket error');
  });

  socket.on('close', () => {
    socket = null;
  });

  function sendAudio(pcm: Buffer): void {
    if (finished || !socket) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      // Forward the relay's 16 kHz PCM AS-IS as a raw binary frame.
      socket.send(pcm);
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
        // A TEXT frame {"end":true} tells the server to finalize.
        sock.send(JSON.stringify({ end: true }));
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
function inertSession(): XfyunSession {
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
