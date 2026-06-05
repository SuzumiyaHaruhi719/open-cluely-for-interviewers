// ============================================================================
// Per-connection live session-context analyzer (Phase C).
// ----------------------------------------------------------------------------
// Mirrors the auto-trigger's debounce + in-flight gate, but drives the LIGHT
// session-context call instead of the Expert pipeline. On each finalized
// transcript segment ws.ts calls schedule(); we:
//
//   1. debounce (~7s) so a burst of finals coalesces into ONE analysis (we
//      summarize at a conversational pause, not per word);
//   2. gate locally (cheap, no LLM): only while CAPTURING, and never while an
//      analysis is already in flight (in-flight-gated — skip, don't queue/overlap);
//   3. run the injected analyze fn; on a non-null result, emit it via onState.
//
// EVERYTHING is injected (analyze, emit, capturing probe, timer, model gate) so
// the debounce/gate is unit-testable with a fake timer and no network. The
// analyze fn (analyzeSessionContext) NEVER throws — but we still swallow here so
// a custom impl can't disrupt the relay either.
// ============================================================================

import type { SessionContextState } from '@open-cluely/contract';

/** Default debounce: long enough that the light call runs at a pause, not per word. */
const DEFAULT_DEBOUNCE_MS = 7000;

export type TimerHandle = unknown;

export interface SessionContextAnalyzerDeps {
  /**
   * Run one analysis over the CURRENT transcript and return the live state (or
   * null when there's nothing usable). Wired to analyzeSessionContext(buildInput(...)).
   * MUST resolve (never reject) — we swallow rejections defensively regardless.
   */
  analyze: () => Promise<SessionContextState | null>;
  /** Emit a successful state to the socket. Called only on a non-null analysis. */
  onState: (state: SessionContextState) => void;
  /** Live capture probe: analysis only runs while an audio source is capturing. */
  isCapturing: () => boolean;
  /**
   * Whether a heavier follow-up/auto generation is in flight. When true we SKIP
   * this run so the cheap context call never piggybacks on the expensive pipeline
   * (keeps the two from competing for the same model budget at the same instant).
   * Optional — defaults to "never busy".
   */
  isPipelineBusy?: () => boolean;
  /** Debounce override (ms). Defaults to ~7s. */
  debounceMs?: number;
  /** Schedule the debounce. Defaults to setTimeout; injected in tests. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  /** Cancel a pending debounce. Defaults to clearTimeout. */
  clearTimer?: (handle: TimerHandle) => void;
}

export interface SessionContextAnalyzer {
  /** A finalized transcript segment arrived — (re)arm the debounced analysis. */
  schedule: () => void;
  /** Cancel any pending debounce and stop scheduling (connection close / reset). */
  cancel: () => void;
  /**
   * TEST SEAT: synchronously run the pending analysis now, bypassing the timer.
   * Returns the run promise. No-op if nothing is pending.
   */
  flush: () => Promise<void>;
}

/**
 * Create one session-context analyzer for a single connection. State is private
 * to the instance. `analyze`, `onState`, and `isCapturing` are required; the rest
 * default to production wiring but are injectable for deterministic tests.
 */
export function createSessionContextAnalyzer(deps: SessionContextAnalyzerDeps): SessionContextAnalyzer {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle);
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const isPipelineBusy = deps.isPipelineBusy ?? (() => false);

  let timer: TimerHandle | null = null;
  // In-flight gate: only ever one context analysis at a time. A schedule() during
  // a run is dropped (not queued) — the next final after it settles re-arms.
  let inFlight = false;

  function clearPending(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /** Cheap local gates (no LLM): only while capturing, idle, and pipeline-free. */
  function gatesPass(): boolean {
    if (inFlight) return false;
    if (!deps.isCapturing()) return false;
    if (isPipelineBusy()) return false;
    return true;
  }

  async function run(): Promise<void> {
    // Re-check the gates AFTER the debounce quiet period — capture may have
    // stopped, or the heavy pipeline may have started, while we waited.
    if (!gatesPass()) return;
    inFlight = true;
    try {
      const state = await deps.analyze();
      if (state) deps.onState(state);
    } catch {
      // analyzeSessionContext never throws, but a custom impl might — never let a
      // context-analysis failure disturb the relay.
    } finally {
      inFlight = false;
    }
  }

  function schedule(): void {
    // Cheap pre-filter: don't even arm the debounce when the gates can't pass.
    // (run() re-checks, so this is purely an optimization + keeps a stopped/busy
    // connection silent.)
    if (!gatesPass()) return;
    clearPending();
    timer = setTimer(() => {
      timer = null;
      void run();
    }, debounceMs);
  }

  function cancel(): void {
    clearPending();
  }

  async function flush(): Promise<void> {
    clearPending();
    await run();
  }

  return { schedule, cancel, flush };
}
