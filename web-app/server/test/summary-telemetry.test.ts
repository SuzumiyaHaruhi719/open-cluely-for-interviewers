import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSummaryTelemetry,
  type SummaryTelemetryEvent
} from '../src/summary-telemetry';

// ----------------------------------------------------------------------------
// The summary telemetry recorder timestamps the summary lifecycle so the flow is
// observable: requested → input-built → model-call-start → model-call-end |
// timeout | fallback → done | error. It is a SELF-CONTAINED ring buffer with an
// injectable clock (so tests are deterministic) and a snapshot() getter. It must
// never throw into the summary path.
// ----------------------------------------------------------------------------

/** A monotonic fake clock so timestamps are deterministic + assertable. */
function fakeClock(start = 1000): { now: () => number; tick: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    }
  };
}

test('records lifecycle events in order with timestamps from the injected clock', () => {
  const clock = fakeClock(1000);
  const tel = createSummaryTelemetry({ now: clock.now });

  tel.record('requested', { requestId: 'r1' });
  clock.tick(5);
  tel.record('input-built', { requestId: 'r1', inputChars: 1234 });
  clock.tick(10);
  tel.record('model-call-start', { requestId: 'r1', model: 'deepseek-v4-pro' });
  clock.tick(900);
  tel.record('model-call-end', { requestId: 'r1', model: 'deepseek-v4-pro' });
  clock.tick(2);
  tel.record('done', { requestId: 'r1' });

  const events = tel.snapshot();
  assert.equal(events.length, 5);
  assert.deepEqual(
    events.map((e: SummaryTelemetryEvent) => e.type),
    ['requested', 'input-built', 'model-call-start', 'model-call-end', 'done']
  );
  // Timestamps come straight from the injected clock (monotonic).
  assert.deepEqual(
    events.map((e: SummaryTelemetryEvent) => e.at),
    [1000, 1005, 1015, 1915, 1917]
  );
  // Detail fields are preserved.
  assert.equal(events[1].inputChars, 1234);
  assert.equal(events[2].model, 'deepseek-v4-pro');
  assert.equal(events[0].requestId, 'r1');
});

test('snapshot() returns a defensive copy — mutating it does not affect the buffer', () => {
  const tel = createSummaryTelemetry({ now: () => 0 });
  tel.record('requested', { requestId: 'r1' });
  const snap = tel.snapshot();
  snap.push({ type: 'done', at: 0, requestId: 'x' });
  snap[0].requestId = 'mutated';
  // The recorder's own buffer is untouched.
  const fresh = tel.snapshot();
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].requestId, 'r1');
});

test('ring buffer caps retained events at capacity (oldest dropped)', () => {
  let t = 0;
  const tel = createSummaryTelemetry({ now: () => t++, capacity: 3 });
  tel.record('requested', { requestId: 'a' });
  tel.record('input-built', { requestId: 'b' });
  tel.record('model-call-start', { requestId: 'c' });
  tel.record('model-call-end', { requestId: 'd' });
  tel.record('done', { requestId: 'e' });

  const events = tel.snapshot();
  // Only the most recent `capacity` events are retained.
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => e.requestId),
    ['c', 'd', 'e']
  );
});

test('records the failure events (timeout / fallback / error)', () => {
  let t = 0;
  const tel = createSummaryTelemetry({ now: () => t++ });
  tel.record('requested', { requestId: 'r1' });
  tel.record('model-call-start', { requestId: 'r1', model: 'pro' });
  tel.record('fallback', { requestId: 'r1', model: 'flash', reason: 'model rejected' });
  tel.record('timeout', { requestId: 'r1' });
  tel.record('error', { requestId: 'r1', error: 'boom' });

  const events = tel.snapshot();
  assert.deepEqual(
    events.map((e) => e.type),
    ['requested', 'model-call-start', 'fallback', 'timeout', 'error']
  );
  const fallback = events.find((e) => e.type === 'fallback');
  assert.equal(fallback?.reason, 'model rejected');
  assert.equal(fallback?.model, 'flash');
  const err = events.find((e) => e.type === 'error');
  assert.equal(err?.error, 'boom');
});

test('defaults to a real clock when none is injected (timestamps are numbers)', () => {
  const tel = createSummaryTelemetry();
  tel.record('requested', { requestId: 'r1' });
  const events = tel.snapshot();
  assert.equal(events.length, 1);
  assert.equal(typeof events[0].at, 'number');
  assert.ok(events[0].at > 0);
});

test('record() never throws even on an unknown detail shape', () => {
  const tel = createSummaryTelemetry({ now: () => 0 });
  assert.doesNotThrow(() => tel.record('requested'));
  assert.doesNotThrow(() => tel.record('done', {}));
  assert.equal(tel.snapshot().length, 2);
});

test('clear() empties the buffer', () => {
  const tel = createSummaryTelemetry({ now: () => 0 });
  tel.record('requested', { requestId: 'r1' });
  tel.record('done', { requestId: 'r1' });
  assert.equal(tel.snapshot().length, 2);
  tel.clear();
  assert.equal(tel.snapshot().length, 0);
});
