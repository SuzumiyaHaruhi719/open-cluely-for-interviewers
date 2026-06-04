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
// TWO ORTHOGONAL KNOBS:
//   1. asrProvider — the TEXT engine: 'paraformer' (DashScope, default) or
//      'volc' (Doubao/Volcengine). Both clients expose the same sendAudio/stop/
//      isReady surface.
//   2. diarize — when true (offline single room-mic), the relay tees the mic PCM
//      to a LOCAL CAM++ sidecar (./campp-diarizer) and stamps a per-utterance
//      integer `speakerId` on each FINAL — on top of whichever text engine is
//      chosen. So offline can use Paraformer OR Doubao for the words, plus CAM++
//      for "who". Online (diarize=false) never emits speakerId — byte-identical.
// ============================================================================

import { WebSocket as WsWebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { AsrProvider, AudioSource } from '@open-cluely/contract';
import { config } from './config';
import {
  createParaformerSession,
  type ParaformerSessionDeps,
  type WsConstructor
} from './paraformer-client';
import { createVolcSession, type VolcSessionDeps } from './volc-client';
import { createCamppDiarizer, type CamppDiarizerDeps, type Diarizer } from './campp-diarizer';

export interface TranscriptEmit {
  source: AudioSource;
  text: string;
  isFinal: boolean;
  /** Diarized (offline CAM++) only: per-utterance speaker id. Omitted online. */
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
/** Factory used to create a CAM++ diarizer — overridable in tests with a fake. */
export type DiarizerFactory = (deps: CamppDiarizerDeps) => Diarizer;

/** A transcript callback from a text session (text + isFinal; no speaker). */
type OnText = (t: { text: string; isFinal: boolean }) => void;

export interface AsrRelayDeps {
  /** Send a `transcript` message back to this connection's browser. */
  emit: (t: TranscriptEmit) => void;
  /** DashScope API key (Paraformer). Defaults to config.dashscopeApiKey. */
  apiKey?: string;
  /** Paraformer session factory (defaults to the real client). */
  sessionFactory?: ParaformerSessionFactory;
  /** Volc/Doubao session factory (defaults to the real client). */
  volcSessionFactory?: VolcSessionFactory;
  /** CAM++ diarizer factory (defaults to the real HTTP client). */
  diarizerFactory?: DiarizerFactory;
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
  /**
   * Choose the TEXT engine + (for 'volc') its creds / the CAM++ sidecar URL for
   * SUBSEQUENT starts. ('funasr' is accepted for back-compat and treated as
   * 'paraformer'.) Does not restart live sessions.
   */
  setAsrProvider(provider: AsrProvider, volc?: VolcCredentials, funasr?: { url: string }): void;
  /**
   * Turn local CAM++ speaker diarization on/off for SUBSEQUENT starts (offline
   * single-mic). When on, the next session tees mic PCM to the sidecar and
   * stamps an integer speakerId on each final.
   */
  setDiarize(enabled: boolean): void;
  /** True while any audio source is actively capturing (used to gate auto-fire). */
  isCapturing(): boolean;
  dispose(): void;
}

const SOURCES: readonly AudioSource[] = ['mic', 'display'];

// Cap the per-utterance diarization buffer at ~30 s of 16 kHz mono s16le, so a
// missing final (long monologue) can't grow it without bound.
const MAX_DIAR_SEG_BYTES = 30 * 16000 * 2;

/**
 * Create a relay bound to one browser connection. Sessions are created lazily
 * and torn down on stop / dispose. NEVER throws to the caller — a recognizer
 * failure surfaces as a `transcript`-channel error path via emit/onError.
 */
export function createAsrRelay(deps: AsrRelayDeps): AsrRelay {
  const apiKey = deps.apiKey ?? config.dashscopeApiKey;
  const sessionFactory = deps.sessionFactory ?? (createParaformerSession as ParaformerSessionFactory);
  const volcSessionFactory = deps.volcSessionFactory ?? (createVolcSession as VolcSessionFactory);
  const diarizerFactory = deps.diarizerFactory ?? createCamppDiarizer;
  const WebSocketCtor = (deps.WebSocket ?? (WsWebSocket as unknown)) as WsConstructor;

  const sessions: Record<AudioSource, AsrSession | null> = { mic: null, display: null };
  let autoAnalyzeDisplay = false;
  let provider: AsrProvider = 'paraformer';
  let volcCreds: VolcCredentials | null = null;
  let camppUrl: string = config.camppUrl;
  let diarize = false;
  const diarSession = randomUUID();
  let disposed = false;

  // Shared emit: carries `speakerId` only when present (diarized) — omitted for
  // online so the wire stays byte-identical. Display finals may auto-analyze.
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
    deps.emit({ source, text: `[ASR error: ${message}]`, isFinal: false });
    stopSource(source);
  }

  // Create the TEXT recognition session for `source`, wired to `onText`. Returns
  // null (after emitting a friendly error) when the key/creds are missing.
  function makeTextSession(source: AudioSource, onText: OnText): AsrSession | null {
    if (provider === 'volc') {
      const appId = (volcCreds?.appId ?? '').trim();
      const accessToken = (volcCreds?.accessToken ?? '').trim();
      if (!appId || !accessToken) {
        deps.emit({
          source,
          text: '[Doubao unavailable: enter APP ID + Access Token in Settings]',
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
    if (!diarize) {
      sessions[source] = makeTextSession(source, (t) => emitTranscript(source, t));
      return;
    }

    // Offline: diarize each finalized utterance with the local CAM++ sidecar and
    // stamp its integer speakerId. Partials emit immediately (no speaker).
    const diarizer = diarizerFactory({ url: camppUrl, session: diarSession });
    let segChunks: Buffer[] = [];
    let segBytes = 0;
    const onText: OnText = (t) => {
      if (!t.isFinal) {
        emitTranscript(source, { text: t.text, isFinal: false });
        return;
      }
      const seg = Buffer.concat(segChunks);
      segChunks = [];
      segBytes = 0;
      const { text } = t;
      diarizer
        .diarize(seg)
        .then((spk) => emitTranscript(source, { text, isFinal: true, speakerId: spk }))
        .catch(() => emitTranscript(source, { text, isFinal: true }));
    };
    const inner = makeTextSession(source, onText);
    if (!inner) return;
    sessions[source] = {
      get isReady(): boolean {
        return inner.isReady;
      },
      sendAudio(pcm: Buffer): void {
        segChunks.push(pcm);
        segBytes += pcm.length;
        while (segBytes > MAX_DIAR_SEG_BYTES && segChunks.length > 1) {
          segBytes -= segChunks.shift()!.length;
        }
        inner.sendAudio(pcm);
      },
      stop(): void {
        diarizer.reset();
        inner.stop();
      }
    };
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

  function setAsrProvider(next: AsrProvider, volc?: VolcCredentials, funasr?: { url: string }): void {
    // 'funasr' is legacy for "paraformer + diarize"; the diarize flag is separate now.
    provider = next === 'volc' ? 'volc' : 'paraformer';
    if (volc) volcCreds = { ...volc };
    camppUrl = funasr?.url || config.camppUrl;
  }

  function setDiarize(enabled: boolean): void {
    diarize = enabled;
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
    setDiarize,
    isCapturing,
    dispose
  };
}
