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
// PROVIDER-AWARE: the relay carries an `asrProvider` ('paraformer' | 'volc',
// default 'paraformer'). When 'volc', start() opens a Doubao / Volcengine
// session (./volc-client) with the per-session Volc creds; otherwise it opens a
// Paraformer session (./paraformer-client). Both clients expose the SAME
// sendAudio/stop/isReady surface, so the emit + dispose paths are identical.
// Paraformer is the default and is unaffected when no provider is configured.
//
// REUSE: the DashScope protocol lives in ./paraformer-client and the Volc/Doubao
// protocol in ./volc-client (a verbatim port of the desktop frame protocol —
// see the note there).
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
import { createFunasrSession, type FunasrSessionDeps } from './funasr-client';

export interface TranscriptEmit {
  source: AudioSource;
  text: string;
  isFinal: boolean;
  /** FunASR-only: per-segment speaker id. Omitted by paraformer/volc. */
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

/** The common recognition-session surface both providers expose. */
export interface AsrSession {
  sendAudio(pcm: Buffer): void;
  stop(): void;
  readonly isReady: boolean;
}

/** Per-session Volc / Doubao credentials, injected via configure. */
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
/** Factory used to create a FunASR streaming-SPK session — overridable in tests. */
export type FunasrSessionFactory = (deps: FunasrSessionDeps) => AsrSession;

export interface AsrRelayDeps {
  /** Send a `transcript` message back to this connection's browser. */
  emit: (t: TranscriptEmit) => void;
  /** DashScope API key (Paraformer). Defaults to config.dashscopeApiKey. */
  apiKey?: string;
  /** Paraformer session factory (defaults to the real client). */
  sessionFactory?: ParaformerSessionFactory;
  /** Volc/Doubao session factory (defaults to the real client). */
  volcSessionFactory?: VolcSessionFactory;
  /** FunASR streaming-SPK session factory (defaults to the real client). */
  funasrSessionFactory?: FunasrSessionFactory;
  /** WebSocket constructor passed to the sessions (defaults to `ws`). */
  WebSocket?: WsConstructor;
  /**
   * Optional: invoked with the FINAL interviewee ('display') transcript so the
   * caller MAY auto-run analysis. Opt-in via configure({ autoAnalyzeDisplay });
   * left unset means transcripts only stream — no surprise model spend.
   */
  onDisplayFinal?: (text: string) => void;
}

export interface AsrRelay {
  handleAudio(frame: { source: AudioSource; pcmBase64: string }): void;
  handleAudioControl(control: AudioControl): void;
  /** Enable/disable auto-analyze of interviewee final transcripts. */
  setAutoAnalyzeDisplay(enabled: boolean): void;
  /**
   * Choose the ASR provider + (for 'volc') its credentials / (for 'funasr') its
   * WS URL for SUBSEQUENT starts. Does not restart live sessions — the next
   * `audio-control start` (or first frame) for a source picks up the new
   * provider/creds/url.
   */
  setAsrProvider(provider: AsrProvider, volc?: VolcCredentials, funasr?: { url: string }): void;
  dispose(): void;
}

const SOURCES: readonly AudioSource[] = ['mic', 'display'];

/**
 * Create a relay bound to one browser connection. Sessions are created lazily
 * and torn down on stop / dispose. NEVER throws to the caller — a recognizer
 * failure surfaces as a `transcript`-channel error path via emit/onError, and
 * the ws layer keeps the socket alive.
 */
export function createAsrRelay(deps: AsrRelayDeps): AsrRelay {
  const apiKey = deps.apiKey ?? config.dashscopeApiKey;
  const sessionFactory = deps.sessionFactory ?? (createParaformerSession as ParaformerSessionFactory);
  const volcSessionFactory = deps.volcSessionFactory ?? (createVolcSession as VolcSessionFactory);
  const funasrSessionFactory = deps.funasrSessionFactory ?? (createFunasrSession as FunasrSessionFactory);
  const WebSocketCtor = (deps.WebSocket ?? (WsWebSocket as unknown)) as WsConstructor;

  const sessions: Record<AudioSource, AsrSession | null> = { mic: null, display: null };
  let autoAnalyzeDisplay = false;
  let provider: AsrProvider = 'paraformer';
  let volcCreds: VolcCredentials | null = null;
  let funasrUrl: string = config.funasrWsUrl;
  let disposed = false;

  // Shared transcript/error wiring so all providers route identically. The
  // optional `speakerId` is carried only when present (FunASR) — omitted for
  // paraformer/volc so their emit payloads stay byte-identical to before.
  function onTranscript(
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
    deps.emit({ source, text: `[ASR error: ${message}]`, isFinal: false });
    stopSource(source);
  }

  function startParaformer(source: AudioSource): void {
    if (!apiKey) {
      // No key: surface once as a non-final transcript-shaped error so the UI
      // can show it on the right lane without crashing.
      deps.emit({ source, text: '[ASR unavailable: DashScope API key not configured]', isFinal: false });
      return;
    }
    sessions[source] = sessionFactory({
      WebSocket: WebSocketCtor,
      apiKey,
      model: config.paraformerModel,
      sampleRate: config.paraformerSampleRate,
      onTranscript: (t) => onTranscript(source, t),
      onError: (message) => onError(source, message)
    });
  }

  function startVolc(source: AudioSource): void {
    const appId = (volcCreds?.appId ?? '').trim();
    const accessToken = (volcCreds?.accessToken ?? '').trim();
    if (!appId || !accessToken) {
      deps.emit({
        source,
        text: '[Doubao unavailable: enter APP ID + Access Token in Settings]',
        isFinal: false
      });
      return;
    }
    sessions[source] = volcSessionFactory({
      WebSocket: WebSocketCtor,
      appId,
      accessToken,
      resourceId: volcCreds?.resourceId,
      model: volcCreds?.model,
      sampleRate: config.volcSampleRate,
      onTranscript: (t) => onTranscript(source, t),
      onError: (message) => onError(source, message)
    });
  }

  function startFunasr(source: AudioSource): void {
    const url = funasrUrl.trim();
    if (!url) {
      deps.emit({
        source,
        text: '[FunASR unavailable: set the FunASR WebSocket URL in Settings]',
        isFinal: false
      });
      return;
    }
    sessions[source] = funasrSessionFactory({
      WebSocket: WebSocketCtor as unknown as FunasrSessionDeps['WebSocket'],
      url,
      sampleRate: 16000,
      onTranscript: (t) => onTranscript(source, t),
      onError: (message) => onError(source, message)
    });
  }

  function startSource(source: AudioSource): void {
    if (disposed || sessions[source]) return;
    if (provider === 'volc') startVolc(source);
    else if (provider === 'funasr') startFunasr(source);
    else startParaformer(source);
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
    // Lazily start if a frame arrives before an explicit 'start' control.
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

  function setAsrProvider(next: AsrProvider, volc?: VolcCredentials, funasr?: { url: string }): void {
    provider = next === 'volc' ? 'volc' : next === 'funasr' ? 'funasr' : 'paraformer';
    if (volc) volcCreds = { ...volc };
    funasrUrl = funasr?.url || config.funasrWsUrl;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const source of SOURCES) stopSource(source);
  }

  return { handleAudio, handleAudioControl, setAutoAnalyzeDisplay, setAsrProvider, dispose };
}
