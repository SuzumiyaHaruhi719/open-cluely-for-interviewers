import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerCap, XFYUN_MAX_SPEAKERS } from '../src/speaker-cap';

test('XFYUN_MAX_SPEAKERS is 2', () => {
  assert.equal(XFYUN_MAX_SPEAKERS, 2);
});

test('the first two distinct ids take slots 0 and 1 in order of appearance', () => {
  const cap = createSpeakerCap();
  assert.equal(cap.map(1), 0);
  assert.equal(cap.map(2), 1);
  // Stable: the same raw id always returns the same slot.
  assert.equal(cap.map(1), 0);
  assert.equal(cap.map(2), 1);
});

test('a 3rd/4th distinct id folds onto an in-cap slot — never exceeds 2 distinct', () => {
  const cap = createSpeakerCap();
  const out = [1, 2, 3, 4].map((id) => cap.map(id));
  // ids 1,2 → 0,1; 3,4 fold onto the most-recently-active in-cap slot (1).
  assert.deepEqual(out, [0, 1, 1, 1]);
  // At most two distinct slots ever surface.
  assert.equal(new Set(out).size, 2);
});

test('over-segmented stream 0,1,2,3 (iFlytek) collapses to ≤ 2 distinct speakers', () => {
  const cap = createSpeakerCap();
  const stream = [0, 1, 0, 2, 1, 3, 2, 0];
  const slots = stream.map((id) => cap.map(id));
  assert.ok(new Set(slots).size <= 2, `expected ≤2 distinct, got ${new Set(slots).size}`);
});

test('folding is stable: an overflow id keeps returning the same slot on repeat', () => {
  const cap = createSpeakerCap();
  cap.map(10); // slot 0
  cap.map(20); // slot 1
  const first = cap.map(30); // overflow → folds to a slot
  const again = cap.map(30); // same overflow id repeats
  assert.equal(first, again);
});

test('the fold targets the most-recently-active in-cap slot at overflow time', () => {
  const cap = createSpeakerCap();
  cap.map(1); // slot 0, active = 0
  cap.map(2); // slot 1, active = 1
  cap.map(1); // re-activate slot 0 → active = 0
  // Now a brand-new (overflow) id should fold onto slot 0 (the active one).
  assert.equal(cap.map(9), 0);
});

test('reset clears the mapping so a new interview starts fresh', () => {
  const cap = createSpeakerCap();
  cap.map(5); // slot 0
  cap.map(6); // slot 1
  cap.reset();
  // After reset, the first id seen takes slot 0 again (even a different id).
  assert.equal(cap.map(99), 0);
});

test('a single-speaker stream stays on slot 0', () => {
  const cap = createSpeakerCap();
  assert.equal(cap.map(7), 0);
  assert.equal(cap.map(7), 0);
  assert.equal(cap.map(7), 0);
});
