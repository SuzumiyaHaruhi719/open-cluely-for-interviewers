import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutoTrigger,
  type AutoTriggerDeps,
  type TriggerDecision,
  type TimerHandle
} from '../src/auto-trigger';

// ----------------------------------------------------------------------------
// Deterministic harness — fake clock + manual timer + stubbed monitor/analyze.
// No real waits, no network. The fake timer captures the scheduled callback so a
// test can fire it explicitly (modeling the debounce quiet period elapsing) or
// assert it was cleared (modeling coalescing). `flush()` on the trigger bypasses
// the timer for the common "evaluate now" case.
// ----------------------------------------------------------------------------

const COOLDOWN_MS = 20000;
const DEBOUNCE_MS = 1200;
const MIN_NEW_CHARS = 120;

// A candidate answer comfortably longer than MIN_NEW_CHARS so the new-chars gate
// passes from a zero baseline.
const LONG_ANSWER =
  'I rebuilt our checkout pipeline around an async queue to cut p99 latency, ' +
  'and the hardest call was giving up read-after-write consistency, which later ' +
  'caused a double-charge bug I had to personally chase down and fix.';

// A follow-on chunk comfortably longer than MIN_NEW_CHARS so that, appended after
// a fire (which sets charsAtLastGen to the prior length), the NEW-chars gate passes.
const LONG_SUFFIX =
  ' Then the next morning I traced the duplicate writes to a missing idempotency ' +
  'key, added one keyed on the order id, backfilled the affected rows, and wrote a ' +
  'regression test so the double-charge path could never silently return again.';

function yes(focusHint = 'probe the consistency tradeoff'): TriggerDecision {
  return { shouldGenerate: true, reason: 'substantive', focusHint, urgency: 'high' };
}
function no(): TriggerDecision {
  return { shouldGenerate: false, reason: 'filler', focusHint: '', urgency: 'low' };
}

interface Harness {
  nowMs: number;
  advance: (ms: number) => void;
  /** Fire the single pending debounce timer (if armed). */
  fireTimer: () => void;
  setTimerCalls: number;
  clearTimerCalls: number;
  analyzeCalls: Array<{ candidateAnswer: string; focusHint: string }>;
  monitorCalls: string[];
}

function makeTrigger(opts: {
  decision?: TriggerDecision | ((t: string) => Promise<TriggerDecision> | TriggerDecision);
  throwInMonitor?: boolean;
} = {}) {
  const h: Harness = {
    nowMs: 1_000_000,
    advance(ms) {
      this.nowMs += ms;
    },
    fireTimer() {
      const fn = pendingFn;
      if (fn) {
        pendingFn = null;
        pendingHandle += 1;
        fn();
      }
    },
    setTimerCalls: 0,
    clearTimerCalls: 0,
    analyzeCalls: [],
    monitorCalls: []
  };

  let pendingFn: (() => void) | null = null;
  let pendingHandle = 1;

  const shouldGenerate = async (recent: string): Promise<TriggerDecision> => {
    h.monitorCalls.push(recent);
    if (opts.throwInMonitor) throw new Error('monitor boom');
    const d = opts.decision ?? yes();
    return typeof d === 'function' ? d(recent) : d;
  };

  const deps: AutoTriggerDeps = {
    shouldGenerate,
    runAnalyze: async ({ candidateAnswer, focusHint }) => {
      h.analyzeCalls.push({ candidateAnswer, focusHint });
    },
    now: () => h.nowMs,
    setTimer: (fn: () => void): TimerHandle => {
      h.setTimerCalls += 1;
      pendingFn = fn;
      return pendingHandle;
    },
    clearTimer: () => {
      h.clearTimerCalls += 1;
      pendingFn = null;
    },
    config: { cooldownMs: COOLDOWN_MS, minNewChars: MIN_NEW_CHARS, debounceMs: DEBOUNCE_MS, monitorModel: 'stub' }
  };

  const trigger = createAutoTrigger(deps);
  // The mic-on gate: auto (agent + interval) only fires while capturing. ws.ts
  // calls setCapturing(true) on audio-control start; the tests below assert the
  // firing behavior, so default capturing ON here. (Tests that specifically
  // exercise the capturing gate flip it back to false themselves.)
  trigger.setCapturing(true);
  return { trigger, h };
}

test('fires once when all local gates pass and the monitor says yes', async () => {
  const { trigger, h } = makeTrigger({ decision: yes('probe the bug') });

  trigger.onCandidateFinal(LONG_ANSWER);
  // Debounce armed but not yet evaluated.
  assert.equal(h.setTimerCalls, 1);
  assert.equal(h.analyzeCalls.length, 0);

  await trigger.flush();

  assert.equal(h.monitorCalls.length, 1, 'monitor consulted once');
  assert.equal(h.analyzeCalls.length, 1, 'analyze fired once');
  assert.equal(h.analyzeCalls[0].candidateAnswer, LONG_ANSWER);
  assert.equal(h.analyzeCalls[0].focusHint, 'probe the bug');
  assert.equal(trigger.getIsGenerating(), false, 'in-flight slot released after settle');
});

test('does NOT fire during cooldown (too soon since the last fire)', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });

  // First fire establishes lastGenAt = now.
  trigger.onCandidateFinal(LONG_ANSWER);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 1);

  // Only 5s later (< 20s cooldown) with plenty of NEW text (>=120 chars appended):
  // the cooldown gate alone rejects, before the monitor is ever consulted.
  h.advance(5000);
  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 1, 'no second fire inside cooldown');
  assert.equal(h.monitorCalls.length, 1, 'monitor not consulted when local gates fail');

  // After the cooldown fully elapses, the same accumulated answer (now with its
  // 120+ new chars since the first fire) is eligible and fires again.
  h.advance(COOLDOWN_MS);
  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 2, 'fires again once cooldown elapses');
});

test('does NOT fire while a generation is already in flight', async () => {
  // A monitor that resolves yes, but we hold analyze open to keep isGenerating true.
  let releaseAnalyze: (() => void) | null = null;
  const h = {
    nowMs: 1_000_000,
    analyzeCalls: 0,
    monitorCalls: 0
  };
  let pendingFn: (() => void) | null = null;
  const trigger = createAutoTrigger({
    shouldGenerate: async () => {
      h.monitorCalls += 1;
      return yes();
    },
    runAnalyze: () =>
      new Promise<void>((resolve) => {
        h.analyzeCalls += 1;
        releaseAnalyze = resolve;
      }),
    now: () => h.nowMs,
    setTimer: (fn) => {
      pendingFn = fn;
      return 1;
    },
    clearTimer: () => {
      pendingFn = null;
    },
    config: { cooldownMs: COOLDOWN_MS, minNewChars: MIN_NEW_CHARS, debounceMs: DEBOUNCE_MS, monitorModel: 'stub' }
  });
  trigger.setCapturing(true); // mic-on gate (ws.ts sets this on audio-control start)

  trigger.onCandidateFinal(LONG_ANSWER);
  // Start the first evaluation but DON'T await — analyze stays pending.
  const first = trigger.flush();
  // Let the monitor microtask resolve so analyze is entered and isGenerating=true.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(trigger.getIsGenerating(), true, 'in flight after analyze entered');
  assert.equal(h.analyzeCalls, 1);

  // A new candidate arrives while in flight: the local gate (isGenerating) rejects
  // it before arming a debounce, so no second evaluation/monitor call.
  trigger.onCandidateFinal(LONG_ANSWER + ' more and more substantive content here to clear the new-char gate easily.');
  assert.equal(pendingFn, null, 'no debounce armed while generating');
  await trigger.flush();
  assert.equal(h.monitorCalls, 1, 'monitor not consulted for the overlapping segment');
  assert.equal(h.analyzeCalls, 1, 'no overlapping second analyze');

  // Release the first analyze and let it settle.
  (releaseAnalyze as unknown as () => void)();
  await first;
  assert.equal(trigger.getIsGenerating(), false);
});

test('does NOT fire when autoGenerate is off; turning it off cancels a pending eval', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });

  trigger.setAutoGenerate(false);
  trigger.onCandidateFinal(LONG_ANSWER);
  assert.equal(h.setTimerCalls, 0, 'no debounce armed when autoGenerate is off');
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0);
  assert.equal(h.monitorCalls.length, 0);

  // Arm a debounce, then disable: the pending evaluation must be cancelled.
  trigger.setAutoGenerate(true);
  trigger.onCandidateFinal(LONG_ANSWER);
  assert.equal(h.setTimerCalls, 1);
  trigger.setAutoGenerate(false);
  assert.ok(h.clearTimerCalls >= 1, 'disabling clears the pending debounce');
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0, 'no fire after disable');
});

test('monitor returning false → no fire', async () => {
  const { trigger, h } = makeTrigger({ decision: no() });

  trigger.onCandidateFinal(LONG_ANSWER);
  await trigger.flush();

  assert.equal(h.monitorCalls.length, 1, 'monitor was consulted');
  assert.equal(h.analyzeCalls.length, 0, 'but no analyze when it says no');
});

test('monitor throwing → no fire (swallowed)', async () => {
  const { trigger, h } = makeTrigger({ throwInMonitor: true });

  trigger.onCandidateFinal(LONG_ANSWER);
  await trigger.flush(); // must not reject

  assert.equal(h.monitorCalls.length, 1);
  assert.equal(h.analyzeCalls.length, 0, 'a throwing monitor never fires analyze');
});

test('does NOT fire while the mic is off (capturing gate)', async () => {
  // ws.ts calls setCapturing(relay.isCapturing()) on audio-control start/stop;
  // auto must stay silent whenever the mic is off, even with a substantive final
  // and a yes-saying monitor. The local gate rejects before the debounce arms, so
  // the monitor is never consulted either.
  const { trigger, h } = makeTrigger({ decision: yes() });
  trigger.setCapturing(false);

  trigger.onCandidateFinal(LONG_ANSWER);
  assert.equal(h.setTimerCalls, 0, 'no debounce armed while the mic is off');
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0, 'no fire while the mic is off');
  assert.equal(h.monitorCalls.length, 0, 'monitor not consulted while the mic is off');

  // Turning the mic back on makes the same accumulated final eligible again.
  trigger.setCapturing(true);
  trigger.onCandidateFinal(LONG_ANSWER);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 1, 'auto fires once the mic is on');
});

test('debounce coalesces rapid onCandidateFinal calls into ONE evaluation', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });

  // Three rapid finals (each long enough to pass the pre-filter). Each resets the
  // debounce: clear the prior timer, arm a new one with the LATEST text.
  trigger.onCandidateFinal(LONG_ANSWER + ' one');
  trigger.onCandidateFinal(LONG_ANSWER + ' one two');
  const latest = LONG_ANSWER + ' one two three';
  trigger.onCandidateFinal(latest);

  assert.equal(h.setTimerCalls, 3, 'each final re-arms the debounce');
  assert.equal(h.clearTimerCalls, 2, 'each re-arm clears the prior timer');

  // Quiet period elapses → the single live timer fires → one evaluation.
  h.fireTimer();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.monitorCalls.length, 1, 'coalesced into a single monitor call');
  assert.equal(h.analyzeCalls.length, 1, 'and a single analyze');
  assert.equal(h.analyzeCalls[0].candidateAnswer, latest, 'fires with the LATEST accumulated text');
});

test('ongoing speech cancels a pending question until a later candidate final closes the turn', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });

  trigger.onCandidateFinal(LONG_ANSWER);
  assert.equal(h.setTimerCalls, 1, 'candidate final arms the quiet-period timer');

  // A provider partial means somebody is still speaking. Auto must not surface a
  // question over that speech even if the prior final was already substantive.
  trigger.noteSpeechActivity();
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0, 'no question while speech continues');
  assert.ok(h.clearTimerCalls >= 1, 'speech postpones the armed quiet-period timer');
  assert.equal(h.setTimerCalls, 2, 'speech re-arms the same candidate evidence after a new quiet period');

  // Some providers do not emit another final after the last rolling chunk. Once
  // the real audio has stayed quiet for the full debounce, the postponed evidence
  // must still fire without requiring another transcript boundary.
  h.advance(DEBOUNCE_MS);
  h.fireTimer();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.analyzeCalls.length, 1, 'the postponed answer fires only after real quiet');
  assert.equal(h.analyzeCalls[0].candidateAnswer, LONG_ANSWER);
});

test('stopping capture cancels pending Auto work and invalidates an in-flight result', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });
  const epochBeforeStop = trigger.getEpoch();

  trigger.onCandidateFinal(LONG_ANSWER);
  assert.equal(h.setTimerCalls, 1);

  trigger.setCapturing(false);

  assert.ok(h.clearTimerCalls >= 1, 'mic stop cancels the pending quiet-period timer');
  assert.equal(trigger.getEpoch(), epochBeforeStop + 1, 'an Auto result started before stop becomes stale');
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0, 'nothing fires after the interview capture stops');
});

test('speech resuming during Auto generation invalidates the result before it can surface', async () => {
  let releaseAnalyze!: () => void;
  const analyzeGate = new Promise<void>((resolve) => {
    releaseAnalyze = resolve;
  });
  let pendingFn: (() => void) | null = null;
  const trigger = createAutoTrigger({
    shouldGenerate: async () => yes(),
    runAnalyze: async () => analyzeGate,
    setTimer: (fn) => {
      pendingFn = fn;
      return 1;
    },
    clearTimer: () => {
      pendingFn = null;
    },
    config: {
      cooldownMs: COOLDOWN_MS,
      minNewChars: MIN_NEW_CHARS,
      debounceMs: DEBOUNCE_MS,
      monitorModel: 'stub'
    }
  });
  trigger.setCapturing(true);
  trigger.onCandidateFinal(LONG_ANSWER);
  assert.ok(pendingFn);

  const epochAtStart = trigger.getEpoch();
  const run = trigger.flush();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(trigger.getIsGenerating(), true);

  trigger.noteSpeechActivity();
  assert.equal(trigger.getEpoch(), epochAtStart + 1, 'the caller can suppress the stale Auto frame');

  releaseAnalyze();
  await run;
});

test('an interviewer turn cancels the old answer instead of blending it into the next candidate answer', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });

  trigger.onCandidateFinal(LONG_ANSWER);
  trigger.onInterviewerFinal();
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0, 'the interviewer moving on cancels the pending follow-up');

  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  h.advance(DEBOUNCE_MS);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 1);
  assert.equal(
    h.analyzeCalls[0].candidateAnswer,
    LONG_SUFFIX.trim(),
    'the next follow-up sees only the new answer window'
  );
});

test('markManualRun blocks an immediate auto fire (shared bookkeeping)', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });

  // A manual Generate Q starts: claims the in-flight slot + resets the cooldown.
  trigger.markManualRun(LONG_ANSWER);
  assert.equal(trigger.getIsGenerating(), true);

  // An interviewee final arrives during the manual run: blocked (isGenerating).
  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  assert.equal(h.setTimerCalls, 0, 'no debounce armed during a manual run');
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0);

  // Manual run finishes — slot released, cooldown reset to now, charsAtLastGen
  // set to the manual answer's length.
  trigger.markRunDone(LONG_ANSWER);
  assert.equal(trigger.getIsGenerating(), false);

  // Immediately after, auto is still blocked by the cooldown the manual run set
  // (even though the accumulated text now has 120+ new chars over the baseline).
  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0, 'cooldown from the manual run prevents an immediate auto re-fire');

  // Once the cooldown elapses, auto may fire again.
  h.advance(COOLDOWN_MS);
  trigger.onCandidateFinal(LONG_ANSWER + LONG_SUFFIX);
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 1, 'auto resumes after the post-manual cooldown');
});

test('does NOT fire when too few new chars have accumulated since the last gen', async () => {
  const { trigger, h } = makeTrigger({ decision: yes() });

  // A short segment (< MIN_NEW_CHARS) from the zero baseline: new-chars gate fails.
  trigger.onCandidateFinal('too short');
  assert.equal(h.setTimerCalls, 0, 'pre-filter rejects a sub-threshold segment');
  await trigger.flush();
  assert.equal(h.analyzeCalls.length, 0);
  assert.equal(h.monitorCalls.length, 0);
});

test('interval mode waits for candidate speech and does not analyze interviewer-only finals', async (t) => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let tick: (() => void | Promise<void>) | null = null;

  globalThis.setInterval = ((
    fn: TimerHandler,
    _timeout?: number,
    ...args: unknown[]
  ): ReturnType<typeof setInterval> => {
    tick = typeof fn === 'function' ? () => fn(...args) : () => {};
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => undefined) as unknown as typeof clearInterval;

  t.after(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });
  const fireTick = async (): Promise<void> => {
    if (!tick) throw new Error('interval timer not armed');
    await tick();
  };

  const { trigger, h } = makeTrigger({ decision: yes() });
  trigger.setIntervalMs(5000);
  trigger.setMode('interval');

  trigger.noteFinal('Interviewer: tell me about the queue migration you owned.');
  await fireTick();
  assert.equal(h.analyzeCalls.length, 0, 'interviewer-only final must not run the follow-up pipeline');

  trigger.noteFinal(LONG_ANSWER);
  trigger.onCandidateFinal(LONG_ANSWER);
  await fireTick();

  assert.equal(h.analyzeCalls.length, 1, 'candidate final makes interval mode eligible');
  assert.equal(h.analyzeCalls[0].candidateAnswer, LONG_ANSWER);
});
