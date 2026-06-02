import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WsLike, WsConstructor } from '../src/funasr-client';
import { createFunasrSession } from '../src/funasr-client';

class FakeWs implements WsLike {
  static OPEN = 1;
  static instances: FakeWs[] = [];
  readyState = FakeWs.OPEN;
  sent: Array<string | Buffer> = [];
  private listeners: Record<string, Array<(...a: any[]) => void>> = {};
  constructor(public url: string) { FakeWs.instances.push(this); }
  on(e: string, l: (...a: any[]) => void) { (this.listeners[e] ??= []).push(l); }
  send(d: string | Buffer) { this.sent.push(d); }
  close() { this.emit('close'); }
  emit(e: string, ...a: any[]) { for (const fn of this.listeners[e] ?? []) fn(...a); }
}
const FakeWsCtor = FakeWs as unknown as WsConstructor;

test('locked sentences emit once as finals carrying their speaker id', () => {
  FakeWs.instances = [];
  const got: Array<{ text: string; isFinal: boolean; speakerId: number | null }> = [];
  createFunasrSession({ WebSocket: FakeWsCtor, url: 'ws://x', onTranscript: (t) => got.push(t) });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ sentences: [{ text: '你好', spk: 0 }], partial: '世界', is_final: false }), false);
  ws.emit('message', JSON.stringify({ sentences: [{ text: '你好', spk: 0 }, { text: '请坐', spk: 1 }], partial: '', is_final: false }), false);
  assert.deepEqual(got, [
    { text: '世界', isFinal: false, speakerId: null },
    { text: '你好', isFinal: true, speakerId: 0 },
    { text: '请坐', isFinal: true, speakerId: 1 }
  ]);
});

test('stop sends the STOP sentinel', () => {
  FakeWs.instances = [];
  const s = createFunasrSession({ WebSocket: FakeWsCtor, url: 'ws://x', onTranscript: () => {} });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  s.stop();
  assert.ok(ws.sent.some((m) => typeof m === 'string' && m.includes('STOP')));
});
