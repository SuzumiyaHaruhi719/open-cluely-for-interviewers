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
import type { AsrProvider, AsrRuntimeState, AudioSource } from '@open-cluely/contract';
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

/** Credential-free lifecycle signal for one provider-backed source session. */
export interface AsrStatusEmit {
  source: AudioSource;
  provider: AsrProvider;
  state: AsrRuntimeState;
  message?: string;
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

/** Outcome of a bounded provider shutdown/final-result drain. */
export interface AsrStopResult {
  finalReceived: boolean;
  timedOut: boolean;
  reason?: string;
}

/** The common recognition-session surface both text providers expose. */
export interface AsrSession {
  sendAudio(pcm: Buffer): void;
  stop(): Promise<AsrStopResult>;
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
  /** Report the actual provider session lifecycle to the browser. */
  onStatus?: (status: AsrStatusEmit) => void;
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
  handleAudioControl(control: AudioControl): Promise<AsrStopResult | null>;
  /** Enable/disable auto-analyze of interviewee final transcripts. */
  setAutoAnalyzeDisplay(enabled: boolean): void;
  /** Choose the engine/Volc config; a real live change reconnects on the next PCM frame. */
  setAsrProvider(provider: AsrProvider, volc?: VolcCredentials): void;
  /** Provider that owns `source`, or the selected provider before it starts. */
  getProvider(source?: AudioSource): AsrProvider;
  /**
   * Store the simulation script (mic-less harness). Used by the NEXT
   * `audio-control start` when `asrProvider === 'sim'`. Does not restart sessions.
   */
  setSimScript(script: ReadonlyArray<SimScriptTurn>): void;
  /** True while any audio source is actively capturing (used to gate auto-fire). */
  isCapturing(): boolean;
  dispose(): Promise<void>;
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
  const sessionProviders: Record<AudioSource, AsrProvider | null> = { mic: null, display: null };
  const stopping: Record<AudioSource, Promise<AsrStopResult> | null> = {
    mic: null,
    display: null
  };
  let autoAnalyzeDisplay = false;
  let provider: AsrProvider = 'paraformer';
  let volcCreds: VolcCredentials | null = null;
  let simScript: ReadonlyArray<SimScriptTurn> = [];
  let disposed = false;

  function emitStatus(status: AsrStatusEmit): void {
    try {
      deps.onStatus?.(status);
    } catch {
      /* status reporting must never break recognition */
    }
  }

  function onReady(source: AudioSource, owner: AsrProvider): void {
    if (disposed || stopping[source] || sessionProviders[source] !== owner) return;
    emitStatus({ source, provider: owner, state: 'live' });
  }
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

  function onError(source: AudioSource, owner: AsrProvider, message: string): void {
    if (sessionProviders[source] === owner) {
      emitStatus({ source, provider: owner, state: 'failed', message });
    }
    deps.emit({ source, text: `[语音识别错误: ${message}]`, isFinal: false });
    void stopSource(source);
  }

  // Create the TEXT recognition session for `source`, wired to `onText`. Returns
  // null (after emitting a friendly error) when the key/creds are missing.
  function makeTextSession(source: AudioSource, owner: AsrProvider, onText: OnText): AsrSession | null {
    if (owner === 'sim') {
      // Mic-less harness: replay the stored two-speaker script (audio ignored).
      // Like xfyun, the session carries its own speakerId on finals.
      if (!simScript.length) {
        deps.emit({ source, text: '[Sim unavailable: no simScript configured]', isFinal: false });
        emitStatus({ source, provider: owner, state: 'failed', message: '模拟脚本未配置' });
        return null;
      }
      return simSessionFactory({
        script: simScript,
        onTranscript: onText,
        onReady: () => onReady(source, owner),
        onError: (message) => onError(source, owner, message)
      });
    }
    if (owner === 'xfyun') {
      const appId = config.xfyunAppId.trim();
      const apiKey = config.xfyunApiKey.trim();
      const apiSecret = config.xfyunApiSecret.trim();
      if (!appId || !apiKey || !apiSecret) {
        deps.emit({ source, text: '[Xunfei unavailable: set XFYUN_* in .env]', isFinal: false });
        emitStatus({ source, provider: owner, state: 'failed', message: '讯飞服务端配置不完整' });
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
        onReady: () => onReady(source, owner),
        onError: (message) => onError(source, owner, message)
      });
    }
    if (owner === 'volc') {
      const appId = (volcCreds?.appId ?? '').trim();
      const accessToken = (volcCreds?.accessToken ?? '').trim();
      if (!appId || !accessToken) {
        deps.emit({
          source,
          text: '[豆包 ASR 2.0 不可用：请在服务端配置 VOLC_APP_ID 和 VOLC_ACCESS_TOKEN]',
          isFinal: false
        });
        emitStatus({ source, provider: owner, state: 'failed', message: '豆包 ASR 2.0 服务端配置不完整' });
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
        onReady: () => onReady(source, owner),
        onError: (message) => onError(source, owner, message)
      });
    }
    if (!apiKey) {
      deps.emit({ source, text: '[ASR unavailable: DashScope API key not configured]', isFinal: false });
      emitStatus({ source, provider: owner, state: 'failed', message: 'DashScope API Key 未配置' });
      return null;
    }
    return sessionFactory({
      WebSocket: WebSocketCtor,
      apiKey,
      model: config.paraformerModel,
      sampleRate: config.paraformerSampleRate,
      onTranscript: onText,
      onReady: () => onReady(source, owner),
      onError: (message) => onError(source, owner, message)
    });
  }

  function startSource(source: AudioSource): void {
    if (disposed || sessions[source] || stopping[source]) return;
    const owner = provider;
    sessionProviders[source] = owner;
    emitStatus({ source, provider: owner, state: 'connecting' });
    // Preserve native cluster ids verbatim. During fast hand-offs a provider may
    // over-cluster; the downstream Flash classifier can map multiple ids to the
    // same role without destructively folding acoustic evidence here.
    try {
      sessions[source] = makeTextSession(source, owner, (t) => emitTranscript(source, t));
    } catch (error) {
      const message = error instanceof Error ? error.message : '语音识别会话启动失败';
      emitStatus({ source, provider: owner, state: 'failed', message });
      sessions[source] = null;
    }
    if (!sessions[source]) sessionProviders[source] = null;
  }

  function stopSource(source: AudioSource): Promise<AsrStopResult | null> {
    const existing = stopping[source];
    if (existing) return existing;
    const session = sessions[source];
    if (!session) return Promise.resolve(null);

    let settle!: (result: AsrStopResult) => void;
    const pending = new Promise<AsrStopResult>((resolve) => {
      settle = resolve;
    });
    stopping[source] = pending;

    const finish = (raw?: AsrStopResult): void => {
      const result =
        raw && typeof raw.finalReceived === 'boolean' && typeof raw.timedOut === 'boolean'
          ? raw
          : {
              finalReceived: false,
              timedOut: false,
              reason: 'recognizer did not report finalization'
            };
      if (sessions[source] === session) sessions[source] = null;
      if (sessionProviders[source] !== null) sessionProviders[source] = null;
      if (stopping[source] === pending) stopping[source] = null;
      settle(result);
    };

    try {
      // Invoke stop only after publishing `stopping[source]`, so a synchronous
      // provider error cannot recursively start a second shutdown. Keep the
      // session attached until its bounded drain resolves so capture state stays
      // truthful and no reconnect can overtake late final transcripts.
      void Promise.resolve(session.stop()).then(finish, (error: unknown) => {
        finish({
          finalReceived: false,
          timedOut: false,
          reason: error instanceof Error ? error.message : 'recognizer finalization failed'
        });
      });
    } catch (error) {
      finish({
        finalReceived: false,
        timedOut: false,
        reason: error instanceof Error ? error.message : 'recognizer finalization failed'
      });
    }
    return pending;
  }

  function handleAudio(frame: { source: AudioSource; pcmBase64: string }): void {
    if (disposed) return;
    const source = frame.source;
    if (stopping[source]) return;
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

  async function handleAudioControl(control: AudioControl): Promise<AsrStopResult | null> {
    if (disposed) return null;
    if (control.action === 'start') {
      startSource(control.source);
      return null;
    }
    return stopSource(control.source);
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
      for (const source of SOURCES) {
        const owner = sessionProviders[source];
        if (!sessions[source] || !owner) continue;
        emitStatus({ source, provider: owner, state: 'finalizing' });
        void stopSource(source).then((result) => {
          if (!result) return;
          const partial = result.timedOut || !result.finalReceived;
          emitStatus({
            source,
            provider: owner,
            state: partial ? 'partial' : 'stopped',
            ...(result.reason ? { message: result.reason } : {})
          });
        });
      }
    }
  }

  function getProvider(source?: AudioSource): AsrProvider {
    return source ? sessionProviders[source] ?? provider : provider;
  }

  function setSimScript(script: ReadonlyArray<SimScriptTurn>): void {
    // Defensive copy so a later mutation of the caller's array can't change a
    // running/next replay; keep only well-formed turns.
    simScript = Array.isArray(script)
      ? script.filter((t) => t && typeof t.text === 'string').map((t) => ({ speakerId: Number(t.speakerId) || 0, text: t.text }))
      : [];
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    await Promise.all(SOURCES.map((source) => stopSource(source)));
  }

  function isCapturing(): boolean {
    // A draining recognizer may still deliver one late final, but the browser has
    // already stopped sending live audio. Treat that lane as inactive immediately
    // so autonomous UI work cannot race the provider-finalization window.
    return SOURCES.some((source) => sessions[source] !== null && stopping[source] === null);
  }

  return {
    handleAudio,
    handleAudioControl,
    setAutoAnalyzeDisplay,
    setAsrProvider,
    getProvider,
    setSimScript,
    isCapturing,
    dispose
  };
}
