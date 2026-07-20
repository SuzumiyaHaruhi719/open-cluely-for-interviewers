import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createXfyunSession,
  extractResult,
  formatXfyunTransportError,
  type WsConstructor,
  type WsLike,
  type XfyunTranscript
} from '../src/xfyun-client';

// ============================================================================
// iFlytek (讯飞) 角色分离 fast-handoff tests.
// ----------------------------------------------------------------------------
// Under fast turn-taking iFlytek packs BOTH speakers' words into ONE `result`
// frame, tagging `rl` PER WORD. The OLD extractResult collapsed the whole frame
// to the FIRST non-"0" rl, mislabeling the second speaker as the first. The fix
// SPLITS a frame into consecutive same-speaker RUNS by per-word `rl`, emitting
// one transcript per run with its own speakerId.
// ============================================================================

// --- helpers ---------------------------------------------------------------

/** Build a `result` frame's `data` from a flat list of [word, rl] pairs. */
function frameData(words: Array<[string, string]>, type: '0' | '1'): unknown {
  return {
    cn: {
      st: {
        type,
        rt: [{ ws: words.map(([w, rl]) => ({ cw: [{ w, rl }] })) }]
      }
    }
  };
}

// --- extractResult: run-splitting on FINAL frames --------------------------

test('extractResult: a FINAL frame with rl 1,1,2,2 splits into two runs (interviewer then candidate)', () => {
  // 面试官 (rl=1) speaks two words, then 考生 (rl=2) speaks two words — all in ONE frame.
  const out = extractResult(
    frameData(
      [
        ['请', '1'],
        ['介绍', '1'],
        ['好的', '2'],
        ['我', '2']
      ],
      '0'
    ),
    0
  );
  assert.ok(out, 'expected a non-null result');
  // CORE red→green assertion: two runs, each with its OWN speaker — NOT one collapsed segment.
  assert.equal(out!.runs.length, 2);
  assert.deepEqual(out!.runs[0], { text: '请介绍', isFinal: true, speakerId: 1 });
  assert.deepEqual(out!.runs[1], { text: '好的我', isFinal: true, speakerId: 2 });
  // The LAST run's speaker is carried forward for the next frame.
  assert.equal(out!.speaker, 2);
});

test('extractResult: rapid alternation rl 1,2,1,2 yields four runs with correct per-run text+speaker', () => {
  const out = extractResult(
    frameData(
      [
        ['A', '1'],
        ['B', '2'],
        ['C', '1'],
        ['D', '2']
      ],
      '0'
    ),
    0
  );
  assert.ok(out);
  assert.equal(out!.runs.length, 4);
  assert.deepEqual(
    out!.runs.map((r) => [r.text, r.speakerId]),
    [
      ['A', 1],
      ['B', 2],
      ['C', 1],
      ['D', 2]
    ]
  );
  assert.ok(out!.runs.every((r) => r.isFinal === true));
  assert.equal(out!.speaker, 2);
});

test('extractResult: leading rl="0" words attach to the carried prevSpeaker (continuation, not dropped)', () => {
  // prevSpeaker = 1 (last frame ended on the interviewer). The first words are rl="0"
  // (continue) and MUST be attributed to speaker 1, then rl=2 starts a new candidate run.
  const out = extractResult(
    frameData(
      [
        ['继续', '0'],
        ['说', '0'],
        ['换人', '2']
      ],
      '0'
    ),
    1
  );
  assert.ok(out);
  assert.equal(out!.runs.length, 2);
  assert.deepEqual(out!.runs[0], { text: '继续说', isFinal: true, speakerId: 1 });
  assert.deepEqual(out!.runs[1], { text: '换人', isFinal: true, speakerId: 2 });
  assert.equal(out!.speaker, 2);
});

test('extractResult: leading rl="0" with no prior speaker falls back to 0', () => {
  const out = extractResult(frameData([['开场', '0'], ['白', '0']], '0'), null);
  assert.ok(out);
  assert.equal(out!.runs.length, 1);
  assert.deepEqual(out!.runs[0], { text: '开场白', isFinal: true, speakerId: 0 });
  assert.equal(out!.speaker, 0);
});

test('extractResult: a frame all one speaker (rl 1,1,1) is a single run (no regression)', () => {
  const out = extractResult(
    frameData(
      [
        ['一', '1'],
        ['段', '1'],
        ['话', '1']
      ],
      '0'
    ),
    0
  );
  assert.ok(out);
  assert.equal(out!.runs.length, 1);
  assert.deepEqual(out!.runs[0], { text: '一段话', isFinal: true, speakerId: 1 });
  assert.equal(out!.speaker, 1);
});

test('extractResult: rl="0" between same-speaker words continues the same run (no spurious split)', () => {
  // 1, then 0 (continue 1), then 0 (continue 1) → ONE run for speaker 1.
  const out = extractResult(
    frameData(
      [
        ['你', '1'],
        ['好', '0'],
        ['吗', '0']
      ],
      '0'
    ),
    0
  );
  assert.ok(out);
  assert.equal(out!.runs.length, 1);
  assert.deepEqual(out!.runs[0], { text: '你好吗', isFinal: true, speakerId: 1 });
});

test('extractResult: missing/non-numeric rl is treated as a continuation, not a new speaker', () => {
  const data = {
    cn: {
      st: {
        type: '0',
        rt: [
          {
            ws: [
              { cw: [{ w: '甲', rl: '1' }] },
              { cw: [{ w: '乙' }] }, // missing rl → continue speaker 1
              { cw: [{ w: '丙', rl: 'x' }] } // non-numeric → continue speaker 1
            ]
          }
        ]
      }
    }
  };
  const out = extractResult(data, 0);
  assert.ok(out);
  assert.equal(out!.runs.length, 1);
  assert.deepEqual(out!.runs[0], { text: '甲乙丙', isFinal: true, speakerId: 1 });
});

// --- extractResult: partial frames keep their old behavior -----------------

test('extractResult: a PARTIAL frame (type="1") emits ONE run with no speakerId', () => {
  const out = extractResult(
    frameData(
      [
        ['半', '1'],
        ['句', '2']
      ],
      '1'
    ),
    0
  );
  assert.ok(out);
  // Partials are transient: one concatenated run, speakerId null (unchanged behavior).
  assert.equal(out!.runs.length, 1);
  assert.deepEqual(out!.runs[0], { text: '半句', isFinal: false, speakerId: null });
});

test('extractResult: an empty / wordless frame returns null', () => {
  assert.equal(extractResult({ cn: { st: { type: '0', rt: [] } } }, 0), null);
  assert.equal(extractResult({}, 0), null);
  assert.equal(extractResult(null, 0), null);
});

test('formats the provider 35022 quota response hidden inside Node rawPacket', () => {
  const error = Object.assign(new Error('Parse Error: Invalid response status'), {
    code: 'HPE_INVALID_STATUS',
    rawPacket: Buffer.from(
      'HTTP/1.1 35022 Unknown Status (35022)\r\nerror: usedQuantity exceeds the limit\r\ncontent-length: 0\r\n\r\n'
    )
  });

  assert.equal(
    formatXfyunTransportError(error),
    '讯飞实时转写额度已用尽（35022），请在讯飞控制台续费或补充可用额度'
  );
});

// --- createXfyunSession: emits one onTranscript PER run --------------------

class FakeWs implements WsLike {
  static OPEN = 1;
  static instances: FakeWs[] = [];

  readyState = FakeWs.OPEN;
  url: string;
  sent: Array<string | Buffer> = [];
  terminated = false;
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(url: string) {
    this.url = url;
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

function resultFrame(words: Array<[string, string]>, type: '0' | '1'): string {
  return JSON.stringify({
    msg_type: 'result',
    res_type: 'asr',
    data: frameData(words, type)
  });
}

function startedSession(onTranscript: (t: XfyunTranscript) => void) {
  FakeWs.instances = [];
  const session = createXfyunSession({
    WebSocket: FakeWsCtor,
    appId: 'app',
    apiKey: 'key',
    apiSecret: 'secret',
    wsUrl: 'wss://example.test/',
    onTranscript
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ msg_type: 'action', data: { action: 'started' } }));
  return { session, ws };
}

test('createXfyunSession: stop waits for the last result and preserves its native speaker id', async () => {
  const got: XfyunTranscript[] = [];
  FakeWs.instances = [];
  const session = createXfyunSession({
    WebSocket: FakeWsCtor,
    appId: 'app',
    apiKey: 'key',
    apiSecret: 'secret',
    wsUrl: 'wss://example.test/',
    stopTimeoutMs: 50,
    onTranscript: (transcript) => got.push(transcript)
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ msg_type: 'action', data: { action: 'started' } }));

  const stopping = session.stop();
  assert.deepEqual(JSON.parse(String(ws.sent.at(-1))), { end: true });
  assert.equal(ws.terminated, false, 'the socket must remain open for the final result frame');

  ws.emit(
    'message',
    JSON.stringify({
      msg_type: 'result',
      res_type: 'asr',
      data: { ...(frameData([['最后一句', '3']], '0') as object), ls: true }
    })
  );

  assert.deepEqual(await stopping, { finalReceived: true, timedOut: false });
  assert.deepEqual(got, [{ text: '最后一句', isFinal: true, speakerId: 3 }]);
});

test('createXfyunSession: stop terminates after a bounded timeout without a last result', async () => {
  FakeWs.instances = [];
  const session = createXfyunSession({
    WebSocket: FakeWsCtor,
    appId: 'app',
    apiKey: 'key',
    apiSecret: 'secret',
    wsUrl: 'wss://example.test/',
    stopTimeoutMs: 5,
    onTranscript: () => {}
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');
  ws.emit('message', JSON.stringify({ msg_type: 'action', data: { action: 'started' } }));

  const result = await session.stop();

  assert.equal(result.finalReceived, false);
  assert.equal(result.timedOut, true);
  assert.match(result.reason ?? '', /timeout/i);
  assert.equal(ws.terminated, true);
});

test('createXfyunSession: a multi-speaker FINAL frame emits one onTranscript per run', () => {
  const got: XfyunTranscript[] = [];
  const { ws } = startedSession((t) => got.push(t));

  ws.emit(
    'message',
    resultFrame(
      [
        ['请', '1'],
        ['说', '1'],
        ['好', '2'],
        ['的', '2']
      ],
      '0'
    )
  );

  assert.equal(got.length, 2);
  assert.deepEqual(got[0], { text: '请说', isFinal: true, speakerId: 1 });
  assert.deepEqual(got[1], { text: '好的', isFinal: true, speakerId: 2 });
});

test('createXfyunSession: prevSpeaker carries across frames (a frame starting rl="0" inherits the last frame’s last speaker)', () => {
  const got: XfyunTranscript[] = [];
  const { ws } = startedSession((t) => got.push(t));

  // Frame 1 ends on speaker 2.
  ws.emit('message', resultFrame([['甲', '1'], ['乙', '2']], '0'));
  // Frame 2 starts with rl="0" → must continue speaker 2, then switch to speaker 1.
  ws.emit('message', resultFrame([['继续', '0'], ['再', '1']], '0'));

  assert.equal(got.length, 4);
  assert.deepEqual(got[0], { text: '甲', isFinal: true, speakerId: 1 });
  assert.deepEqual(got[1], { text: '乙', isFinal: true, speakerId: 2 });
  assert.deepEqual(got[2], { text: '继续', isFinal: true, speakerId: 2 }); // inherited
  assert.deepEqual(got[3], { text: '再', isFinal: true, speakerId: 1 });
});

test('createXfyunSession: a single-speaker final emits exactly one onTranscript (no regression)', () => {
  const got: XfyunTranscript[] = [];
  const { ws } = startedSession((t) => got.push(t));
  ws.emit('message', resultFrame([['一', '1'], ['句', '1']], '0'));
  assert.equal(got.length, 1);
  assert.deepEqual(got[0], { text: '一句', isFinal: true, speakerId: 1 });
});

test('createXfyunSession: partials still emit with no speakerId', () => {
  const got: XfyunTranscript[] = [];
  const { ws } = startedSession((t) => got.push(t));
  ws.emit('message', resultFrame([['半', '1'], ['句', '2']], '1'));
  assert.equal(got.length, 1);
  assert.deepEqual(got[0], { text: '半句', isFinal: false, speakerId: null });
});
