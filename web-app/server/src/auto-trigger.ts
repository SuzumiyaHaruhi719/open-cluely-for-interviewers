// ============================================================================
// Autonomous question-generation trigger monitor (per WebSocket session).
// ----------------------------------------------------------------------------
// We do not generate on every interviewee sentence. A single-call live path
// admits complete candidate thoughts locally, then ws.ts runs one Expert Flash
// call that selects the evidence gap and renders the question together:
//
//   1. Local gates (no LLM, ~free): auto-generate on; not already generating;
//      cooldown elapsed since the last fire; enough NEW transcript since then;
//      and a short debounce so rapid finals coalesce into one decision (we act on
//      a conversational pause, not on every partial sentence boundary).
//   2. Local completeness/filler check: no network call and no second-model
//      latency. The Expert generator owns the semantic `should_ask` decision.
//
// On a green light it marks `isGenerating`, runs the injected low-latency auto
// question path, and on settle records the fire so the cooldown + new-chars gates
// reset. Manual generations call `markManualRun()`
// so auto and manual share the in-flight/cooldown bookkeeping and never overlap.
//
// EVERYTHING is injected (clock, timer, monitor, analyze) so the whole decision
// is unit-testable with a fake clock and no network — see test/auto-trigger.test.ts.
// ============================================================================

import { config as serverConfig } from './config';
import type { AutoMonitorStatus, TokenUsage } from '@open-cluely/contract';

/** The monitor's strict-JSON verdict. */
export interface TriggerDecision {
  shouldGenerate: boolean;
  reason: string;
  focusHint: string;
  urgency: 'low' | 'med' | 'high';
  /** Provider-reported sentinel usage, included in the final visible total. */
  tokensUsed?: TokenUsage;
}

/** Tunables (defaults from server config; overridable per-instance in tests). */
export interface AutoTriggerConfig {
  cooldownMs: number;
  minNewChars: number;
  debounceMs: number;
  /** Deprecated compatibility field; admission no longer calls a model. */
  monitorModel: string;
  /** Fixed wall-clock cadence (ms) for 'interval' mode. Default 30000. */
  intervalMs: number;
}

/** A pending-timer handle abstraction so tests can drive time without real waits. */
export type TimerHandle = unknown;

export interface AutoTriggerDeps {
  /**
   * Admission decision: given the recent transcript, decide whether to fire.
   * Production uses a deterministic completeness/filler check; injection remains
   * for focused trigger-policy tests.
   */
  shouldGenerate?: (recentTranscript: string) => Promise<TriggerDecision>;
  /**
   * Fire the shared realtime Expert Flash path. Manual Generate Q uses the same
   * path unless Customize mode is explicitly selected.
   */
  runAnalyze: (opts: {
    candidateAnswer: string;
    focusHint: string;
    anchorSeq?: number;
    monitorTokensUsed?: TokenUsage;
  }) => Promise<void>;
  /** Immediately terminate the visible autonomous attempt when speech/Stop/reset invalidates it. */
  onAutoInvalidated?: () => void;
  /** Credential-free lifecycle for the existing GLP Auto pill. */
  onMonitorState?: (state: {
    status: AutoMonitorStatus;
    model: string;
    elapsedMs?: number;
  }) => void;
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
  onCandidateFinal: (fullCandidateText: string, anchorSeq?: number) => void;
  /** Any live ASR activity (partial or final) postpones a pending question. */
  noteSpeechActivity: () => void;
  /** The interviewer started/finished a new turn, so the prior answer window is stale. */
  onInterviewerFinal: () => void;
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
   * Record ANY finalized transcript segment for bookkeeping. This does NOT feed
   * generation content; interval/agent generation both use candidate-only text
   * recorded by `onCandidateFinal`.
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

// --- Default local admission gate ------------------------------------------

// Gap detection and question rendering now happen together inside the single
// Expert Flash call. Keeping a separate LLM monitor doubled latency and could
// consume the entire SLO before generation even started. This local gate only
// rejects obvious filler; the Expert call makes the semantic should_ask decision.
const FILLER_ONLY = /^(?:好(?:的)?|谢谢(?:老师)?|嗯+|啊+|这个|怎么说|没有了|ok|okay)[，,。.啊嗯呢吧\s]*$/i;
const INCOMPLETE_ENDING = /(?:因为|由于|所以|然后|但是|不过|如果|只要|比如|例如|包括|以及|并且|而且|同时|接下来|首先|其次|最后|让|把|被|对|和|与|或|because|then|but|if|for example|and|or)[，,、。.!！?？:：;；\s]*$/i;
const TERMINAL_PUNCTUATION = /[。！？!?][”’"'）)\]]*$/;
const CLOSED_ASR_ENDING = /(?:完成|结束|解决|改善|降低|提升|缩短|减少|增加|达成|落地|闭环|复盘|验证|确认|成功|失败|稳定|安全|质量|效率|成本|结果|反馈|分钟|小时|天|月|年|completed|finished|resolved|improved|reduced|increased|minutes?|seconds?|hours?|days?)$/i;
const CONCRETE_ACTIONS = /(?:负责|主导|亲自|核对|检查|组织|协调|决定|选择|分析|制定|实施|调整|验证|复检|提交|跟进|统计|巡查|维修|培训|沟通|解决|处理|复盘|排查|推动|安排|发现|built|implemented|designed|led|owned|migrated|measured|validated|launched|resolved|debugged|tested|decided|coordinated)/gi;
const OUTCOME_SIGNAL = /(?:结果|最终|从[^，。；]{1,24}到|提升|降低|缩短|减少|增加|完成|达成|改善|避免|成功|失败|\d+(?:\.\d+)?\s*(?:[%％]|分钟|小时|天|月|年|秒|万元|元)?|result|outcome|reduced|increased|improved|completed|failed|\d+(?:\.\d+)?\s*(?:%|minutes?|seconds?|hours?|days?))/i;
const SPECIFIC_DETAIL = /(?:记录|时间|金额|比例|人员|客户|租户|设备|系统|流程|预算|成本|风险|质量|指标|数据|故障|消防|巡检|工单|投诉|项目|团队|方案|响应|现场|排班|材料|水管|演练|latency|revenue|customer|system|incident|metric|budget|risk|project|team)/i;

function hasEnoughEvidence(text: string): boolean {
  const clauses = text
    .split(/[，,。！？!?；;：:]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6);
  if (clauses.length < 2) return false;

  const distinctActions = new Set(
    (text.match(CONCRETE_ACTIONS) ?? []).map((match) => match.toLowerCase())
  );
  if (distinctActions.size >= 2) return true;
  return distinctActions.size >= 1 && OUTCOME_SIGNAL.test(text) && SPECIFIC_DETAIL.test(text);
}

export function decideLocalTrigger(recentTranscript: string): TriggerDecision {
  const text = String(recentTranscript ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 24 || FILLER_ONLY.test(text)) {
    return { shouldGenerate: false, reason: '内容过短或仅为语气词', focusHint: '', urgency: 'low' };
  }
  if (
    INCOMPLETE_ENDING.test(text) ||
    (!TERMINAL_PUNCTUATION.test(text) && !CLOSED_ASR_ENDING.test(text))
  ) {
    return { shouldGenerate: false, reason: '回答疑似未结束，等待更多信息', focusHint: '', urgency: 'low' };
  }
  if (!hasEnoughEvidence(text)) {
    return { shouldGenerate: false, reason: '尚未形成足够的具体行动或结果证据', focusHint: '', urgency: 'low' };
  }
  return {
    shouldGenerate: true,
    reason: '已形成完整且有具体证据的候选人回答',
    focusHint: '优先找出责任边界、关键决策或可验证结果中信息增益最高的证据缺口',
    urgency: 'med'
  };
}

function makeDefaultShouldGenerate() {
  return async (recentTranscript: string): Promise<TriggerDecision> =>
    decideLocalTrigger(recentTranscript);
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
  const shouldGenerate = deps.shouldGenerate ?? makeDefaultShouldGenerate();
  const runAnalyze = deps.runAnalyze;
  const onAutoInvalidated = deps.onAutoInvalidated ?? (() => undefined);
  const onMonitorState = deps.onMonitorState ?? (() => undefined);

  function emitMonitorState(status: AutoMonitorStatus, startedAt?: number): void {
    try {
      onMonitorState({
        status,
        model: cfg.monitorModel,
        ...(typeof startedAt === 'number'
          ? { elapsedMs: Math.max(0, now() - startedAt) }
          : {})
      });
    } catch {
      /* UI observability must never interrupt audio or generation */
    }
  }

  // Per-instance state.
  let autoGenerate = true;
  // Start lastGenAt one cooldown in the past so the FIRST substantive segment is
  // eligible immediately (no artificial wait at the start of a session).
  let lastGenAt = now() - cfg.cooldownMs;
  let charsAtLastGen = 0;
  let isGenerating = false;
  let activeAuto = false;

  // Firing mode + recent transcript bookkeeping. `latestText` is the full recent
  // transcript across all speakers; generation content is candidate-only and
  // lives in `sinceFire`, fed from onCandidateFinal().
  let mode: 'agent' | 'interval' = 'agent';
  let latestText = '';
  let latestCandidateText = '';
  let lastCandidateFullText = '';
  let latestCandidateAnchor: number | undefined;
  let candidateRevision = 0;
  // Rolling CANDIDATE transcript accumulated SINCE the last fire (auto OR manual).
  // Every follow-up is generated from ONLY this candidate window — not interviewer
  // prompts and not the whole conversation — so the model never probes the
  // interviewer's question as if it were the candidate's answer.
  let sinceFire = '';
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let lastSpeechAt = Number.NEGATIVE_INFINITY;
  // Auto NEVER fires unless an audio source is actively capturing (the mic is On).
  // Set from ws.ts on every audio-control start/stop. Default false = nothing fires
  // until capture begins, and firing stops the moment the mic is turned off.
  let capturing = false;

  // Debounce bookkeeping: the latest accumulated text + the pending timer.
  let pendingText: string | null = null;
  let pendingAnchor: number | undefined;
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
    pendingAnchor = undefined;
  }

  function runPendingAfterDebounce(): void {
    timer = null;
    if (pendingText === null) return;
    const pending = pendingText;
    const anchorSeq = pendingAnchor;
    pendingText = null;
    pendingAnchor = undefined;
    void evaluate(pending, anchorSeq);
  }

  function armPendingAfterDebounce(): void {
    if (pendingText === null) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(runPendingAfterDebounce, cfg.debounceMs);
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
    const next = !!on;
    const ended = capturing && !next;
    capturing = next;
    emitMonitorState(
      capturing && autoGenerate && mode === 'agent' ? 'waiting' : 'idle'
    );
    if (!ended) return;
    // Stop is a hard product boundary: no pending or already-running autonomous
    // suggestion may surface after the interviewer ends capture. Bumping the
    // epoch lets ws.ts suppress a Flash result that was already in flight.
    clearPending();
    if (activeAuto) onAutoInvalidated();
    epoch += 1;
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
    if (now() - lastSpeechAt < cfg.debounceMs) return;
    // Fire from ONLY the transcript since the last follow-up. If nothing new was
    // said by the candidate since then, skip this tick — generating from the
    // interviewer's prompt would produce generic/meta follow-ups.
    const firedRaw = sinceFire;
    const text = firedRaw.trim();
    if (!text) return;
    const startEpoch = epoch;
    isGenerating = true;
    try {
      await runAnalyze({
        candidateAnswer: text,
        focusHint: '',
        ...(typeof latestCandidateAnchor === 'number'
          ? { anchorSeq: latestCandidateAnchor }
          : {})
      });
    } catch {
      /* analyze failures are handled by the caller's path; never disrupt the relay */
    } finally {
      // A reset() mid-flight (new/switched chat) means this fire belongs to an
      // abandoned chat — do NOT advance the cooldown for the new chat.
      if (epoch === startEpoch) {
        recordFire(latestCandidateText || latestText);
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
  async function evaluate(text: string, anchorSeq?: number): Promise<void> {
    if (!localGatesPass(text)) return;

    const startEpoch = epoch;
    const startRevision = candidateRevision;
    const firedRaw = sinceFire;
    const candidateWindow = firedRaw.trim() || text.trim();
    let delegated = false;
    isGenerating = true;
    activeAuto = true;
    const monitorStartedAt = now();
    emitMonitorState('evaluating');

    try {
      let decision: TriggerDecision;
      try {
        decision = await shouldGenerate(candidateWindow);
      } catch {
        emitMonitorState('waiting', monitorStartedAt);
        return;
      }
      // Only semantic boundaries may stale a chain. Raw PCM/partials deliberately
      // do not change the epoch, so tightly paced speech cannot starve Auto.
      if (epoch !== startEpoch || !autoGenerate || !capturing) return;
      if (!decision.shouldGenerate) {
        emitMonitorState('waiting', monitorStartedAt);
        return;
      }

      delegated = true;
      emitMonitorState('delegating', monitorStartedAt);
      await runAnalyze({
        candidateAnswer: candidateWindow,
        focusHint: decision.focusHint,
        ...(typeof anchorSeq === 'number' ? { anchorSeq } : {}),
        ...(decision.tokensUsed ? { monitorTokensUsed: decision.tokensUsed } : {})
      });
    } catch {
      /* monitor/analyze failures are fail-closed and never disrupt the relay */
    } finally {
      if (delegated && epoch === startEpoch) {
        recordFire(text);
        consumeSinceFire(firedRaw);
      }
      activeAuto = false;
      isGenerating = false;
      if (delegated) {
        emitMonitorState(
          autoGenerate && capturing && mode === 'agent' ? 'waiting' : 'idle',
          monitorStartedAt
        );
      } else if (epoch !== startEpoch || !autoGenerate || !capturing) {
        emitMonitorState(autoGenerate && capturing && mode === 'agent' ? 'waiting' : 'idle');
      }

      // A newer candidate final may have arrived while the sentinel was waiting.
      // Keep it queued and evaluate it once this chain releases the single slot.
      if (
        (!delegated || epoch !== startEpoch) &&
        candidateRevision > startRevision &&
        pendingText !== null &&
        localGatesPass(pendingText)
      ) {
        armPendingAfterDebounce();
      }
    }
  }

  function noteFinal(rawText: string): void {
    const s = String(rawText ?? '').trim();
    if (!s) return;
    // Accumulate the recent transcript across ALL speakers for bookkeeping only.
    // It intentionally does NOT feed sinceFire: generation must be candidate-only.
    latestText = latestText ? `${latestText} ${s}` : s;
    if (latestText.length > 4000) latestText = latestText.slice(-4000);
  }

  function noteSpeechActivity(): void {
    lastSpeechAt = now();
    // Raw PCM and rolling partials are acoustic activity, not a role-confirmed
    // conversational boundary. They never postpone or invalidate the semantic
    // candidate checkpoint used by agent mode. Interval mode still reads this
    // timestamp to avoid firing blindly in the middle of audible speech.
  }

  function onInterviewerFinal(): void {
    lastSpeechAt = now();
    clearPending();
    // A confirmed interviewer turn is the semantic cancellation boundary. It
    // invalidates the old autonomous chain while raw audio never does.
    if (activeAuto) onAutoInvalidated();
    epoch += 1;
    emitMonitorState(autoGenerate && capturing && mode === 'agent' ? 'waiting' : 'idle');
    // Once the interviewer has moved on, a follow-up for the previous answer is
    // stale. Preserve the accumulated full-text baseline so the next candidate
    // delta contains only the new answer rather than blending two questions.
    sinceFire = '';
    charsAtLastGen = latestCandidateText.length;
  }

  function rememberCandidateFinal(fullCandidateText: string, anchorSeq?: number): void {
    const text = String(fullCandidateText ?? '').trim();
    if (!text) return;
    latestCandidateText = text;
    if (typeof anchorSeq === 'number') latestCandidateAnchor = anchorSeq;

    let delta = text;
    if (lastCandidateFullText && text.startsWith(lastCandidateFullText)) {
      delta = text.slice(lastCandidateFullText.length).trim();
    } else if (text === lastCandidateFullText) {
      delta = '';
    }
    lastCandidateFullText = text;

    if (!delta) return;
    candidateRevision += 1;
    sinceFire = sinceFire ? `${sinceFire} ${delta}` : delta;
    if (sinceFire.length > 4000) sinceFire = sinceFire.slice(-4000);
  }

  function onCandidateFinal(fullCandidateText: string, anchorSeq?: number): void {
    const text = String(fullCandidateText ?? '');
    rememberCandidateFinal(text, anchorSeq);
    // 'interval' mode is timer-driven and fires from the candidate-only
    // `sinceFire` window; the agent gate/debounce below stays unchanged.
    if (mode !== 'agent') return;
    // Cheap pre-filter: if the local gates can't pass for this text, don't even
    // arm the debounce. (The post-debounce evaluate() re-checks, so this is purely
    // an optimization — it also keeps a disabled monitor completely silent.)
    // Always retain the newest semantic checkpoint, even while the sentinel or
    // Expert owns the single in-flight slot. The chain's finally block re-arms it
    // after a `wait` so evidence arriving mid-monitor is not lost.
    pendingText = text;
    pendingAnchor = anchorSeq;
    if (!localGatesPass(text)) return;
    armPendingAfterDebounce();
  }

  function setAutoGenerate(enabled: boolean): void {
    autoGenerate = !!enabled;
    // Turning off cancels any armed evaluation immediately (no surprise late fire).
    if (!autoGenerate) clearPending();
    // Keep the interval timer consistent with the new enabled state: stop on
    // disable; (re)start only if we're enabling AND already in interval mode.
    if (!autoGenerate) stopInterval();
    else if (mode === 'interval') startInterval();
    emitMonitorState(autoGenerate && capturing && mode === 'agent' ? 'waiting' : 'idle');
  }

  function setMode(next: 'agent' | 'interval'): void {
    if (next === mode) return;
    mode = next;
    // Always tear down the timer first; only re-arm it for interval mode while
    // autonomous generation is on. Switching to 'agent' leaves the timer stopped
    // and hands firing back to the gate/debounce path untouched.
    stopInterval();
    if (mode === 'interval' && autoGenerate) startInterval();
    emitMonitorState(autoGenerate && capturing && mode === 'agent' ? 'waiting' : 'idle');
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
    activeAuto = false;
    lastGenAt = now();
    if (typeof fullCandidateText === 'string') {
      const text = fullCandidateText.trim();
      charsAtLastGen = fullCandidateText.length;
      latestCandidateText = text;
      lastCandidateFullText = text;
    }
    // A manual Generate Q covers the recent transcript — drop the since-fire window
    // so the next AUTO follow-up doesn't re-ask what the manual one just covered.
    sinceFire = '';
    lastSpeechAt = Number.NEGATIVE_INFINITY;
    clearPending();
  }

  function markRunDone(fullCandidateText?: string): void {
    isGenerating = false;
    activeAuto = false;
    lastGenAt = now();
    if (typeof fullCandidateText === 'string') {
      const text = fullCandidateText.trim();
      charsAtLastGen = fullCandidateText.length;
      latestCandidateText = text;
      lastCandidateFullText = text;
    }
  }

  function reset(): void {
    // Bump the epoch FIRST so any in-flight generation (whose finally compares the
    // captured epoch) neither records a fire nor lets the caller emit its result.
    if (activeAuto) onAutoInvalidated();
    epoch += 1;
    // Drop the interval-mode accumulated transcript + the since-last-fire window
    // so the new chat starts blank.
    latestText = '';
    latestCandidateText = '';
    lastCandidateFullText = '';
    latestCandidateAnchor = undefined;
    candidateRevision = 0;
    sinceFire = '';
    lastSpeechAt = Number.NEGATIVE_INFINITY;
    // Cancel any armed agent debounce/pending so no late fire from the old chat.
    clearPending();
    // Free the in-flight slot (the abandoned generation is suppressed) and reset
    // the cooldown one window into the past so the NEW chat's first substantive
    // segment is eligible immediately — same as a fresh session.
    isGenerating = false;
    activeAuto = false;
    lastGenAt = now() - cfg.cooldownMs;
    charsAtLastGen = 0;
    emitMonitorState(autoGenerate && capturing && mode === 'agent' ? 'waiting' : 'idle');
  }

  async function flush(): Promise<void> {
    // The test seat bypasses the semantic debounce. Raw acoustic activity does
    // not gate agent evaluation.
    if (timer !== null) clearTimer(timer);
    timer = null;
    const pending = pendingText;
    const anchorSeq = pendingAnchor;
    pendingText = null;
    pendingAnchor = undefined;
    if (pending !== null) await evaluate(pending, anchorSeq);
  }

  return {
    onCandidateFinal,
    noteSpeechActivity,
    onInterviewerFinal,
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
