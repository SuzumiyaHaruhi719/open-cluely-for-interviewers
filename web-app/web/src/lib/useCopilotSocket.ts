import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioSource,
  ClientMessage,
  ServerMessage,
  SessionConfig
} from '@open-cluely/contract';
import { WS_PATH } from '@open-cluely/contract';
import { parseServerMessage } from './messages';
import { startCapture, AudioCaptureError, type CaptureHandle } from './audioCapture';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

/** A `result` payload plus the requestId it answered. */
export type CopilotResult = Extract<ServerMessage, { type: 'result' }>;
export type CopilotProgress = Extract<ServerMessage, { type: 'progress' }>;

/** Per-source transcript: committed finals + the live (in-flight) partial. */
export interface LaneTranscript {
  finalText: string;
  partial: string;
}

export type TranscriptLanes = Record<AudioSource, LaneTranscript>;

/** Per-source live-audio capture state for the UI. */
export interface AudioState {
  capturing: boolean;
  /** 0..1 RMS input level (for a VU meter). */
  level: number;
  /** Friendly capture error (denied / cancelled / unsupported), else null. */
  error: string | null;
}

export type AudioLanes = Record<AudioSource, AudioState>;

const EMPTY_LANE: LaneTranscript = { finalText: '', partial: '' };
const IDLE_AUDIO: AudioState = { capturing: false, level: 0, error: null };

export interface CopilotSocket {
  status: SocketStatus;
  sessionId: string | null;
  /**
   * Send a partial session config to the server. No-op if not connected.
   * `Partial<SessionConfig>` includes the ASR fields (asrProvider, volcAppId,
   * volcAccessToken, volcResourceId, volcModel) so the settings modal can switch
   * the live recognizer and pass Doubao/Volc creds in the same configure message.
   */
  sendConfigure: (config: Partial<SessionConfig>) => void;
  /** Request an analysis. Returns the generated requestId, or null if not connected. */
  analyze: (candidateAnswer: string, questionHistory?: string[]) => string | null;
  lastResult: CopilotResult | null;
  /** Latest progress event for the in-flight request (cleared on result/error). */
  progress: CopilotProgress | null;
  /** True between `analyze()` and the matching result/error. */
  isAnalyzing: boolean;
  error: string | null;
  /** Running transcripts per source (interviewer=mic, interviewee=display). */
  transcripts: TranscriptLanes;
  /** Live-audio capture state per source. */
  audio: AudioLanes;
  /** Begin capturing + streaming a source's audio to the ASR relay. */
  startAudio: (source: AudioSource) => Promise<void>;
  /** Stop capturing a source and tell the server to close its ASR session. */
  stopAudio: (source: AudioSource) => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

function buildWsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${WS_PATH}`;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Manages the copilot WebSocket lifecycle: connect, parse inbound
 * `ServerMessage`s, track the in-flight analyze request, and reconnect with
 * exponential backoff. The socket is opened once on mount and torn down on
 * unmount.
 */
export function useCopilotSocket(): CopilotSocket {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CopilotResult | null>(null);
  const [progress, setProgress] = useState<CopilotProgress | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptLanes>({
    mic: { ...EMPTY_LANE },
    display: { ...EMPTY_LANE }
  });
  const [audio, setAudio] = useState<AudioLanes>({
    mic: { ...IDLE_AUDIO },
    display: { ...IDLE_AUDIO }
  });

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  // Live capture handles + per-source frame sequence counters.
  const captureRef = useRef<Record<AudioSource, CaptureHandle | null>>({ mic: null, display: null });
  const seqRef = useRef<Record<AudioSource, number>>({ mic: 0, display: 0 });

  const send = useCallback((message: ClientMessage): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'ready':
        setSessionId(message.sessionId);
        break;
      case 'progress':
        if (message.requestId === activeRequestRef.current) {
          setProgress(message);
        }
        break;
      case 'result':
        if (message.requestId === activeRequestRef.current) {
          activeRequestRef.current = null;
          setIsAnalyzing(false);
          setProgress(null);
        }
        setLastResult(message);
        break;
      case 'error':
        if (!message.requestId || message.requestId === activeRequestRef.current) {
          activeRequestRef.current = null;
          setIsAnalyzing(false);
          setProgress(null);
        }
        setError(message.message);
        break;
      case 'session-context':
        // No UI surface for raw session context yet; intentionally ignored.
        break;
      case 'transcript': {
        const { source, text, isFinal } = message;
        setTranscripts((prev) => {
          const lane = prev[source];
          const next: LaneTranscript = isFinal
            ? { finalText: `${lane.finalText} ${text}`.trim(), partial: '' }
            : { finalText: lane.finalText, partial: text };
          return { ...prev, [source]: next };
        });
        break;
      }
    }
  }, []);

  // Connection management. `connect` is intentionally defined inside the effect
  // so the reconnect loop captures a stable closure over the helpers above.
  useEffect(() => {
    isMountedRef.current = true;

    const clearReconnect = (): void => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = (): void => {
      const attempt = attemptsRef.current;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attemptsRef.current = attempt + 1;
      setStatus('reconnecting');
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    };

    function connect(): void {
      if (!isMountedRef.current) {
        return;
      }
      setStatus((prev) => (prev === 'reconnecting' ? prev : 'connecting'));

      let socket: WebSocket;
      try {
        socket = new WebSocket(buildWsUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attemptsRef.current = 0;
        setStatus('open');
        setError(null);
      };

      socket.onmessage = (event: MessageEvent) => {
        const parsed = parseServerMessage(event.data);
        if (parsed) {
          handleMessage(parsed);
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (!isMountedRef.current) {
          return;
        }
        scheduleReconnect();
      };

      socket.onerror = () => {
        // `onclose` always follows; let it drive reconnection.
        socket.close();
      };
    }

    connect();

    return () => {
      isMountedRef.current = false;
      clearReconnect();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.onopen = null;
        socket.close();
      }
    };
  }, [handleMessage]);

  const sendConfigure = useCallback(
    (config: Partial<SessionConfig>) => {
      send({ type: 'configure', config });
    },
    [send]
  );

  const analyze = useCallback(
    (candidateAnswer: string, questionHistory?: string[]): string | null => {
      const requestId = newRequestId();
      const message: ClientMessage = questionHistory
        ? { type: 'analyze', requestId, candidateAnswer, questionHistory }
        : { type: 'analyze', requestId, candidateAnswer };
      if (!send(message)) {
        return null;
      }
      activeRequestRef.current = requestId;
      setIsAnalyzing(true);
      setProgress(null);
      setError(null);
      return requestId;
    },
    [send]
  );

  const setAudioState = useCallback((source: AudioSource, patch: Partial<AudioState>): void => {
    setAudio((prev) => ({ ...prev, [source]: { ...prev[source], ...patch } }));
  }, []);

  const stopAudio = useCallback(
    (source: AudioSource): void => {
      const handle = captureRef.current[source];
      captureRef.current[source] = null;
      if (handle) {
        handle.stop();
      }
      // Tell the server to finish this source's ASR session. Safe if not open.
      send({ type: 'audio-control', action: 'stop', source });
      setAudioState(source, { capturing: false, level: 0 });
    },
    [send, setAudioState]
  );

  const startAudio = useCallback(
    async (source: AudioSource): Promise<void> => {
      // Already capturing — no-op (idempotent toggle).
      if (captureRef.current[source]) return;

      setAudioState(source, { error: null });
      // Tell the server to open the ASR session before frames arrive.
      send({ type: 'audio-control', action: 'start', source });
      seqRef.current[source] = 0;

      try {
        const handle = await startCapture(source, {
          onFrame: (pcm) => {
            const seq = seqRef.current[source]++;
            send({ type: 'audio', seq, source, pcm });
          },
          onLevel: (level) => setAudioState(source, { level })
        });
        // The component may have unmounted while we awaited the share/mic
        // prompt — don't keep a stale graph alive.
        if (!isMountedRef.current) {
          handle.stop();
          send({ type: 'audio-control', action: 'stop', source });
          return;
        }
        captureRef.current[source] = handle;
        setAudioState(source, { capturing: true });
      } catch (err) {
        // User cancelled/denied or unsupported — surface friendly, don't crash.
        const message =
          err instanceof AudioCaptureError ? err.message : 'Could not start audio capture.';
        send({ type: 'audio-control', action: 'stop', source });
        setAudioState(source, { capturing: false, level: 0, error: message });
      }
    },
    [send, setAudioState]
  );

  // Stop any live capture when the hook unmounts.
  useEffect(() => {
    return () => {
      for (const source of ['mic', 'display'] as AudioSource[]) {
        const handle = captureRef.current[source];
        captureRef.current[source] = null;
        if (handle) handle.stop();
      }
    };
  }, []);

  return {
    status,
    sessionId,
    sendConfigure,
    analyze,
    lastResult,
    progress,
    isAnalyzing,
    error,
    transcripts,
    audio,
    startAudio,
    stopAudio
  };
}
