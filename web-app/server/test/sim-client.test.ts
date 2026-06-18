import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimSession, type SimTranscript } from '../src/sim-client';

interface TestTimer {
  fn: () => void;
  cancelled: boolean;
}

function makeTimers() {
  const timers: TestTimer[] = [];
  return {
    timers,
    setTimer(fn: () => void) {
      const handle = { fn, cancelled: false };
      timers.push(handle);
      return handle;
    },
    clearTimer(handle: unknown) {
      (handle as TestTimer).cancelled = true;
    },
    runNext() {
      while (timers.length > 0) {
        const handle = timers.shift()!;
        if (!handle.cancelled) {
          handle.fn();
          return true;
        }
      }
      return false;
    }
  };
}

test('sim session emits partials without speakerId and finals with the scripted speakerId', () => {
  const timer = makeTimers();
  const transcripts: SimTranscript[] = [];
  let ready = 0;

  createSimSession({
    script: [{ speakerId: 1, text: '候选人：我负责把队列迁到幂等写入' }],
    onTranscript: (t) => transcripts.push(t),
    onReady: () => {
      ready += 1;
    },
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    turnSpacingMs: 10
  });

  assert.equal(ready, 1);
  assert.equal(transcripts.length, 0);

  assert.equal(timer.runNext(), true, 'first turn starts after the spacing timer');
  assert.equal(timer.runNext(), true, 'second partial timer fires');
  assert.equal(timer.runNext(), true, 'final timer fires');

  assert.equal(transcripts.length, 3);
  assert.equal(transcripts[0].isFinal, false);
  assert.equal(transcripts[0].speakerId, undefined);
  assert.equal(transcripts[1].isFinal, false);
  assert.equal(transcripts[1].speakerId, undefined);
  assert.deepEqual(transcripts[2], {
    text: '候选人：我负责把队列迁到幂等写入',
    isFinal: true,
    speakerId: 1
  });
});

test('sim session stop cancels the pending replay timer', () => {
  const timer = makeTimers();
  const transcripts: SimTranscript[] = [];

  const session = createSimSession({
    script: [{ speakerId: 0, text: '面试官：继续说' }],
    onTranscript: (t) => transcripts.push(t),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    turnSpacingMs: 10
  });

  session.stop();
  assert.equal(session.isReady, false);
  assert.equal(timer.runNext(), false);
  assert.equal(transcripts.length, 0);
});
