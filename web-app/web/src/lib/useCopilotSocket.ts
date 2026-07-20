import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AsrProvider,
  AsrRuntimeState,
  AudioSource,
  ClientMessage,
  ServerMessage,
  SessionConfig,
  SessionContextState,
  SummaryDebugEvent,
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

/**
 * The interview-summary report state. 'idle' before any run; 'loading' while
 * waiting for the first chunk (spinner); 'streaming' once text starts arriving
 * (progress bar + live text); 'done' with the full `text`; 'error' with the
 * failure message. `empty` is set on a 'done' that carries the friendly "nothing
 * to summarize" notice (so the modal renders a notice, not a fake report).
 * `startedAt` is set when the request is sent (ms timestamp); `tokens` accumulates
 * the output token count reported by the server.
 */
export interface SummaryState {
  status: 'idle' | 'loading' | 'streaming' | 'done' | 'error';
  text: string;
  error: string | null;
  /** True when 'done' carries the empty-transcript notice rather than a real report. */
  empty: boolean;
  /** ms timestamp when the summarize request was sent — for elapsed-time display. */
  startedAt: number | null;
  /** Accumulated output token count from the stream (0 until tokens arrive). */
  tokens: number;
  /** Sanitized event-level timeline for debugging stuck summary runs. */
  debugEvents: SummaryDebugEvent[];
}

/** Per-source live-audio capture state for the UI. */
export interface AudioState {
  capturing: boolean;
  /** 0..1 RMS input level (for a VU meter). */
  level: number;
  /** Friendly capture error (denied / cancelled / unsupported), else null. */
  error: string | null;
  /** Non-fatal ASR completion notice; never used to mark the capture as failed. */
  notice?: string | null;
  /** Server-confirmed ASR lifecycle; independent from the browser capture graph. */
  runtimeState?: AsrRuntimeState;
  /** Provider that owns the current or most recently finalized server session. */
  provider?: AsrProvider;
}

export type AudioLanes = Record<AudioSource, AudioState>;
export interface StartAudioOptions {
  /** Used by the local sim ASR provider: open the server ASR session without browser media permissions. */
  skipLocalCapture?: boolean;
}

const EMPTY_LANE: LaneTranscript = { finalText: '', partial: '' };
const IDLE_AUDIO: AudioState = {
  capturing: false,
  level: 0,
  error: null,
  notice: null,
  runtimeState: 'stopped'
};

export interface CopilotSocket {
  status: SocketStatus;
  sessionId: string | null;
  /**
   * Send a partial session config to the server. No-op if not connected.
   * `Partial<SessionConfig>` includes the provider name; credentials and model
   * entitlements remain environment-owned on the server.
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
  startAudio: (source: AudioSource, options?: StartAudioOptions) => Promise<void>;
  /** Stop capturing a source and tell the server to close its ASR session. */
  stopAudio: (source: AudioSource) => void;
  /**
   * Ordered list of finalized speaker-partitioned segments.
   */
  speakerSegments: SpeakerSegment[];
  /**
   * One-tap role override: re-labels all segments for a given speaker id and
   * tells the server to update its candidate-gating state.
   */
  setSpeakerRole: (speakerId: number, role: SpeakerRole) => void;
  /** Clear the offline speaker segments + role overrides (called per-session, not per-analyze). */
  resetSpeakerSegments: () => void;
  /**
   * Latest live session-context state from the server (competencies / drilled
   * topics / open gaps), or null until the first analysis arrives. Drives the
   * right-rail SessionContextPanel; cleared by resetTranscripts ("New interview").
   */
  sessionContext: SessionContextState | null;
  /**
   * The interview-summary report (DeepSeek v4 pro): status + report text + error
   * + empty-notice flag. Drives the SummaryModal. Reset to idle by resetTranscripts
   * ("New interview"). The server is one-shot — the whole report arrives at once.
   */
  summary: SummaryState;
  /**
   * Request an interview summary. Sends `summarize`, flips `summary` to
   * 'loading', and returns the generated requestId (or null if not connected or
   * local transcript has no candidate content). `clientTranscript` is optional
   * seeded/template history rendered locally before any live ASR transcript.
   * Stale replies (a different requestId) are ignored so a re-run supersedes.
   */
  startSummary: (clientTranscript?: string) => string | null;
  /** Reset the live transcript lanes + last result/progress/error — a clean slate
   *  for a new interview so one chat's context never leaks into the next. */
  resetTranscripts: () => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const SUMMARY_CLIENT_TIMEOUT_MS = 150000;
const SUMMARY_DEBUG_MAX_EVENTS = 200;

function buildWsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  if (import.meta.env.DEV && location.port === '5173') {
    return `${scheme}://localhost:8787${WS_PATH}`;
  }
  return `${scheme}://${location.host}${WS_PATH}`;
}

function parseServerMessageData(raw: unknown): ServerMessage | null | undefined {
  if (typeof raw === 'string') {
    return parseServerMessage(raw);
  }
  if (raw instanceof ArrayBuffer) {
    return parseServerMessage(new TextDecoder().decode(raw));
  }
  if (ArrayBuffer.isView(raw)) {
    return parseServerMessage(new TextDecoder().decode(raw));
  }
  return undefined;
}

function readBlobText(blob: Blob): Promise<string> {
  const maybeText = (blob as Blob & { text?: () => Promise<string> }).text;
  if (typeof maybeText === 'function') {
    return maybeText.call(blob);
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read Blob payload'));
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsText(blob);
    });
  }
  if (typeof Response !== 'undefined') {
    return new Response(blob).text();
  }
  return Promise.reject(new Error('Blob payloads are not readable in this environment'));
}

function isSummaryMessage(message: ServerMessage): boolean {
  return (
    message.type === 'summary-chunk' ||
    message.type === 'summary-debug' ||
    message.type === 'summary-done' ||
    message.type === 'summary-error'
  );
}

function appendSummaryDebugEvent(
  events: SummaryDebugEvent[],
  event: SummaryDebugEvent
): SummaryDebugEvent[] {
  const next = [...events, event];
  return next.length > SUMMARY_DEBUG_MAX_EVENTS ? next.slice(-SUMMARY_DEBUG_MAX_EVENTS) : next;
}

function createClientSummaryDebugEvent(
  stage: string,
  detail: Omit<SummaryDebugEvent, 'at' | 'source' | 'stage'> = {}
): SummaryDebugEvent {
  return { at: Date.now(), source: 'client', stage, ...detail };
}

function logSummaryDebugEvent(requestId: string, event: SummaryDebugEvent): void {
  if (import.meta.env.MODE === 'test') {
    return;
  }
  const parts = [
    '[summary-debug]',
    `requestId=${requestId}`,
    `source=${event.source}`,
    `stage=${event.stage}`
  ];
  if (event.model) parts.push(`model=${event.model}`);
  if (typeof event.status === 'number') parts.push(`status=${event.status}`);
  if (event.eventType) parts.push(`event=${event.eventType}`);
  if (typeof event.inputChars === 'number') parts.push(`inputChars=${event.inputChars}`);
  if (typeof event.chunkChars === 'number') parts.push(`chunkChars=${event.chunkChars}`);
  if (typeof event.accumulatedChars === 'number') parts.push(`accumulatedChars=${event.accumulatedChars}`);
  if (typeof event.inputTokens === 'number') parts.push(`inputTokens=${event.inputTokens}`);
  if (typeof event.outputTokens === 'number') parts.push(`outputTokens=${event.outputTokens}`);
  if (typeof event.elapsedMs === 'number') parts.push(`elapsedMs=${event.elapsedMs}`);
  if (event.reason) parts.push(`reason=${JSON.stringify(event.reason)}`);
  if (event.error) parts.push(`error=${JSON.stringify(event.error)}`);
  console.info(parts.join(' '));
}

function hasLocalSummaryContent(
  transcripts: TranscriptLanes,
  speakerSegments: SpeakerSegment[],
  clientTranscript = ''
): boolean {
  if (clientTranscript.trim().length > 0) {
    return true;
  }
  if (transcripts.display.finalText.trim().length > 0) {
    return true;
  }
  return speakerSegments.some((segment) => segment.role === 'candidate' && segment.text.trim().length > 0);
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
  const [sessionContext, setSessionContext] = useState<SessionContextState | null>(null);
  const [summary, setSummary] = useState<SummaryState>({
    status: 'idle',
    text: '',
    error: null,
    empty: false,
    startedAt: null,
    tokens: 0,
    debugEvents: []
  });
  // The requestId of the in-flight summary, so stale summary-* replies from a
  // superseded run are ignored (a re-run mints a new id).
  const activeSummaryRef = useRef<string | null>(null);
  const summaryTimeoutRef = useRef<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const abandonedRequestIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  // Live capture handles + per-source frame sequence counters.
  const captureRef = useRef<Record<AudioSource, CaptureHandle | null>>({ mic: null, display: null });
  const seqRef = useRef<Record<AudioSource, number>>({ mic: 0, display: 0 });
  // Speaker-segment state for native clusters and Flash semantic partitioning.
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

  const clearSummaryTimeout = useCallback((): void => {
    if (summaryTimeoutRef.current !== null) {
      window.clearTimeout(summaryTimeoutRef.current);
      summaryTimeoutRef.current = null;
    }
  }, []);

  const armSummaryTimeout = useCallback(
    (requestId: string): void => {
      clearSummaryTimeout();
      summaryTimeoutRef.current = window.setTimeout(() => {
        if (activeSummaryRef.current !== requestId) {
          return;
        }
        const event = createClientSummaryDebugEvent('client:timeout-fired', {
          elapsedMs: SUMMARY_CLIENT_TIMEOUT_MS
        });
        logSummaryDebugEvent(requestId, event);
        activeSummaryRef.current = null;
        summaryTimeoutRef.current = null;
        setSummary((prev) => ({
          ...prev,
          status: 'error',
          error: '总结生成超时，请重试。',
          empty: false,
          debugEvents: appendSummaryDebugEvent(prev.debugEvents, event)
        }));
      }, SUMMARY_CLIENT_TIMEOUT_MS);
    },
    [clearSummaryTimeout]
  );

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'ready':
        setSessionId(message.sessionId);
        break;
      case 'progress':
        if (abandonedRequestIdsRef.current.has(message.requestId)) {
          break;
        }
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
        if (abandonedRequestIdsRef.current.delete(message.requestId)) {
          break;
        }
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
        if (message.requestId && abandonedRequestIdsRef.current.delete(message.requestId)) {
          break;
        }
        if (!message.requestId || message.requestId === activeRequestRef.current) {
          activeRequestRef.current = null;
          setIsAnalyzing(false);
          setProgress(null);
        }
        setError(message.message);
        break;
      case 'session-context':
        // Latest live analysis from the server's light analyzer — store it for the
        // right-rail SessionContextPanel. The server only emits non-null states, so
        // a new message always carries fresh signal; overwrite the previous one.
        setSessionContext(message.state);
        break;
      // Streaming chunk: accumulate text and flip status to 'streaming' so the
      // UI can show the live progress bar + partial report.
      case 'summary-chunk':
        if (message.requestId !== activeSummaryRef.current) break;
        {
          clearSummaryTimeout();
          const event = createClientSummaryDebugEvent('client:summary-chunk-received', {
            chunkChars: message.text.length
          });
          logSummaryDebugEvent(message.requestId, event);
          setSummary((prev) => ({
            ...prev,
            status: 'streaming',
            text: prev.text + message.text,
            debugEvents: appendSummaryDebugEvent(prev.debugEvents, event)
          }));
        }
        break;
      case 'summary-debug':
        if (message.requestId !== activeSummaryRef.current) break;
        logSummaryDebugEvent(message.requestId, message.event);
        setSummary((prev) => ({
          ...prev,
          debugEvents: appendSummaryDebugEvent(prev.debugEvents, message.event)
        }));
        break;
      case 'summary-done':
        if (message.requestId !== activeSummaryRef.current) break;
        {
          const detail: Omit<SummaryDebugEvent, 'at' | 'source' | 'stage'> = {};
          if (message.model) detail.model = message.model;
          if (typeof message.text === 'string') detail.accumulatedChars = message.text.length;
          if (message.empty === true) detail.reason = 'empty';
          const event = createClientSummaryDebugEvent('client:summary-done-received', detail);
          logSummaryDebugEvent(message.requestId, event);
          activeSummaryRef.current = null;
          clearSummaryTimeout();
          // Streaming path: `text` is absent (chunks already accumulated it).
          // One-shot/empty path: `text` carries the whole report or the notice.
          setSummary((prev) => ({
            ...prev,
            status: 'done',
            // Use the server's text when present (one-shot / empty notice),
            // otherwise keep what we accumulated from chunks.
            text: typeof message.text === 'string' ? message.text : prev.text,
            error: null,
            empty: message.empty === true,
            debugEvents: appendSummaryDebugEvent(prev.debugEvents, event)
          }));
        }
        break;
      case 'summary-error':
        if (message.requestId !== activeSummaryRef.current) break;
        {
          const event = createClientSummaryDebugEvent('client:summary-error-received', {
            error: message.message
          });
          logSummaryDebugEvent(message.requestId, event);
          activeSummaryRef.current = null;
          clearSummaryTimeout();
          setSummary((prev) => ({
            ...prev,
            status: 'error',
            error: message.message,
            empty: false,
            debugEvents: appendSummaryDebugEvent(prev.debugEvents, event)
          }));
        }
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
        // Native-cluster ASR: append finals that carry a real speakerId. Text-only
        // providers are populated later by a `speaker-partition` message.
        if (isFinal && typeof message.speakerId === 'number') {
          const sid = message.speakerId;
          const role = effectiveRole(sid, message.speaker, roleOverrideRef.current);
          setSpeakerSegments((prev) =>
            appendSegment(prev, { id: segSeqRef.current++, speakerId: sid, role, text })
          );
        }
        break;
      }
      case 'asr-status': {
        setAudio((prev) => ({
          ...prev,
          [message.source]: {
            ...prev[message.source],
            provider: message.provider,
            runtimeState: message.state,
            error: message.state === 'failed' ? message.message ?? '语音识别失败。' : null,
            notice:
              message.state === 'partial'
                ? '转写已保存；最后一小段可能未确认。'
                : null
          }
        }));
        break;
      }
      case 'speaker-partition': {
        // DeepSeek Flash resolves native acoustic clusters (or, for ASR models
        // without clusters, finalized semantic turns) after enough evidence.
        // Replace the provisional unknown-role list atomically so past bubbles,
        // the candidate buffer, and future manual corrections share one view.
        const next = message.segments.map((segment) => ({
          id: segment.seq,
          speakerId: segment.speakerId,
          role: effectiveRole(segment.speakerId, segment.role, roleOverrideRef.current),
          text: segment.text
        }));
        setSpeakerSegments(next);
        const maxSeq = message.segments.reduce((max, segment) => Math.max(max, segment.seq), -1);
        segSeqRef.current = Math.max(segSeqRef.current, maxSeq + 1);
        break;
      }
    }
  }, [clearSummaryTimeout]);

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
        const parsed = parseServerMessageData(event.data);
        if (parsed !== undefined) {
          if (parsed && (socketRef.current === socket || isSummaryMessage(parsed))) {
            handleMessage(parsed);
          }
          return;
        }
        if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
          void readBlobText(event.data)
            .then((text) => {
              const parsedBlob = parseServerMessage(text);
              if (parsedBlob && (socketRef.current === socket || isSummaryMessage(parsedBlob))) {
                handleMessage(parsedBlob);
              }
            })
            .catch(() => {
              /* malformed Blob payload — ignore like an unparsable JSON frame */
            });
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        // If a summary was in flight, the one-shot server is stateless about it —
        // no reply will ever arrive over this (now-dead) socket, so the modal would
        // otherwise spin forever. Fail it with a friendly message and clear the
        // in-flight ref so a re-run can start clean.
        if (activeSummaryRef.current !== null) {
          const requestId = activeSummaryRef.current;
          const event = createClientSummaryDebugEvent('client:socket-closed');
          logSummaryDebugEvent(requestId, event);
          activeSummaryRef.current = null;
          clearSummaryTimeout();
          setSummary((prev) => ({
            ...prev,
            status: 'error',
            error: '连接已断开，总结未完成，请重试。',
            empty: false,
            debugEvents: appendSummaryDebugEvent(prev.debugEvents, event)
          }));
        }
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
  }, [clearSummaryTimeout, handleMessage]);

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
      abandonedRequestIdsRef.current.delete(requestId);
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

  // Request an interview summary: mint a requestId, send `summarize`, and flip the
  // summary state to 'loading' (the modal shows a spinner until first chunk arrives).
  // A re-run mints a new id, so late replies from the previous run are ignored.
  const startSummary = useCallback((clientTranscript = ''): string | null => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const startEvent = createClientSummaryDebugEvent('client:start');
    const transcript = clientTranscript.trim();
    if (!hasLocalSummaryContent(transcripts, speakerSegments, transcript)) {
      const emptyEvent = createClientSummaryDebugEvent('client:empty-local');
      const debugEvents = [startEvent, emptyEvent];
      for (const event of debugEvents) {
        logSummaryDebugEvent(requestId, event);
      }
      activeSummaryRef.current = null;
      clearSummaryTimeout();
      setSummary({
        status: 'done',
        text: '还没有可总结的面试内容。\n\n请等待候选人发言后再生成总结。',
        error: null,
        empty: true,
        startedAt,
        tokens: 0,
        debugEvents
      });
      return null;
    }
    const sentEvent = createClientSummaryDebugEvent('client:sent');
    const timeoutEvent = createClientSummaryDebugEvent('client:timeout-armed', { elapsedMs: SUMMARY_CLIENT_TIMEOUT_MS });
    const debugEvents = [startEvent, sentEvent, timeoutEvent];
    const message: ClientMessage = transcript
      ? { type: 'summarize', requestId, transcript }
      : { type: 'summarize', requestId };
    activeSummaryRef.current = requestId;
    for (const event of debugEvents) {
      logSummaryDebugEvent(requestId, event);
    }
    setSummary({
      status: 'loading',
      text: '',
      error: null,
      empty: false,
      startedAt,
      tokens: 0,
      debugEvents
    });
    if (!send(message)) {
      const failedEvent = createClientSummaryDebugEvent('client:send-failed');
      logSummaryDebugEvent(requestId, failedEvent);
      activeSummaryRef.current = null;
      clearSummaryTimeout();
      setSummary({
        status: 'error',
        text: '',
        error: '连接尚未就绪，无法发送总结请求。',
        empty: false,
        startedAt,
        tokens: 0,
        debugEvents: [startEvent, failedEvent]
      });
      return null;
    }
    armSummaryTimeout(requestId);
    return requestId;
  }, [armSummaryTimeout, clearSummaryTimeout, send, speakerSegments, transcripts]);

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
      setAudioState(source, {
        capturing: false,
        level: 0,
        error: null,
        notice: null,
        runtimeState: 'finalizing'
      });
    },
    [send, setAudioState]
  );

  const startAudio = useCallback(
    async (source: AudioSource, options?: StartAudioOptions): Promise<void> => {
      // Already capturing — no-op (idempotent toggle).
      if (captureRef.current[source]) return;

      setAudioState(source, { error: null, notice: null, runtimeState: 'connecting' });
      seqRef.current[source] = 0;

      if (options?.skipLocalCapture) {
        // Simulation has no permission/media setup, so its server session can
        // start immediately.
        send({ type: 'audio-control', action: 'start', source });
        captureRef.current[source] = { stop: () => {} };
        setAudioState(source, { capturing: true, level: 0 });
        return;
      }

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
        // Browser permission prompts can remain open longer than an upstream
        // recognizer's idle timeout. Open ASR only after local media is ready;
        // an early worklet frame is still safe because the relay starts lazily.
        send({ type: 'audio-control', action: 'start', source });
        setAudioState(source, { capturing: true });
      } catch (err) {
        // User cancelled/denied or unsupported — surface friendly, don't crash.
        const message =
          err instanceof AudioCaptureError ? err.message : '无法启动音频采集。';
        send({ type: 'audio-control', action: 'stop', source });
        setAudioState(source, {
          capturing: false,
          level: 0,
          error: message,
          notice: null,
          runtimeState: 'failed'
        });
      }
    },
    [send, setAudioState]
  );

  const setSpeakerRole = useCallback(
    (speakerId: number, role: SpeakerRole): void => {
      roleOverrideRef.current.set(speakerId, role);
      // Re-label this speaker's past bubbles immediately; the server updates its
      // candidate-gating + future stamping. Manual corrections remain sticky and
      // win over every later automatic classifier refresh.
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
    if (activeRequestRef.current) {
      abandonedRequestIdsRef.current.add(activeRequestRef.current);
    }
    activeRequestRef.current = null;
    // Drop the live session context too so the panel returns to its empty state
    // for the next interview ("New interview").
    setSessionContext(null);
    // Clear any interview summary so "New interview" starts with a blank report.
    setSummary({ status: 'idle', text: '', error: null, empty: false, startedAt: null, tokens: 0, debugEvents: [] });
    activeSummaryRef.current = null;
    clearSummaryTimeout();
  }, [clearSummaryTimeout]);

  // Stop any live capture when the hook unmounts.
  useEffect(() => {
    return () => {
      for (const source of ['mic', 'display'] as AudioSource[]) {
        const handle = captureRef.current[source];
        captureRef.current[source] = null;
        if (handle) handle.stop();
      }
      clearSummaryTimeout();
    };
  }, [clearSummaryTimeout]);

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
    sessionContext,
    summary,
    startSummary,
    resetTranscripts
  };
}
