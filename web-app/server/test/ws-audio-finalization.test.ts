import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../src/ws';

test('audio finalization drains the provider before the final speaker partition', async () => {
  const order: string[] = [];
  let capturing = true;
  const relay = {
    async handleAudioControl() {
      order.push('drain-start');
      await Promise.resolve();
      order.push('drain-done');
      capturing = false;
      return { finalReceived: true, timedOut: false };
    },
    isCapturing() {
      return capturing;
    }
  };
  const trigger = {
    setCapturing(value: boolean) {
      order.push(`capturing:${value}`);
    }
  };
  const speakerLifecycle = {
    setSingleMic() {},
    async finalize() {
      order.push('partition');
    },
    reset() {}
  };

  await dispatch(
    {} as never,
    {} as never,
    relay as never,
    trigger as never,
    {} as never,
    () => {},
    () => {},
    () => {},
    () => '',
    { type: 'audio-control', action: 'stop', source: 'mic' } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    speakerLifecycle
  );

  assert.deepEqual(order, ['drain-start', 'drain-done', 'capturing:false', 'partition']);
});
