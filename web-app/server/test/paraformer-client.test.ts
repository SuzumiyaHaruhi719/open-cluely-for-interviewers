import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createParaformerSession,
  downsampleInt16Buffer,
  extractSentence,
  PARAFORMER_DEFAULT_MODEL,
  type WsConstructor,
  type WsLike
} from '../src/paraformer-client';

// --- Fake `ws` WebSocket ----------------------------------------------------
// Captures everything sent and lets the test drive 'open'/'message' events to
// exercise the Paraformer protocol with zero network.

class FakeWs implements WsLike {
  static OPEN = 1;
  static instances: FakeWs[] = [];

  readyState = FakeWs.OPEN;
  url: string;
  headers?: Record<string, string>;
  sent: Array<string | Buffer> = [];
  terminated = false;
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    this.url = url;
    this.headers = options?.headers;
    FakeWs.instances.push(this);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    (this.listeners[event] ??= []).push(listener);
  }

  send(data: string | Buffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close');
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: string, ...args: any[]): void {
    for (const fn of this.listeners[event] ?? []) fn(...args);
  }
}

const FakeWsCtor = FakeWs as unknown as WsConstructor;

function jsonFrames(ws: FakeWs): any[] {
  return ws.sent
    .filter((d): d is string => typeof d === 'string')
    .map((d) => JSON.parse(d));
}

test('extractSentence pulls text + final flag from a result-generated event', () => {
  const partial = extractSentence({ payload: { output: { sentence: { text: ' hi ', sentence_end: false } } } });
  assert.deepEqual(partial, { text: 'hi', isFinal: false });

  const final = extractSentence({ payload: { output: { sentence: { text: 'done', sentence_end: true } } } });
  assert.deepEqual(final, { text: 'done', isFinal: true });

  assert.equal(extractSentence({ payload: { output: { sentence: { text: '   ' } } } }), null);
  assert.equal(extractSentence({}), null);
  assert.equal(extractSentence(null), null);
});

test('downsampleInt16Buffer halves 16k->8k by block-averaging int16 pairs', () => {
  // Four 16-bit LE samples [100, 200, 300, 400] -> two averaged [150, 350].
  const input = Buffer.alloc(8);
  input.writeInt16LE(100, 0);
  input.writeInt16LE(200, 2);
  input.writeInt16LE(300, 4);
  input.writeInt16LE(400, 6);
  const out = downsampleInt16Buffer(input, 16000, 8000);
  assert.equal(out.length, 4); // 2 samples * 2 bytes
  assert.equal(out.readInt16LE(0), 150);
  assert.equal(out.readInt16LE(2), 350);
});

test('downsampleInt16Buffer returns input unchanged when rates match', () => {
  const input = Buffer.from([1, 2, 3, 4]);
  assert.equal(downsampleInt16Buffer(input, 16000, 16000), input);
});

test('a session targeting 8k downsamples 16k frames before sending', () => {
  FakeWs.instances = [];
  const session = createParaformerSession({
    WebSocket: FakeWsCtor,
    apiKey: 'k',
    sampleRate: 8000,
    onTranscript: () => {}
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ header: { event: 'task-started' } }), false);

  // 8 bytes (4 samples) of 16k audio -> 4 bytes (2 samples) of 8k audio.
  session.sendAudio(Buffer.alloc(8, 0));
  const binary = ws.sent.filter((d): d is Buffer => Buffer.isBuffer(d));
  assert.equal(binary.length, 1);
  assert.equal(binary[0].length, 4);
});

test('session opens with Bearer auth and sends a run-task on open', () => {
  FakeWs.instances = [];
  createParaformerSession({
    WebSocket: FakeWsCtor,
    apiKey: 'sk-abc',
    onTranscript: () => {}
  });

  const ws = FakeWs.instances.at(-1)!;
  assert.equal(ws.headers?.Authorization, 'Bearer sk-abc');

  ws.emit('open');
  const frames = jsonFrames(ws);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].header.action, 'run-task');
  assert.equal(frames[0].payload.model, PARAFORMER_DEFAULT_MODEL);
  assert.equal(frames[0].payload.parameters.sample_rate, 16000);
  assert.equal(frames[0].payload.parameters.format, 'pcm');
});

test('audio is dropped until task-started, then forwarded as binary', () => {
  FakeWs.instances = [];
  const session = createParaformerSession({
    WebSocket: FakeWsCtor,
    apiKey: 'k',
    onTranscript: () => {}
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');

  // Before task-started: not ready, audio dropped (matches desktop behavior).
  assert.equal(session.isReady, false);
  session.sendAudio(Buffer.from([1, 2]));
  assert.equal(ws.sent.filter((d) => Buffer.isBuffer(d)).length, 0);

  // task-started flips ready; subsequent audio is sent as a Buffer.
  ws.emit('message', JSON.stringify({ header: { event: 'task-started' } }), false);
  assert.equal(session.isReady, true);
  session.sendAudio(Buffer.from([3, 4]));
  const binary = ws.sent.filter((d): d is Buffer => Buffer.isBuffer(d));
  assert.equal(binary.length, 1);
  assert.deepEqual(binary[0], Buffer.from([3, 4]));
});

test('result-generated events surface as onTranscript calls', () => {
  FakeWs.instances = [];
  const got: Array<{ text: string; isFinal: boolean }> = [];
  createParaformerSession({
    WebSocket: FakeWsCtor,
    apiKey: 'k',
    onTranscript: (t) => got.push(t)
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ header: { event: 'task-started' } }), false);
  ws.emit(
    'message',
    JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { text: 'hello', sentence_end: false } } } }),
    false
  );
  ws.emit(
    'message',
    JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { text: 'hello world', sentence_end: true } } } }),
    false
  );

  assert.deepEqual(got, [
    { text: 'hello', isFinal: false },
    { text: 'hello world', isFinal: true }
  ]);
});

test('stop sends a finish-task and terminates the socket', () => {
  FakeWs.instances = [];
  const session = createParaformerSession({ WebSocket: FakeWsCtor, apiKey: 'k', onTranscript: () => {} });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ header: { event: 'task-started' } }), false);

  session.stop();
  const finish = jsonFrames(ws).find((f) => f.header?.action === 'finish-task');
  assert.ok(finish, 'expected a finish-task frame');
  assert.equal(ws.terminated, true);
});

test('task-failed reports an error and stops forwarding audio', () => {
  FakeWs.instances = [];
  const errors: string[] = [];
  const session = createParaformerSession({
    WebSocket: FakeWsCtor,
    apiKey: 'k',
    onTranscript: () => {},
    onError: (m) => errors.push(m)
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ header: { event: 'task-started' } }), false);
  ws.emit(
    'message',
    JSON.stringify({ header: { event: 'task-failed', error_message: 'quota exceeded' } }),
    false
  );

  assert.deepEqual(errors, ['quota exceeded']);
  // After failure, audio is a no-op (session finished + socket torn down).
  const binaryBefore = ws.sent.filter((d) => Buffer.isBuffer(d)).length;
  session.sendAudio(Buffer.from([9]));
  assert.equal(ws.sent.filter((d) => Buffer.isBuffer(d)).length, binaryBefore);
});
