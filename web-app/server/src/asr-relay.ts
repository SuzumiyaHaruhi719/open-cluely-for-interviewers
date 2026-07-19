// ============================================================================
// Per-WebSocket-connection ASR relay.
// ----------------------------------------------------------------------------
// The browser captures the interviewee (getDisplayMedia -> source 'display')
// and interviewer (getUserMedia -> source 'mic'), downsamples to 16 kHz mono
// s16le in an AudioWorklet, and streams base64 PCM frames over the copilot
// WebSocket. This relay owns one recognition session PER source, lazily started
// on the first 'start' control (or first audio frame), feeds it the decoded
// PCM, and turns partial/final transcripts into `transcript` ServerMessages via
// the injected `emit`.
//
// `asrProvider` selects the recognition engine. Providers with native speaker
// clusters (currently iFlytek and the simulation harness) forward `speakerId`;
// providers without them emit text only. Single-mic semantic role partitioning
// is handled after transcription by speaker-partitioner.ts, never in this relay.
// ============================================================================

import { WebSocket as WsWebSocket } from 'ws';
import type { AsrProvider, AudioSource } from '@open-cluely/contract';
import { config } from './config';
import {
  createParaformerSession,
  type ParaformerSessionDeps,
  type WsConstructor
} from './paraformer-client';
import { createVolcSession, type VolcSessionDeps } from './volc-client';
import { createXfyunSession, type XfyunSessionDeps } from './xfyun-client';
import { createSimSession, type SimSessionDeps, type SimScriptTurn } from './sim-client';

export interface TranscriptEmit {
  source: AudioSource;
  text: string;
  isFinal: boolean;
  /** Native provider speaker cluster id. Omitted when the provider has none. */
  speakerId?: number | null;
}

export interface AudioFrame {
  seq: number;
  source: AudioSource;
  pcm: string; // base64-encoded s16le PCM
}

export interface AudioControl {
  action: 'start' | 'stop';
  source: AudioSource;
}

/** The common recognition-session surface both text providers expose. */
export interface AsrSession {
  sendAudio(pcm: Buffer): void;
  stop(): void;
  readonly isReady: boolean;
}

/** Environment-owned Volc / Doubao ASR 2.0 credentials. */
export interface VolcCredentials {
  appId: string;
  accessToken: string;
  resourceId?: string;
  model?: string;
}

/** Factory used to create a Paraformer session — overridable in tests with a fake. */
export type ParaformerSessionFactory = (deps: ParaformerSessionDeps) => AsrSession;
/** Factory used to create a Volc/Doubao session — overridable in tests with a fake. */
export type VolcSessionFactory = (deps: VolcSessionDeps) => AsrSession;
/** Factory used to create an iFlytek (讯飞) session — overridable in tests with a fake. */
export type XfyunSessionFactory = (deps: XfyunSessionDeps) => AsrSession;
/** Factory used to create a simulation ('sim') session — overridable in tests with a fake. */
export type SimSessionFactory = (deps: SimSessionDeps) => AsrSession;
/**
 * A transcript callback from a text session. Most providers carry text + isFinal
 * only; 'xfyun' (角色分离 role_type=2) ALSO carries its own per-utterance speakerId
 * (null on partials), which startSource forwards unchanged.
 */
type OnText = (t: { text: string; isFinal: boolean; speakerId?: number | null }) => void;

export interface AsrRelayDeps {
  /** Send a `transcript` message back to this connection's browser. */
  emit: (t: TranscriptEmit) => void;
  /** DashScope API key (Paraformer). Defaults to config.dashscopeApiKey. */
  apiKey?: string;
  /** Paraformer session factory (defaults to the real client). */
  sessionFactory?: ParaformerSessionFactory;
  /** Volc/Doubao session factory (defaults to the real client). */
  volcSessionFactory?: VolcSessionFactory;
  /** iFlytek (讯飞) session factory (defaults to the real client). */
  xfyunSessionFactory?: XfyunSessionFactory;
  /** Simulation ('sim') session factory (defaults to createSimSession). */
  simSessionFactory?: SimSessionFactory;
  /** WebSocket constructor passed to the sessions (defaults to `ws`). */
  WebSocket?: WsConstructor;
  /**
   * Optional: invoked with the FINAL interviewee ('display') transcript so the
   * caller MAY auto-run analysis. Opt-in via configure({ autoAnalyzeDisplay }).
   */
  onDisplayFinal?: (text: string) => void;
}

export interface AsrRelay {
  handleAudio(frame: { source: AudioSource; pcmBase64: string }): void;
  handleAudioControl(control: AudioControl): void;
  /** Enable/disable auto-analyze of interviewee final transcripts. */
  setAutoAnalyzeDisplay(enabled: boolean): void;
  /** Choose the engine/Volc config; a real live change reconnects on the next PCM frame. */
  setAsrProvider(provider: AsrProvider, volc?: VolcCredentials): void;
  /**
   * Store the simulation script (mic-less harness). Used by the NEXT
   * `audio-control start` when `asrProvider === 'sim'`. Does not restart sessions.
   */
  setSimScript(script: ReadonlyArray<SimScriptTurn>): void;
  /** True while any audio source is actively capturing (used to gate auto-fire). */
  isCapturing(): boolean;
  dispose(): void;
}

const SOURCES: readonly AudioSource[] = ['mic', 'display'];

/**
 * Create a relay bound to one browser connection. Sessions are created lazily
 * and torn down on stop / dispose. NEVER throws to the caller — a recognizer
 * failure surfaces as a `transcript`-channel error path via emit/onError.
 */
export function createAsrRelay(deps: AsrRelayDeps): AsrRelay {
  const apiKey = deps.apiKey ?? config.dashscopeApiKey;
  const sessionFactory = deps.sessionFactory ?? (createParaformerSession as ParaformerSessionFactory);
  const volcSessionFactory = deps.volcSessionFactory ?? (createVolcSession as VolcSessionFactory);
  const xfyunSessionFactory = deps.xfyunSessionFactory ?? (createXfyunSession as XfyunSessionFactory);
  const simSessionFactory = deps.simSessionFactory ?? (createSimSession as SimSessionFactory);
  const WebSocketCtor = (deps.WebSocket ?? (WsWebSocket as unknown)) as WsConstructor;

  const sessions: Record<AudioSource, AsrSession | null> = { mic: null, display: null };
  let autoAnalyzeDisplay = false;
  let provider: AsrProvider = 'paraformer';
  let volcCreds: VolcCredentials | null = null;
  let simScript: ReadonlyArray<SimScriptTurn> = [];
  let disposed = false;
  // Shared emit: carries `speakerId` only when a provider supplied a native id.
  function emitTranscript(
    source: AudioSource,
    t: { text: string; isFinal: boolean; speakerId?: number | null }
  ): void {
    deps.emit({
      source,
      text: t.text,
      isFinal: t.isFinal,
      ...(t.speakerId == null ? {} : { speakerId: t.speakerId })
    });
    if (t.isFinal && source === 'display' && autoAnalyzeDisplay) {
      try {
        deps.onDisplayFinal?.(t.text);
      } catch {
        /* never let an analyze trigger break the relay */
      }
    }
  }

  function onError(source: AudioSource, message: string): void {
    deps.emit({ source, text: `[语音识别错误: ${message}]`, isFinal: false });
    stopSource(source);
  }

  // Create the TEXT recognition session for `source`, wired to `onText`. Returns
  // null (after emitting a friendly error) when the key/creds are missing.
  function makeTextSession(source: AudioSource, onText: OnText): AsrSession | null {
    if (provider === 'sim') {
      // Mic-less harness: replay the stored two-speaker script (audio ignored).
      // Like xfyun, the session carries its own speakerId on finals.
      if (!simScript.length) {
        deps.emit({ source, text: '[Sim unavailable: no simScript configured]', isFinal: false });
        return null;
      }
      return simSessionFactory({
        script: simScript,
        onTranscript: onText,
        onError: (message) => onError(source, message)
      });
    }
    if (provider === 'xfyun') {
      const appId = config.xfyunAppId.trim();
      const apiKey = config.xfyunApiKey.trim();
      const apiSecret = config.xfyunApiSecret.trim();
      if (!appId || !apiKey || !apiSecret) {
        deps.emit({ source, text: '[Xunfei unavailable: set XFYUN_* in .env]', isFinal: false });
        return null;
      }
      // ONE cloud call returns text + speaker (角色分离 role_type=2); 16 kHz PCM,
      // forwarded as-is. onText carries the provider's own speakerId on finals.
      return xfyunSessionFactory({
        WebSocket: WebSocketCtor,
        appId,
        apiKey,
        apiSecret,
        wsUrl: config.xfyunWsUrl,
        sampleRate: 16000,
        onTranscript: onText,
        onError: (message) => onError(source, message)
      });
    }
    if (provider === 'volc') {
      const appId = (volcCreds?.appId ?? '').trim();
      const accessToken = (volcCreds?.accessToken ?? '').trim();
      if (!appId || !accessToken) {
        deps.emit({
          source,
          text: '[豆包 ASR 2.0 不可用：请在服务端配置 VOLC_APP_ID 和 VOLC_ACCESS_TOKEN]',
          isFinal: false
        });
        return null;
      }
      return volcSessionFactory({
        WebSocket: WebSocketCtor,
        appId,
        accessToken,
        resourceId: volcCreds?.resourceId,
        model: volcCreds?.model,
        sampleRate: config.volcSampleRate,
        onTranscript: onText,
        onError: (message) => onError(source, message)
      });
    }
    if (!apiKey) {
      deps.emit({ source, text: '[ASR unavailable: DashScope API key not configured]', isFinal: false });
      return null;
    }
    return sessionFactory({
      WebSocket: WebSocketCtor,
      apiKey,
      model: config.paraformerModel,
      sampleRate: config.paraformerSampleRate,
      onTranscript: onText,
      onError: (message) => onError(source, message)
    });
  }

  function startSource(source: AudioSource): void {
    if (disposed || sessions[source]) return;
    // Preserve native cluster ids verbatim. During fast hand-offs a provider may
    // over-cluster; the downstream Flash classifier can map multiple ids to the
    // same role without destructively folding acoustic evidence here.
    sessions[source] = makeTextSession(source, (t) => emitTranscript(source, t));
  }

  function stopSource(source: AudioSource): void {
    const session = sessions[source];
    sessions[source] = null;
    if (session) {
      try {
        session.stop();
      } catch {
        /* ignore */
      }
    }
  }

  function handleAudio(frame: { source: AudioSource; pcmBase64: string }): void {
    if (disposed) return;
    const source = frame.source;
    if (!sessions[source]) startSource(source);
    const session = sessions[source];
    if (!session) return;
    let pcm: Buffer;
    try {
      pcm = Buffer.from(frame.pcmBase64, 'base64');
    } catch {
      return; // ignore undecodable frame
    }
    if (pcm.length === 0) return;
    session.sendAudio(pcm);
  }

  function handleAudioControl(control: AudioControl): void {
    if (disposed) return;
    if (control.action === 'start') startSource(control.source);
    else stopSource(control.source);
  }

  function setAutoAnalyzeDisplay(enabled: boolean): void {
    autoAnalyzeDisplay = enabled;
  }

  function setAsrProvider(next: AsrProvider, volc?: VolcCredentials): void {
    // iFlytek is the native text+speaker engine (server-side XFYUN_* creds).
    // Anything outside the current allowlist safely collapses to Paraformer.
    const resolved =
      next === 'volc' ? 'volc' : next === 'xfyun' ? 'xfyun' : next === 'sim' ? 'sim' : 'paraformer';
    const providerChanged = provider !== resolved;
    const volcCredentialsChanged =
      resolved === 'volc' &&
      volc !== undefined &&
      (String(volcCreds?.appId ?? '').trim() !== String(volc.appId ?? '').trim() ||
        String(volcCreds?.accessToken ?? '').trim() !== String(volc.accessToken ?? '').trim() ||
        String(volcCreds?.resourceId ?? '').trim() !== String(volc.resourceId ?? '').trim() ||
        String(volcCreds?.model ?? '').trim() !== String(volc.model ?? '').trim());
    provider = resolved;
    if (volc) volcCreds = { ...volc };
    // A browser setting change must affect the stream the interviewer is
    // currently using. Tear down only the upstream ASR session; local capture
    // keeps sending PCM, so the next frame lazily reconnects to `provider`.
    if (providerChanged || volcCredentialsChanged) {
      for (const source of SOURCES) stopSource(source);
    }
  }

  function setSimScript(script: ReadonlyArray<SimScriptTurn>): void {
    // Defensive copy so a later mutation of the caller's array can't change a
    // running/next replay; keep only well-formed turns.
    simScript = Array.isArray(script)
      ? script.filter((t) => t && typeof t.text === 'string').map((t) => ({ speakerId: Number(t.speakerId) || 0, text: t.text }))
      : [];
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const source of SOURCES) stopSource(source);
  }

  function isCapturing(): boolean {
    return SOURCES.some((source) => sessions[source] !== null);
  }

  return {
    handleAudio,
    handleAudioControl,
    setAutoAnalyzeDisplay,
    setAsrProvider,
    setSimScript,
    isCapturing,
    dispose
  };
}
