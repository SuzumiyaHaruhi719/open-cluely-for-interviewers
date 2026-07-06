// ============================================================================
// Summary telemetry event-log
// ----------------------------------------------------------------------------
// A tiny, SELF-CONTAINED recorder that timestamps the interview-summary
// lifecycle so the (otherwise opaque, 30–60s) flow is observable:
//
//   requested → input-built → model-call-start → model-call-end
//                                              ↘ timeout | fallback
//                                                         ↘ done | error
//
// Backed by a bounded ring buffer (so a long-lived connection can't grow it
// without limit) with an injectable clock for deterministic tests. Recording is
// best-effort and NEVER throws into the summary path — instrumentation must not
// be able to break the feature it observes. No external deps.
// ============================================================================

/** The summary lifecycle phases this recorder timestamps. */
export type SummaryTelemetryType =
  | 'requested'
  | 'input-built'
  | 'model-call-start'
  | 'model-call-end'
  | 'stream-event'
  | 'timeout'
  | 'fallback'
  | 'done'
  | 'error';

/** One timestamped lifecycle event plus optional, phase-specific detail. */
export interface SummaryTelemetryEvent {
  /** The lifecycle phase. */
  readonly type: SummaryTelemetryType;
  /** Epoch ms (from the injected clock) when the event was recorded. */
  readonly at: number;
  /** Correlates events of one summary run. */
  requestId?: string;
  /** The model id involved (model-call-start/end, fallback). */
  model?: string;
  /** Component that emitted this event, used when forwarding to the browser. */
  source?: 'server' | 'dashscope';
  /** Fine-grained stage for stream-event entries. */
  stage?: string;
  /** HTTP status / SSE event type / size counters. */
  status?: number;
  eventType?: string;
  /** Built summary-input length (input-built) — handy for spotting truncation. */
  inputChars?: number;
  chunkChars?: number;
  accumulatedChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs?: number;
  /** Why a fallback/timeout/error happened (short string). */
  reason?: string;
  /** The error message (error). */
  error?: string;
}

/** Optional detail recorded alongside an event (everything beyond `type`/`at`). */
export type SummaryTelemetryDetail = Omit<SummaryTelemetryEvent, 'type' | 'at'>;

/** The injectable recorder handed (optionally) into the summary path. */
export interface SummaryTelemetry {
  /** Append one lifecycle event. Best-effort; never throws. */
  record(type: SummaryTelemetryType, detail?: SummaryTelemetryDetail): void;
  /** A defensive copy of the retained events, oldest first. */
  snapshot(): SummaryTelemetryEvent[];
  /** Drop all retained events. */
  clear(): void;
}

export interface SummaryTelemetryOptions {
  /** Clock for timestamps; defaults to `Date.now`. Injected in tests. */
  readonly now?: () => number;
  /** Max events retained before the oldest is dropped. Defaults to 200. */
  readonly capacity?: number;
  /** Optional sink called for every event (e.g. process console logging). */
  readonly onEvent?: (event: SummaryTelemetryEvent) => void;
}

const DEFAULT_CAPACITY = 200;

/**
 * Create one summary-telemetry recorder. State is private to the instance, so a
 * per-connection recorder never leaks another connection's events.
 */
export function createSummaryTelemetry(options: SummaryTelemetryOptions = {}): SummaryTelemetry {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  // Clamp capacity to a sane minimum so a misconfigured 0/negative can't make the
  // buffer drop everything immediately.
  const capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY));
  const events: SummaryTelemetryEvent[] = [];

  return {
    record(type: SummaryTelemetryType, detail: SummaryTelemetryDetail = {}): void {
      try {
        // Spread the detail first so an unexpected key is dropped by the typed
        // shape rather than overriding `type`/`at`.
        const event: SummaryTelemetryEvent = { ...detail, type, at: now() };
        events.push(event);
        if (events.length > capacity) {
          // Ring behaviour: drop the oldest to stay within capacity.
          events.splice(0, events.length - capacity);
        }
        onEvent?.({ ...event });
      } catch {
        /* instrumentation must never break the summary path — swallow. */
      }
    },
    snapshot(): SummaryTelemetryEvent[] {
      // Shallow-clone each event so a caller mutating the snapshot can't corrupt
      // the recorder's own buffer.
      return events.map((e) => ({ ...e }));
    },
    clear(): void {
      events.length = 0;
    }
  };
}
