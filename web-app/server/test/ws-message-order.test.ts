import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialMessageQueue, isBackgroundModelRequest } from '../src/ws';

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

test('a long model request releases the transport queue while it continues in the background', async () => {
  const order: string[] = [];
  let releaseSummary!: () => void;
  const summaryGate = new Promise<void>((resolve) => {
    releaseSummary = resolve;
  });
  const enqueue = createSerialMessageQueue(
    async (message: string) => {
      order.push(`start:${message}`);
      if (message === 'summary') await summaryGate;
      order.push(`done:${message}`);
    },
    { runInBackground: (message) => message === 'summary' }
  );

  await enqueue('before');
  const summary = enqueue('summary');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const audio = enqueue('audio');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const whileSummaryIsRunning = [...order];

  releaseSummary();
  await Promise.all([summary, audio]);

  assert.deepEqual(whileSummaryIsRunning, [
    'start:before',
    'done:before',
    'start:summary',
    'start:audio',
    'done:audio'
  ]);
  assert.equal(order.at(-1), 'done:summary');
});

test('only model-bound client requests run outside the ordered transport queue', () => {
  assert.equal(isBackgroundModelRequest(JSON.stringify({ type: 'summarize', requestId: 's' })), true);
  assert.equal(isBackgroundModelRequest(JSON.stringify({ type: 'analyze', requestId: 'a' })), true);
  assert.equal(isBackgroundModelRequest(JSON.stringify({ type: 'audio', seq: 1 })), false);
  assert.equal(isBackgroundModelRequest(JSON.stringify({ type: 'audio-control', action: 'stop' })), false);
  assert.equal(isBackgroundModelRequest('{invalid'), false);
});

test('background model requests remain serialized with each other', async () => {
  const order: string[] = [];
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const enqueue = createSerialMessageQueue(
    async (message: string) => {
      order.push(`start:${message}`);
      if (message === 'model-1') await firstGate;
      if (message === 'model-2') await secondGate;
      order.push(`done:${message}`);
    },
    { runInBackground: (message) => message.startsWith('model-') }
  );

  await enqueue('model-1');
  await enqueue('model-2');
  await enqueue('audio');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const whileFirstModelRuns = [...order];

  releaseFirst();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const afterFirstModel = [...order];
  releaseSecond();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(whileFirstModelRuns, [
    'start:model-1',
    'start:audio',
    'done:audio'
  ]);
  assert.deepEqual(afterFirstModel, [
    'start:model-1',
    'start:audio',
    'done:audio',
    'done:model-1',
    'start:model-2'
  ]);
  assert.equal(order.at(-1), 'done:model-2');
});
