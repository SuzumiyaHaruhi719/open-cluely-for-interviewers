import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialMessageQueue } from '../src/ws';

test('serial message queue lets a provider stop finish before the next control message starts', async () => {
  const order: string[] = [];
  let releaseStop!: () => void;
  const stopGate = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  const enqueue = createSerialMessageQueue(async (message: string) => {
    order.push(`start:${message}`);
    if (message === 'stop') await stopGate;
    order.push(`done:${message}`);
  });

  const stopping = enqueue('stop');
  const configuring = enqueue('configure');
  await Promise.resolve();
  assert.deepEqual(order, ['start:stop']);

  releaseStop();
  await Promise.all([stopping, configuring]);
  assert.deepEqual(order, [
    'start:stop',
    'done:stop',
    'start:configure',
    'done:configure'
  ]);
});

test('one rejected message does not poison later messages on the same connection', async () => {
  const handled: string[] = [];
  const enqueue = createSerialMessageQueue(async (message: string) => {
    handled.push(message);
    if (message === 'bad') throw new Error('bad frame');
  });

  await assert.rejects(enqueue('bad'), /bad frame/);
  await enqueue('good');
  assert.deepEqual(handled, ['bad', 'good']);
});
