// ============================================================================
// Autonomous question-generation trigger monitor (per WebSocket session).
// ----------------------------------------------------------------------------
// The Expert pipeline is deep but slow (~25-30s/fire). We do NOT run it on every
// interviewee sentence. Instead, a two-stage gate decides WHEN to fire:
//
//   1. Local gates (no LLM, ~free): auto-generate on; not already generating;
//      cooldown elapsed since the last fire; enough NEW transcript since then;
//      and a short debounce so rapid finals coalesce into one decision (we act on
//      a conversational pause, not on every partial sentence boundary).
//   2. Flash gate (one thinking-off LLM call): only if the local gates pass, ask
//      a fast monitor "is now a good moment to generate?" → strict JSON. Any
//      failure is treated as "no" — the monitor NEVER throws into the socket.
//
// On a green light it marks `isGenerating`, runs the SAME analyze path a manual
// Generate Q uses (injected as `runAnalyze`), and on settle records the fire so
// the cooldown + new-chars gates reset. Manual generations call `markManualRun()`
// so auto and manual share the in-flight/cooldown bookkeeping and never overlap.
//
// EVERYTHING is injected (clock, timer, monitor, analyze) so the whole decision
// is unit-testable with a fake clock and no network — see test/auto-trigger.test.ts.
// ============================================================================

import { chat } from './dashscope';
import { config as serverConfig } from './config';

/** The monitor's strict-JSON verdict. */
export interface TriggerDecision {
  shouldGenerate: boolean;
  reason: string;
  focusHint: string;
  urgency: 'low' | 'med' | 'high';
}

/** Tunables (defaults from server config; overridable per-instance in tests). */
export interface AutoTriggerConfig {
  cooldownMs: number;
  minNewChars: number;
  debounceMs: number;
  monitorModel: string;
  /** Fixed wall-clock cadence (ms) for 'interval' mode. Default 30000. */
  intervalMs: number;
}

/** A pending-timer handle abstraction so tests can drive time without real waits. */
export type TimerHandle = unknown;

export interface AutoTriggerDeps {
  /**
   * The Flash trigger gate: given the recent transcript, decide whether to fire.
   * Default impl calls the thinking-off Flash monitor. MUST resolve (never reject)
   * — the default swallows all errors into `{ shouldGenerate: false }`.
   */
  shouldGenerate?: (recentTranscript: string) => Promise<TriggerDecision>;
  /**
   * Fire the Expert pipeline. Wired in ws.ts to the SHARED analyze-and-emit path
   * (identical to manual Generate Q, only the `trigger` flag differs). Resolves
   * when the generation settles (success or handled error).
   */
  runAnalyze: (opts: { candidateAnswer: string; focusHint: string }) => Promise<void>;
  /** Clock. Defaults to Date.now; injected in tests for a deterministic cooldown. */
  now?: () => number;
  /** Schedule the debounce. Defaults to setTimeout; injected to control timing in tests. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  /** Cancel a pending debounce. Defaults to clearTimeout. */
  clearTimer?: (handle: TimerHandle) => void;
  /** Tuning overrides (default: server config). */
  config?: Partial<AutoTriggerConfig>;
}

export interface AutoTrigger {
  /** A new interviewee FINAL segment arrived; `fullCandidateText` is the accumulated final text. */
  onCandidateFinal: (fullCandidateText: string) => void;
  /** Enable/disable autonomous generation. When off, no LLM call is ever made. */
  setAutoGenerate: (enabled: boolean) => void;
  /**
   * Select the autonomous-firing mode. 'agent' = the Flash monitor gates/debounces
   * (default); 'interval' = fire on a fixed wall-clock cadence (no monitor gate),
   * independent of generation time. Switching modes restarts the interval timer as
   * needed (only running when mode==='interval' AND autoGenerate is on).
   */
  setMode: (mode: 'agent' | 'interval') => void;
  /**
   * Live-adjust the 'interval' mode cadence (ms). Clamped to a 5s floor; falls
   * back to 30000 for NaN/0. If the cadence timer is currently running it restarts
   * immediately so the new period takes effect at once (no wait for the old tick).
   */
  setIntervalMs: (ms: number) => void;
  /**
   * Record ANY finalized transcript segment (interviewer/candidate/guest) so the
   * 'interval' (every-30s) mode has the recent conversation to fire from — even
   * when no candidate has been diarized yet. Agent mode is unaffected.
   */
  noteFinal: (text: string) => void;
  /** Mic on/off gate: auto (agent AND interval) only fires while capturing is true. */
  setCapturing: (on: boolean) => void;
  /** Whether autonomous generation is currently enabled. */
  getAutoGenerate: () => boolean;
  /** Whether a generation (auto OR manual) is currently in flight. */
  getIsGenerating: () => boolean;
  /**
   * A MANUAL Generate Q started — claim the in-flight slot and reset the cooldown
   * so auto won't overlap or immediately re-fire. Pair with markRunDone().
   */
  markManualRun: (fullCandidateText?: string) => void;
  /** A generation (auto or manual) settled — clear in-flight, record the fire. */
  markRunDone: (fullCandidateText?: string) => void;
  /**
   * Abandon the current chat: clear the interval-mode accumulated transcript
   * (`latestText`), cancel any armed agent debounce/pending, reset the cooldown
   * bookkeeping (so the next chat's first segment is eligible immediately), and
   * BUMP the internal epoch. A generation that started in the old chat captured
   * the prior epoch; when it settles the epoch mismatch means the trigger does
   * NOT count it (no cooldown reset) and the caller can suppress its stale emit.
   * Called when the client creates/switches a chat (configure `resetGeneration`).
   */
  reset: () => void;
  /**
   * The current epoch. Capture it at the START of a generation; if it differs at
   * settle time a reset() happened mid-flight, so the generation is stale (its
   * result/remaining progress must be suppressed and the fire must not count).
   */
  getEpoch: () => number;
  /**
   * TEST SEAT: synchronously evaluate any pending debounced candidate now,
   * bypassing the timer. Returns the evaluation promise so tests can await the
   * full gate→monitor→fire decision deterministically. No-op if nothing pending.
   */
  flush: () => Promise<void>;
}

// --- Default Flash monitor --------------------------------------------------

// Keep the monitor prompt focused and cheap. It returns STRICT JSON and nothing
// else; we parse defensively and treat ANY deviation as "do not generate".
const MONITOR_SYSTEM = [
  'You are a real-time interview monitor. You watch the LATEST things the CANDIDATE said',
  'and decide whether THIS is a good moment for the interviewer to generate a probing',
  'follow-up question. Say yes only when the candidate has just finished a substantive,',
  'self-contained thought worth probing (a claim, a decision, a result, a tradeoff).',
  'Say no for filler, mid-sentence pauses, pleasantries, or when nothing new is worth a follow-up.',
  'Respond with STRICT JSON ONLY, no prose, no markdown:',
  '{"shouldGenerate": boolean, "reason": "<short>", "focusHint": "<what to probe, short>", "urgency": "low"|"med"|"high"}'
].join(' ');

const MONITOR_MAX_TOKENS = 200;
const MONITOR_TEMPERATURE = 0;
// Cap the transcript window we hand the monitor so its latency/cost stays flat
// regardless of interview length — only the recent tail informs "is now a moment".
const MONITOR_WINDOW_CHARS = 1200;

function clampUrgency(value: unknown): 'low' | 'med' | 'high' {
  return value === 'high' || value === 'med' || value === 'low' ? value : 'low';
}

/** Strip ```json fences and pull the first {...} object. Mirrors the orchestrator's safe parse. */
function parseDecision(text: string): TriggerDecision {
  const fallback: TriggerDecision = { shouldGenerate: false, reason: '', focusHint: '', urgency: 'low' };
  if (!text) return fallback;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
  if (!obj || typeof obj !== 'object') return fallback;
  const rec = obj as Record<string, unknown>;
  return {
    shouldGenerate: rec.shouldGenerate === true,
    reason: typeof rec.reason === 'string' ? rec.reason : '',
    focusHint: typeof rec.focusHint === 'string' ? rec.focusHint : '',
    urgency: clampUrgency(rec.urgency)
  };
}

/**
 * Default Flash trigger gate: one thinking-off monitor call over the recent
 * transcript tail. NEVER rejects — any error (no key, timeout, bad JSON) resolves
 * to `{ shouldGenerate: false }` so a monitor hiccup can never fire or throw.
 */
function makeDefaultShouldGenerate(model: string) {
  return async (recentTranscript: string): Promise<TriggerDecision> => {
    try {
      const window = recentTranscript.slice(-MONITOR_WINDOW_CHARS);
      const text = await chat({
        system: MONITOR_SYSTEM,
        messages: [{ role: 'user', content: `Recent candidate transcript:\n"""\n${window}\n"""` }],
        model,
        maxTokens: MONITOR_MAX_TOKENS,
        temperature: MONITOR_TEMPERATURE,
        thinking: false
      });
      return parseDecision(text);
    } catch {
      return { shouldGenerate: false, reason: '', focusHint: '', urgency: 'low' };
    }
  };
}

// --- Factory ----------------------------------------------------------------

/**
 * Create one trigger monitor for a single connection. State is private to the
 * instance. `runAnalyze` is required (the shared analyze-and-emit path); the rest
 * default to production wiring but are injectable for deterministic tests.
 */
export function createAutoTrigger(deps: AutoTriggerDeps): AutoTrigger {
  const cfg: AutoTriggerConfig = {
    cooldownMs: deps.config?.cooldownMs ?? serverConfig.autoCooldownMs,
    minNewChars: deps.config?.minNewChars ?? serverConfig.autoMinNewChars,
    debounceMs: deps.config?.debounceMs ?? serverConfig.autoDebounceMs,
    monitorModel: deps.config?.monitorModel ?? serverConfig.autoMonitorModel,
    intervalMs: deps.config?.intervalMs ?? 30000
  };

  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle);
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const shouldGenerate = deps.shouldGenerate ?? makeDefaultShouldGenerate(cfg.monitorModel);
  const runAnalyze = deps.runAnalyze;

  // Per-instance state.
  let autoGenerate = true;
  // Start lastGenAt one cooldown in the past so the FIRST substantive segment is
  // eligible immediately (no artificial wait at the start of a session).
  let lastGenAt = now() - cfg.cooldownMs;
  let charsAtLastGen = 0;
  let isGenerating = false;

  // Firing mode + the latest accumulated candidate text. In 'interval' mode a fixed
  // wall-clock timer drives firing from `latestText` (no monitor gate); in 'agent'
  // mode the timer is idle and the existing gate/debounce path drives everything.
  let mode: 'agent' | 'interval' = 'agent';
  let latestText = '';
  // Rolling transcript accumulated SINCE the last fire (auto OR manual). Every
  // follow-up is generated from ONLY this window — not the whole conversation —
  // so the model never re-asks about material an earlier follow-up already
  // covered. Consumed on each fire, cleared on a manual run and on reset().
  let sinceFire = '';
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  // Auto NEVER fires unless an audio source is actively capturing (the mic is On).
  // Set from ws.ts on every audio-control start/stop. Default false = nothing fires
  // until capture begins, and firing stops the moment the mic is turned off.
  let capturing = false;

  // Debounce bookkeeping: the latest accumulated text + the pending timer.
  let pendingText: string | null = null;
  let timer: TimerHandle | null = null;

  // Monotonic epoch bumped by reset() (new/switched chat). A generation captures
  // the epoch when it starts; if it changes before settle, that generation belongs
  // to the abandoned chat and must NOT count toward the cooldown (and its emit is
  // suppressed by the caller via getEpoch()).
  let epoch = 0;

  function clearPending(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    pendingText = null;
  }

  /** True iff the cheap local gates currently allow a fire for `text`. */
  function localGatesPass(text: string): boolean {
    if (!autoGenerate) return false;
    if (!capturing) return false;
    if (isGenerating) return false;
    if (now() - lastGenAt < cfg.cooldownMs) return false;
    if (text.length - charsAtLastGen < cfg.minNewChars) return false;
    return true;
  }

  /** Record a completed fire so the cooldown + new-chars gates reset. */
  function recordFire(text: string): void {
    lastGenAt = now();
    charsAtLastGen = text.length;
  }

  // Drop the just-fired window from `sinceFire`, KEEPING anything noteFinal()
  // appended while the generation was in flight (so speech during a ~25s analyze
  // isn't lost from the next window). Falls back to clearing if the buffer was
  // capped/changed underneath us.
  function consumeSinceFire(firedRaw: string): void {
    if (firedRaw && sinceFire.startsWith(firedRaw)) {
      sinceFire = sinceFire.slice(firedRaw.length).replace(/^\s+/, '');
    } else {
      sinceFire = '';
    }
  }

  /** Mic on/off gate — auto only fires while an audio source is capturing. */
  function setCapturing(on: boolean): void {
    capturing = !!on;
  }

  // --- Interval mode ---------------------------------------------------------
  // A FIXED wall-clock cadence, independent of generation time. The setInterval
  // gives the steady cadence; a tick that lands mid-generation simply SKIPS (no
  // overlap, no queue, no reschedule-on-completion). Uses the GLOBAL timer (the
  // injected setTimer/clearTimer drive the agent-mode debounce only).

  function stopInterval(): void {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  async function intervalTick(): Promise<void> {
    if (!autoGenerate || mode !== 'interval' || isGenerating || !capturing) return;
    // Fire from ONLY the transcript since the last follow-up. If nothing new was
    // said since then, skip this tick — re-running the same context would just
    // produce a duplicate follow-up.
    const firedRaw = sinceFire;
    const text = firedRaw.trim();
    if (!text) return;
    const startEpoch = epoch;
    isGenerating = true;
    try {
      await runAnalyze({ candidateAnswer: text, focusHint: '' });
    } catch {
      /* analyze failures are handled by the caller's path; never disrupt the relay */
    } finally {
      // A reset() mid-flight (new/switched chat) means this fire belongs to an
      // abandoned chat — do NOT advance the cooldown for the new chat.
      if (epoch === startEpoch) {
        recordFire(latestText);
        consumeSinceFire(firedRaw);
      }
      isGenerating = false;
    }
  }

  function startInterval(): void {
    if (intervalHandle !== null) return;
    intervalHandle = setInterval(() => {
      void intervalTick();
    }, cfg.intervalMs);
  }

  /**
   * The debounced evaluation: re-check local gates (state may have changed during
   * the quiet period), then the Flash gate, then fire. Resolves when settled. Any
   * error in the monitor/analyze is swallowed so the relay is never disrupted.
   */
  async function evaluate(text: string): Promise<void> {
    if (!localGatesPass(text)) return;
    let decision: TriggerDecision;
    try {
      decision = await shouldGenerate(text);
    } catch {
      // Belt-and-suspenders: the default impl never rejects, but a custom one might.
      return;
    }
    if (!decision.shouldGenerate) return;
    // Re-check gates AFTER the await — a manual run (or another auto) may have
    // claimed the slot while the monitor was thinking.
    if (!localGatesPass(text)) return;

    const startEpoch = epoch;
    isGenerating = true;
    // Generate from ONLY the transcript since the last follow-up (fall back to the
    // gate text if that window is somehow empty), so the follow-up targets new
    // material instead of re-probing what an earlier follow-up already covered.
    const firedRaw = sinceFire;
    const since = firedRaw.trim();
    try {
      await runAnalyze({ candidateAnswer: since || text, focusHint: decision.focusHint });
    } catch {
      /* analyze failures are handled by the caller's path; never disrupt the relay */
    } finally {
      // A reset() mid-flight (new/switched chat) means this fire belongs to an
      // abandoned chat — do NOT advance the cooldown for the new chat.
      if (epoch === startEpoch) {
        recordFire(text);
        consumeSinceFire(firedRaw);
      }
      isGenerating = false;
    }
  }

  function noteFinal(rawText: string): void {
    const s = String(rawText ?? '').trim();
    if (!s) return;
    // Accumulate the recent transcript across ALL speakers (capped) so 'interval'
    // mode can fire a follow-up even before any candidate is diarized.
    latestText = latestText ? `${latestText} ${s}` : s;
    if (latestText.length > 4000) latestText = latestText.slice(-4000);
    // Grow the since-last-fire window every follow-up is generated from.
    sinceFire = sinceFire ? `${sinceFire} ${s}` : s;
    if (sinceFire.length > 4000) sinceFire = sinceFire.slice(-4000);
  }

  function onCandidateFinal(fullCandidateText: string): void {
    const text = String(fullCandidateText ?? '');
    // 'interval' mode is timer-driven and fires from `latestText` (fed by
    // noteFinal across ALL speakers); the agent gate/debounce below stays
    // candidate-only and unchanged.
    if (mode !== 'agent') return;
    // Cheap pre-filter: if the local gates can't pass for this text, don't even
    // arm the debounce. (The post-debounce evaluate() re-checks, so this is purely
    // an optimization — it also keeps a disabled monitor completely silent.)
    if (!localGatesPass(text)) return;
    pendingText = text;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      const pending = pendingText;
      timer = null;
      pendingText = null;
      if (pending !== null) void evaluate(pending);
    }, cfg.debounceMs);
  }

  function setAutoGenerate(enabled: boolean): void {
    autoGenerate = !!enabled;
    // Turning off cancels any armed evaluation immediately (no surprise late fire).
    if (!autoGenerate) clearPending();
    // Keep the interval timer consistent with the new enabled state: stop on
    // disable; (re)start only if we're enabling AND already in interval mode.
    if (!autoGenerate) stopInterval();
    else if (mode === 'interval') startInterval();
  }

  function setMode(next: 'agent' | 'interval'): void {
    if (next === mode) return;
    mode = next;
    // Always tear down the timer first; only re-arm it for interval mode while
    // autonomous generation is on. Switching to 'agent' leaves the timer stopped
    // and hands firing back to the gate/debounce path untouched.
    stopInterval();
    if (mode === 'interval' && autoGenerate) startInterval();
  }

  function setIntervalMs(ms: number): void {
    // Clamp to a 5s floor (avoid hammering the pipeline); fall back to 30000 for
    // NaN/0 so a bad value never disables or stalls the cadence.
    const next = Math.max(5000, Math.floor(ms) || 30000);
    if (next === cfg.intervalMs) return;
    cfg.intervalMs = next;
    // If the cadence timer is live, restart it so the new period applies now
    // rather than after the current (old-period) tick fires.
    if (intervalHandle !== null) {
      stopInterval();
      startInterval();
    }
  }

  function markManualRun(fullCandidateText?: string): void {
    // Claim the in-flight slot + reset the cooldown so auto won't overlap or fire
    // right after a manual generation. Cancel any pending auto evaluation too.
    isGenerating = true;
    lastGenAt = now();
    if (typeof fullCandidateText === 'string') charsAtLastGen = fullCandidateText.length;
    // A manual Generate Q covers the recent transcript — drop the since-fire window
    // so the next AUTO follow-up doesn't re-ask what the manual one just covered.
    sinceFire = '';
    clearPending();
  }

  function markRunDone(fullCandidateText?: string): void {
    isGenerating = false;
    lastGenAt = now();
    if (typeof fullCandidateText === 'string') charsAtLastGen = fullCandidateText.length;
  }

  function reset(): void {
    // Bump the epoch FIRST so any in-flight generation (whose finally compares the
    // captured epoch) neither records a fire nor lets the caller emit its result.
    epoch += 1;
    // Drop the interval-mode accumulated transcript + the since-last-fire window
    // so the new chat starts blank.
    latestText = '';
    sinceFire = '';
    // Cancel any armed agent debounce/pending so no late fire from the old chat.
    clearPending();
    // Free the in-flight slot (the abandoned generation is suppressed) and reset
    // the cooldown one window into the past so the NEW chat's first substantive
    // segment is eligible immediately — same as a fresh session.
    isGenerating = false;
    lastGenAt = now() - cfg.cooldownMs;
    charsAtLastGen = 0;
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    const pending = pendingText;
    pendingText = null;
    if (pending !== null) await evaluate(pending);
  }

  return {
    onCandidateFinal,
    setAutoGenerate,
    setMode,
    setIntervalMs,
    noteFinal,
    setCapturing,
    getAutoGenerate: () => autoGenerate,
    getIsGenerating: () => isGenerating,
    markManualRun,
    markRunDone,
    reset,
    getEpoch: () => epoch,
    flush
  };
}
