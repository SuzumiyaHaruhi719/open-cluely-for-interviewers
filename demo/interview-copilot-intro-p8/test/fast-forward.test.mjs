import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAST_FORWARD_RATE,
  advanceFastForward,
  fastForwardDurationMs
} from '../src/fast-forward.mjs';

test('fast-forward advances the authoritative replay clock at exactly 60×', () => {
  assert.equal(FAST_FORWARD_RATE, 60);
  const state = advanceFastForward({
    fromTimeMs: 100_000,
    startedAtMs: 5_000,
    nowMs: 6_500,
    durationMs: 493_517
  });
  assert.equal(state.timeMs, 190_000);
  assert.equal(state.complete, false);
});

test('fast-forward clamps to the exact end and reports completion', () => {
  const state = advanceFastForward({
    fromTimeMs: 480_000,
    startedAtMs: 10,
    nowMs: 1_000,
    durationMs: 493_517
  });
  assert.equal(state.timeMs, 493_517);
  assert.equal(state.complete, true);
});

test('a full 493-second replay reaches its end in under 8.3 presentation seconds', () => {
  assert.equal(fastForwardDurationMs({ fromTimeMs: 0, durationMs: 493_517 }), 8_226);
  assert.equal(fastForwardDurationMs({ fromTimeMs: 400_000, durationMs: 493_517 }), 1_559);
});

test('invalid and reversed clock values never move the replay backward', () => {
  const state = advanceFastForward({
    fromTimeMs: 250_000,
    startedAtMs: 2_000,
    nowMs: 1_000,
    durationMs: 493_517
  });
  assert.equal(state.timeMs, 250_000);
  assert.equal(state.complete, false);
});

