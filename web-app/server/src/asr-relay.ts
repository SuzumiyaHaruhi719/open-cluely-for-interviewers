// ============================================================================
// Per-WebSocket-connection ASR relay.
// ----------------------------------------------------------------------------
// The browser captures the interviewee (getDisplayMedia -> source 'display')
// and interviewer (getUserMedia -> source 'mic'), downsamples to 16 kHz mono
// s16le in an AudioWorklet, and streams base64 PCM frames over the copilot
// WebSocket. This relay owns one Paraformer recognition session PER source,
// lazily started on the first 'start' control (or first audio frame), feeds it
// the decoded PCM, and turns partial/final transcripts into `transcript`
// ServerMessages via the injected `emit`.
//
// REUSE: the actual DashScope protocol lives in ./paraformer-client (a focused
// port of the desktop src/services/paraformer/service.js protocol — see the
// note there for why we ported rather than consumed the Electron factory).
// ============================================================================

import { WebSocket as WsWebSocket } from 'ws';
import type { AudioSource } from '@open-cluely/contract';
import { config } from './config';
import {
  createParaformerSession,
  type ParaformerSession,
  type ParaformerSessionDeps,
  type WsConstructor
} from './paraformer-client';

export interface TranscriptEmit {
  source: AudioSource;
  text: string;
  isFinal: boolean;
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

/** Factory used to create a session — overridable in tests with a fake. */
export type SessionFactory = (deps: ParaformerSessionDeps) => ParaformerSession;

export interface AsrRelayDeps {
  /** Send a `transcript` message back to this connection's browser. */
  emit: (t: TranscriptEmit) => void;
  /** DashScope API key. Defaults to config.dashscopeApiKey. */
  apiKey?: string;
  /** Session factory (defaults to the real Paraformer client). */
  sessionFactory?: SessionFactory;
  /** WebSocket constructor passed to the session (defaults to `ws`). */
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
  const sessionFactory = deps.sessionFactory ?? createParaformerSession;
  const WebSocketCtor = (deps.WebSocket ?? (WsWebSocket as unknown)) as WsConstructor;

  const sessions: Record<AudioSource, ParaformerSession | null> = { mic: null, display: null };
  let autoAnalyzeDisplay = false;
  let disposed = false;

  function startSource(source: AudioSource): void {
    if (disposed || sessions[source]) return;
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
      onTranscript: ({ text, isFinal }) => {
        deps.emit({ source, text, isFinal });
        if (isFinal && source === 'display' && autoAnalyzeDisplay) {
          try {
            deps.onDisplayFinal?.(text);
          } catch {
            /* never let an analyze trigger break the relay */
          }
        }
      },
      onError: (message) => {
        deps.emit({ source, text: `[ASR error: ${message}]`, isFinal: false });
        stopSource(source);
      }
    });
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

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const source of SOURCES) stopSource(source);
  }

  return { handleAudio, handleAudioControl, setAutoAnalyzeDisplay, dispose };
}
