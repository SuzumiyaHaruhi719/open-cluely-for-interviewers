import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QwenTtsInputError,
  QwenTtsUnavailableError,
  synthesizeQwenTts,
  type TtsWsConstructor,
  type TtsWsLike
} from '../src/qwen-tts';

class FakeWs implements TtsWsLike {
  static instances: FakeWs[] = [];
  readonly readyState = 1;
  readonly sent: Array<string | Buffer> = [];
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  terminated = 0;

  constructor(
    readonly url: string,
    readonly options?: { headers?: Record<string, string> }
  ) {
    FakeWs.instances.push(this);
  }

  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: any[]) => void): void {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  send(data: string | Buffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.terminated += 1;
  }

  terminate(): void {
    this.terminated += 1;
  }
}

const FakeWsCtor = FakeWs as unknown as TtsWsConstructor;

function jsonFrames(ws: FakeWs): any[] {
  return ws.sent.filter((frame): frame is string => typeof frame === 'string').map((frame) => JSON.parse(frame));
}

test('Qwen TTS sends the DashScope SpeechSynthesizer flow and assembles MP3 audio', async () => {
  FakeWs.instances = [];
  let now = 100;
  const promise = synthesizeQwenTts(
    {
      text: '请具体说明您在这个项目中的个人决策。',
      model: 'qwen-audio-3.0-tts-plus',
      voice: 'longanlingxi'
    },
    {
      WebSocket: FakeWsCtor,
      apiKey: 'sk-private',
      url: 'wss://workspace.example/api-ws/v1/inference',
      timeoutMs: 1_000,
      now: () => now
    }
  );

  const ws = FakeWs.instances[0];
  assert.equal(ws.options?.headers?.Authorization, 'Bearer sk-private');
  ws.emit('open');
  const run = jsonFrames(ws)[0];
  assert.equal(run.header.action, 'run-task');
  assert.equal(run.payload.model, 'qwen-audio-3.0-tts-plus');
  assert.equal(run.payload.function, 'SpeechSynthesizer');
  assert.equal(run.payload.parameters.voice, 'longanlingxi');
  assert.equal(run.payload.parameters.format, 'mp3');

  ws.emit('message', JSON.stringify({ header: { event: 'task-started' } }), false);
  assert.deepEqual(jsonFrames(ws).map((frame) => frame.header.action), [
    'run-task',
    'continue-task',
    'finish-task'
  ]);
  assert.equal(jsonFrames(ws)[1].payload.input.text, '请具体说明您在这个项目中的个人决策。');

  ws.emit('message', Buffer.from([0x49, 0x44, 0x33, 0x04]), true);
  now = 475;
  ws.emit('message', JSON.stringify({ header: { event: 'task-finished' } }), false);

  const result = await promise;
  assert.deepEqual(result.audio, Buffer.from([0x49, 0x44, 0x33, 0x04]));
  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(result.model, 'qwen-audio-3.0-tts-plus');
  assert.equal(result.elapsedMs, 375);
  assert.equal(ws.terminated, 1);
});

test('Qwen TTS validates model, text, and voice before opening a socket', async () => {
  FakeWs.instances = [];
  const base = {
    WebSocket: FakeWsCtor,
    apiKey: 'sk-private',
    url: 'wss://workspace.example/api-ws/v1/inference',
    timeoutMs: 1_000
  };

  await assert.rejects(
    synthesizeQwenTts({ text: '', model: 'qwen-audio-3.0-tts-plus', voice: 'longanlingxi' }, base),
    QwenTtsInputError
  );
  await assert.rejects(
    synthesizeQwenTts({ text: '测试', model: 'not-qwen' as never, voice: 'longanlingxi' }, base),
    QwenTtsInputError
  );
  await assert.rejects(
    synthesizeQwenTts({ text: '测试', model: 'qwen-audio-3.0-tts-plus', voice: '' }, base),
    QwenTtsInputError
  );
  assert.equal(FakeWs.instances.length, 0);
});

test('Qwen TTS surfaces provider denial and terminates exactly once', async () => {
  FakeWs.instances = [];
  const promise = synthesizeQwenTts(
    { text: '测试', model: 'qwen-audio-3.0-tts-flash', voice: 'longanlingxi' },
    {
      WebSocket: FakeWsCtor,
      apiKey: 'sk-private',
      url: 'wss://workspace.example/api-ws/v1/inference',
      timeoutMs: 1_000
    }
  );
  const ws = FakeWs.instances[0];
  ws.emit('open');
  ws.emit(
    'message',
    JSON.stringify({ header: { event: 'task-failed', error_code: 'Model.AccessDenied', error_message: 'denied' } }),
    false
  );
  await assert.rejects(promise, QwenTtsUnavailableError);
  assert.equal(ws.terminated, 1);
});

test('Qwen TTS timeout closes the socket exactly once', async () => {
  FakeWs.instances = [];
  const promise = synthesizeQwenTts(
    { text: '测试', model: 'qwen-audio-3.0-tts-plus', voice: 'longanlingxi' },
    {
      WebSocket: FakeWsCtor,
      apiKey: 'sk-private',
      url: 'wss://workspace.example/api-ws/v1/inference',
      timeoutMs: 5
    }
  );
  const ws = FakeWs.instances[0];
  await assert.rejects(promise, /语音合成超时/);
  assert.equal(ws.terminated, 1);
});
