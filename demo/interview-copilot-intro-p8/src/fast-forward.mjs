export const FAST_FORWARD_RATE = 60;

const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function advanceFastForward({
  fromTimeMs,
  startedAtMs,
  nowMs,
  durationMs,
  rate = FAST_FORWARD_RATE
}) {
  const duration = Math.max(0, finiteOr(durationMs, 0));
  const from = Math.min(duration, Math.max(0, finiteOr(fromTimeMs, 0)));
  const elapsed = Math.max(0, finiteOr(nowMs, 0) - finiteOr(startedAtMs, 0));
  const speed = Math.max(1, finiteOr(rate, FAST_FORWARD_RATE));
  const timeMs = Math.min(duration, Math.round(from + elapsed * speed));
  return Object.freeze({ timeMs, complete: timeMs >= duration });
}

export function fastForwardDurationMs({
  fromTimeMs,
  durationMs,
  rate = FAST_FORWARD_RATE
}) {
  const duration = Math.max(0, finiteOr(durationMs, 0));
  const from = Math.min(duration, Math.max(0, finiteOr(fromTimeMs, 0)));
  const speed = Math.max(1, finiteOr(rate, FAST_FORWARD_RATE));
  return Math.ceil((duration - from) / speed);
}

