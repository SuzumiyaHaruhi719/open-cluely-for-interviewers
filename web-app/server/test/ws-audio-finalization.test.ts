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
    },
    getProvider() {
      return 'xfyun';
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
    {
      readyState: 1,
      OPEN: 1,
      send(raw: string) {
        const message = JSON.parse(raw);
        if (message.type === 'asr-status') order.push(`status:${message.state}`);
      }
    } as never,
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

  assert.deepEqual(order, [
    'status:finalizing',
    'drain-start',
    'drain-done',
    'capturing:false',
    'partition',
    'status:stopped'
  ]);
});

test('audio finalization reports partial only after final speaker correction on provider timeout', async () => {
  const order: string[] = [];
  const relay = {
    async handleAudioControl() {
      order.push('drain');
      return { finalReceived: false, timedOut: true, reason: 'final frame timeout' };
    },
    isCapturing() {
      return false;
    },
    getProvider() {
      return 'volc';
    }
  };
  const ws = {
    readyState: 1,
    OPEN: 1,
    send(raw: string) {
      const message = JSON.parse(raw);
      if (message.type === 'asr-status') order.push(`status:${message.state}`);
    }
  };

  await dispatch(
    ws as never,
    {} as never,
    relay as never,
    { setCapturing() {} } as never,
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
    {
      setSingleMic() {},
      async finalize() {
        order.push('partition');
      },
      reset() {}
    }
  );

  assert.deepEqual(order, ['status:finalizing', 'drain', 'partition', 'status:partial']);
});
