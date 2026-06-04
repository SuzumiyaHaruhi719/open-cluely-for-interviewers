// ============================================================================
// Simulation ('sim') ASR session — a fake recognizer for the mic-less test harness.
// ----------------------------------------------------------------------------
// REUSE NOTE: this mirrors xfyun-client.ts / volc-client.ts's exported shape
// (a session with sendAudio/stop/isReady + onTranscript/onReady/onError deps) so
// it drops into the SAME asr-relay slot. UNLIKE the real clients it IGNORES all
// audio; instead it REPLAYS a scripted two-speaker transcript on a wall-clock
// timer, so the rest of the pipeline (auto-trigger / 30s-interval / multi-speaker
// role mapping) runs end-to-end WITHOUT a microphone.
//
// Like xfyun (角色分离), ONE "cloud call" returns BOTH the text AND the speaker id,
// so the relay uses the PLAIN text-session path for 'sim' and forwards the
// speakerId this session emits on finals — skipping the local CAM++ diarizer.
//
// REPLAY MODEL (per scripted turn, spaced ~2500 ms apart):
//   1. emit a couple of PARTIALS — { text:<growing prefix>, isFinal:false } with
//      NO speakerId (mirrors how real providers withhold the speaker until final).
//   2. emit the FINAL — { text:<full turn text>, isFinal:true, speakerId:<turn> }.
// The script LOOPS forever (turn index wraps) so a single chat keeps producing
// transcript for a long run — long enough for the 30 s interval / cooldown gates
// to fire repeatedly. onReady() fires immediately (no upstream handshake).
//
// EVERYTHING timer-related is injected (setTimer/clearTimer) so unit tests can
// drive the replay deterministically with a fake clock, exactly like auto-trigger.
// ============================================================================

/** One scripted utterance: which speaker said it, and what they said. */
export interface SimScriptTurn {
  /** Diarized speaker id stamped on this turn's FINAL (e.g. 0 = interviewer, 1 = candidate). */
  speakerId: number;
  /** The full text of the utterance (emitted as the final; partials are prefixes of it). */
  text: string;
}

/** A recognized segment (partial or final) — text + (on finals) the speaker id. */
export interface SimTranscript {
  text: string;
  isFinal: boolean;
  /** Speaker id for this turn. Present on finals; null/omitted on partials. */
  speakerId?: number | null;
}

/** A pending-timer handle abstraction so tests can drive time without real waits. */
export type SimTimerHandle = unknown;

export interface SimSessionDeps {
  /** The two-speaker transcript to replay, oldest turn first. Looped forever. */
  script: ReadonlyArray<SimScriptTurn>;
  /** Called for every partial/final transcript this session produces. */
  onTranscript: (t: SimTranscript) => void;
  /** Called once, immediately, since the sim session is "ready" with no handshake. */
  onReady?: () => void;
  /** Called on a terminal error (only when the script is empty/invalid). */
  onError?: (message: string) => void;
  /**
   * Wall-clock spacing between consecutive turns (ms). Default 2500 — slow enough
   * that auto-trigger's debounce/cooldown and the 30 s interval mode get a
   * realtime-ish cadence to react to. Lower it in tests for speed.
   */
  turnSpacingMs?: number;
  /** Schedule a timer. Defaults to setTimeout; injected to control timing in tests. */
  setTimer?: (fn: () => void, ms: number) => SimTimerHandle;
  /** Cancel a pending timer. Defaults to clearTimeout. */
  clearTimer?: (handle: SimTimerHandle) => void;
}

/** A single simulated recognition session. Mirrors AsrSession (sendAudio/stop/isReady). */
export interface SimSession {
  /** Audio is IGNORED — the sim replays its script regardless of incoming PCM. */
  sendAudio(pcm: Buffer): void;
  /** Stop the replay and cancel the pending timer. Idempotent. */
  stop(): void;
  /** Always true once created (no upstream handshake to wait on). */
  readonly isReady: boolean;
}

export const SIM_DEFAULT_TURN_SPACING_MS = 2500;
// A couple of partials per turn, emitted as a quick ramp before the final so the
// browser sees the live "typing" effect that a real provider produces.
const PARTIAL_FRACTIONS = [0.4, 0.75] as const;
const PARTIAL_STEP_MS = 350;

/**
 * Open a simulated ASR session. Replays `script` turn-by-turn on a timer: a
 * couple of partials then a final (carrying the turn's speakerId), spacing turns
 * `turnSpacingMs` apart and looping the script forever. NEVER throws to the
 * caller — an empty/invalid script routes through onError and yields an inert
 * session. Audio frames are dropped (the whole point of the sim).
 */
export function createSimSession(deps: SimSessionDeps): SimSession {
  const { script, onTranscript, onReady, onError } = deps;
  const turnSpacingMs = deps.turnSpacingMs ?? SIM_DEFAULT_TURN_SPACING_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as SimTimerHandle);
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let stopped = false;
  let timer: SimTimerHandle | null = null;
  let turnIndex = 0;

  // Guard: an empty script can't replay anything. Report it and go inert so the
  // harness still gets a clean "no transcript" signal instead of a silent hang.
  const turns = Array.isArray(script) ? script.filter((t) => t && typeof t.text === 'string' && t.text.length > 0) : [];
  if (turns.length === 0) {
    try {
      onError?.('sim script is empty');
    } finally {
      onReady?.();
    }
    return inertSession();
  }

  function schedule(fn: () => void, ms: number): void {
    if (stopped) return;
    timer = setTimer(fn, ms);
  }

  /** Emit a turn's partials (NO speaker), then its final (WITH speaker), then queue the next turn. */
  function playTurn(): void {
    if (stopped) return;
    const turn = turns[turnIndex % turns.length];
    turnIndex += 1;

    // Build the partial prefixes from character fractions of the full text. Empty
    // prefixes are skipped (e.g. very short turns) so we never emit a blank partial.
    const partials = PARTIAL_FRACTIONS.map((frac) => turn.text.slice(0, Math.max(1, Math.floor(turn.text.length * frac))));

    let step = 0;
    const emitNextPartial = (): void => {
      if (stopped) return;
      if (step < partials.length) {
        const text = partials[step];
        step += 1;
        if (text) onTranscript({ text, isFinal: false });
        schedule(emitNextPartial, PARTIAL_STEP_MS);
        return;
      }
      // All partials emitted — emit the FINAL carrying this turn's speakerId.
      if (!stopped) onTranscript({ text: turn.text, isFinal: true, speakerId: turn.speakerId });
      // Queue the next turn after the inter-turn gap (loops via the modulo above).
      schedule(playTurn, turnSpacingMs);
    };
    emitNextPartial();
  }

  // "Ready" immediately — no upstream handshake — then start the replay after one
  // spacing tick so the first transcript doesn't race the configure/start round-trip.
  try {
    onReady?.();
  } catch {
    /* a ready-callback throw must not break the sim */
  }
  schedule(playTurn, turnSpacingMs);

  function sendAudio(_pcm: Buffer): void {
    /* IGNORED — the sim replays its script regardless of incoming audio. */
  }

  function stop(): void {
    stopped = true;
    if (timer !== null) {
      try {
        clearTimer(timer);
      } catch {
        /* ignore */
      }
      timer = null;
    }
  }

  return {
    sendAudio,
    stop,
    get isReady() {
      // Ready as long as we haven't been stopped (a stopped session is no longer
      // capturing — keeps relay.isCapturing() honest after a stop).
      return !stopped;
    }
  };
}

/** A session that does nothing — returned when the script was empty/invalid. */
function inertSession(): SimSession {
  return {
    sendAudio() {
      /* no-op */
    },
    stop() {
      /* no-op */
    },
    get isReady() {
      return false;
    }
  };
}
