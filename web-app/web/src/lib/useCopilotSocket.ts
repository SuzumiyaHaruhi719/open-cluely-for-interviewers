import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioSource,
  ClientMessage,
  ServerMessage,
  SessionConfig,
  SpeakerRole
} from '@open-cluely/contract';
import { WS_PATH } from '@open-cluely/contract';
import { parseServerMessage } from './messages';
import { startCapture, AudioCaptureError, type CaptureHandle } from './audioCapture';
import { effectiveRole, appendSegment, relabelSegments, type SpeakerSegment } from './speakerSegments';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

/**
 * A `result` payload plus the requestId it answered. The contract's `result`
 * member carries the optional auto-question-generation fields (`ranked`,
 * `trigger`) used by the QuestionCard.
 */
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
  /** Add a manual interviewer note to the server's candidate-answer context (feeds auto + manual generation). */
  addContextNote: (note: string) => boolean;
  lastResult: CopilotResult | null;
  /**
   * Timestamp (ms) of the last `trigger === 'auto'` result, or of when interval
   * mode last became active. Drives the client-side "next auto follow-up" cooldown
   * countdown; null when no auto fire has happened yet.
   */
  lastAutoFireAt: number | null;
  /** Latest progress event for the in-flight request (cleared on result/error). */
  progress: CopilotProgress | null;
  /**
   * Cumulative tokens (input + output) reported across the in-flight request's
   * progress events. Reset to 0 on each `analyze()`; 0 until the first phase
   * carries a `tokens` payload.
   */
  progressTokens: number;
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
  /**
   * Ordered list of finalized speaker-labeled segments (offline FunASR only).
   * Empty for online providers that omit speakerId.
   */
  speakerSegments: SpeakerSegment[];
  /**
   * One-tap role override: re-labels all segments for a given speaker id and
   * tells the server to update its candidate-gating state.
   */
  setSpeakerRole: (speakerId: number, role: SpeakerRole) => void;
  /** Clear the offline speaker segments + role overrides (called per-session, not per-analyze). */
  resetSpeakerSegments: () => void;
  /** Reset the live transcript lanes + last result/progress/error — a clean slate
   *  for a new interview so one chat's context never leaks into the next. */
  resetTranscripts: () => void;
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
  // Timestamp of the last auto fire, for the interval-mode cooldown countdown.
  const [lastAutoFireAt, setLastAutoFireAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<CopilotProgress | null>(null);
  const [progressTokens, setProgressTokens] = useState(0);
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
  const [speakerSegments, setSpeakerSegments] = useState<SpeakerSegment[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  // Live capture handles + per-source frame sequence counters.
  const captureRef = useRef<Record<AudioSource, CaptureHandle | null>>({ mic: null, display: null });
  const seqRef = useRef<Record<AudioSource, number>>({ mic: 0, display: 0 });
  // Speaker-segment state for offline FunASR diarization.
  const roleOverrideRef = useRef<Map<number, SpeakerRole>>(new Map());
  const segSeqRef = useRef(0);

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
        // Adopt a server-initiated (autonomous) request: when nothing is in
        // flight, the first progress event's requestId becomes the active one so
        // the auto follow-up shows the same progress bar a manual analyze does.
        // The manual flow always has an active requestId, so this branch is inert
        // for it. The matching 'result'/'error' clears activeRequestRef as usual.
        if (activeRequestRef.current === null) {
          activeRequestRef.current = message.requestId;
          setIsAnalyzing(true);
          setProgressTokens(0);
        }
        if (message.requestId === activeRequestRef.current) {
          setProgress(message);
          if (message.tokens) {
            const delta = message.tokens.input + message.tokens.output;
            setProgressTokens((prev) => prev + delta);
          }
        }
        break;
      case 'result':
        // ANY result means the in-flight generation finished — ALWAYS clear the
        // progress UI and show it. Previously this cleared isAnalyzing only when
        // the result's requestId matched the adopted one; on any mismatch (the
        // autonomous adoption path is fragile) isAnalyzing stayed true, so the
        // single-bubble render kept the card hidden and the progress bar stuck
        // ("bar fills to 100%, no question"). With the single-bubble model the
        // latest result is simply the one shown, so unconditional is correct.
        activeRequestRef.current = null;
        setIsAnalyzing(false);
        setProgress(null);
        // A new result OVERWRITES the previous one — only the latest follow-up
        // bubble is ever shown (no history accumulation).
        setLastResult(message);
        // An auto-triggered result restarts the cooldown window for the countdown.
        if (message.trigger === 'auto') {
          setLastAutoFireAt(Date.now());
        }
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
        // Offline FunASR: append a labelled segment for finals that carry a real speakerId.
        // Online providers omit speakerId entirely — they must NOT create segments.
        if (isFinal && typeof message.speakerId === 'number') {
          const sid = message.speakerId;
          const role = effectiveRole(sid, message.speaker, roleOverrideRef.current);
          setSpeakerSegments((prev) =>
            appendSegment(prev, { id: segSeqRef.current++, speakerId: sid, role, text })
          );
        }
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
      setProgressTokens(0);
      setError(null);
      return requestId;
    },
    [send]
  );

  // Manual interviewer note → server candidate-answer context (auto + manual gen).
  const addContextNote = useCallback(
    (note: string): boolean => send({ type: 'context-note', note }),
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

  const setSpeakerRole = useCallback(
    (speakerId: number, role: SpeakerRole): void => {
      roleOverrideRef.current.set(speakerId, role);
      // Re-label this speaker's past bubbles immediately; the server updates its
      // candidate-gating + future stamping. iFlytek mode assigns each speaker
      // independently (no auto-complement); CAM++ guess-mode complements server-side.
      setSpeakerSegments((prev) => relabelSegments(prev, speakerId, role));
      send({ type: 'set-speaker-role', speakerId, role });
    },
    [send]
  );

  // Speaker segments are the offline rolling transcript — they persist across
  // analyze()/Generate-Q and reset only on a new session (Shell.onClearSession).
  const resetSpeakerSegments = useCallback((): void => {
    setSpeakerSegments([]);
    roleOverrideRef.current.clear();
    segSeqRef.current = 0;
  }, []);

  // Reset the live conversation to a clean slate for a NEW interview so the
  // previous interview's transcript + follow-up never leak in: lanes, last result,
  // progress + tokens, in-flight flag, error. Any in-flight generation is simply
  // abandoned — its late progress/result has nowhere to surface once cleared.
  const resetTranscripts = useCallback((): void => {
    setTranscripts({ mic: { ...EMPTY_LANE }, display: { ...EMPTY_LANE } });
    setLastResult(null);
    setLastAutoFireAt(null);
    setProgress(null);
    setProgressTokens(0);
    setIsAnalyzing(false);
    setError(null);
    activeRequestRef.current = null;
  }, []);

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
    addContextNote,
    lastResult,
    lastAutoFireAt,
    progress,
    progressTokens,
    isAnalyzing,
    error,
    transcripts,
    audio,
    startAudio,
    stopAudio,
    speakerSegments,
    setSpeakerRole,
    resetSpeakerSegments,
    resetTranscripts
  };
}
