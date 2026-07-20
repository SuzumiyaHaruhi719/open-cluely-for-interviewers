import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  buildFrame,
  parseFrame,
  buildConfigPayload,
  extractTranscripts,
  createVolcSession,
  formatDoubaoAsr2Error,
  VOLC_DEFAULT_MODEL,
  VOLC_DEFAULT_RESOURCE_ID,
  type WsConstructor,
  type WsLike
} from '../src/volc-client';
import { createAsrRelay, type TranscriptEmit, type AsrSession } from '../src/asr-relay';
import type { ParaformerSessionDeps } from '../src/paraformer-client';
import type { VolcSessionDeps } from '../src/volc-client';

// Frame protocol message-type / flag / (de)serialization constants. Mirrors the
// desktop test in test/volcengine-frame.test.js so the web port stays in lock-step.
const MSG_FULL_CLIENT = 0x1;
const MSG_AUDIO_ONLY = 0x2;
const MSG_FULL_SERVER = 0x9;
const FLAG_POS_SEQ = 0x1;
const FLAG_LAST_SEQ = 0x3;
const SER_JSON = 0x1;
const SER_RAW = 0x0;
const COMP_GZIP = 0x1;

// --- Frame build/parse round-trip (mirrors test/volcengine-frame.test.js) ---

test('config frame round-trips (gzip JSON, full-client-shaped header)', () => {
  const json = JSON.stringify({ user: { uid: 'x' }, audio: { rate: 16000 } });
  const frame = buildFrame({
    messageType: MSG_FULL_CLIENT,
    flags: FLAG_POS_SEQ,
    serialization: SER_JSON,
    compression: COMP_GZIP,
    sequence: 1,
    payload: zlib.gzipSync(Buffer.from(json))
  });
  // Header byte 0 = version<<4 | headerSize.
  assert.equal(frame[0], (0x1 << 4) | 0x1);
  // messageType<<4 | flags.
  assert.equal((frame[1] >> 4) & 0xf, MSG_FULL_CLIENT);
  assert.equal(frame[1] & 0xf, FLAG_POS_SEQ);

  const parsed = parseFrame(frame);
  assert.ok(parsed);
  assert.equal(parsed.messageType, MSG_FULL_CLIENT);
  assert.deepEqual(JSON.parse(parsed.payload.toString('utf8')), JSON.parse(json));
});

test('audio frame with sequence parses and un-gzips payload', () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  const frame = buildFrame({
    messageType: MSG_AUDIO_ONLY,
    flags: FLAG_POS_SEQ,
    serialization: SER_RAW,
    compression: COMP_GZIP,
    sequence: 7,
    payload: zlib.gzipSync(pcm)
  });
  const parsed = parseFrame(frame);
  assert.ok(parsed);
  assert.equal(parsed.messageType, MSG_AUDIO_ONLY);
  assert.deepEqual(parsed.payload, pcm);
});

test('buildConfigPayload encodes a gzip JSON config carrying the model + rate', () => {
  const payload = buildConfigPayload('bigmodel', 16000);
  const config = JSON.parse(zlib.gunzipSync(payload).toString('utf8'));
  assert.equal(config.request.model_name, 'bigmodel');
  assert.equal(config.request.enable_speaker_info, true);
  assert.equal(config.request.ssd_version, '200');
  assert.equal(config.request.enable_nonstream, undefined);
  assert.equal(config.audio.rate, 16000);
  assert.equal(config.audio.format, 'pcm');
  assert.equal(config.audio.language, undefined);
});

// --- result-frame parsing ----------------------------------------------------

test('extractTranscripts returns a partial from rolling text', () => {
  const payload = Buffer.from(JSON.stringify({ result: { text: 'hello wor' } }));
  assert.deepEqual(extractTranscripts(payload), [{ text: 'hello wor', isFinal: false }]);
});

test('extractTranscripts returns finals from definite utterances', () => {
  const payload = Buffer.from(
    JSON.stringify({
      result: {
        text: 'ignored rolling',
        utterances: [
          { text: ' hello world. ', definite: true },
          { text: 'partial', definite: false }
        ]
      }
    })
  );
  assert.deepEqual(extractTranscripts(payload), [{ text: 'hello world.', isFinal: true }]);
});

test('extractTranscripts normalizes native speaker clusters from Seed ASR 2.0 utterances', () => {
  const payload = Buffer.from(
    JSON.stringify({
      result: {
        utterances: [
          { text: 'first interviewer', definite: true, speaker_id: '3' },
          { text: 'second interviewer', definite: true, additions: { speakerId: 4 } },
          { text: 'candidate answer', definite: true, additions: '{"speaker":"5"}' },
          { text: 'top-level alias', definite: true, speaker: 6 }
        ]
      }
    })
  );

  assert.deepEqual(extractTranscripts(payload), [
    { text: 'first interviewer', isFinal: true, speakerId: 3 },
    { text: 'second interviewer', isFinal: true, speakerId: 4 },
    { text: 'candidate answer', isFinal: true, speakerId: 5 },
    { text: 'top-level alias', isFinal: true, speakerId: 6 }
  ]);
});

test('extractTranscripts omits malformed native speaker clusters', () => {
  const payload = Buffer.from(
    JSON.stringify({
      result: {
        utterances: [
          { text: 'negative', definite: true, speaker_id: -1 },
          { text: 'fractional', definite: true, speakerId: 1.5 },
          { text: 'empty', definite: true, additions: { speaker: '' } },
          { text: 'nonnumeric', definite: true, additions: '{"speaker_id":"host"}' },
          { text: 'invalid additions JSON', definite: true, additions: '{not-json}' }
        ]
      }
    })
  );

  assert.deepEqual(extractTranscripts(payload), [
    { text: 'negative', isFinal: true },
    { text: 'fractional', isFinal: true },
    { text: 'empty', isFinal: true },
    { text: 'nonnumeric', isFinal: true },
    { text: 'invalid additions JSON', isFinal: true }
  ]);
});

test('extractTranscripts is empty for unparseable / empty frames', () => {
  assert.deepEqual(extractTranscripts(Buffer.from('not json')), []);
  assert.deepEqual(extractTranscripts(Buffer.from(JSON.stringify({}))), []);
  assert.deepEqual(extractTranscripts(Buffer.from(JSON.stringify({ result: { text: '   ' } }))), []);
});

// --- Fake `ws` WebSocket (modeled on paraformer-client.test.ts) --------------

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

/** Decode the gzip(JSON) config frame the session sends on open. */
function decodeConfigFrame(ws: FakeWs): any {
  const frame = ws.sent.find((d): d is Buffer => Buffer.isBuffer(d));
  assert.ok(frame, 'expected a config frame');
  const parsed = parseFrame(frame);
  assert.ok(parsed);
  assert.equal(parsed.messageType, MSG_FULL_CLIENT);
  return JSON.parse(parsed.payload.toString('utf8'));
}

test('session opens with the Volc auth headers and sends a gzip config on open', () => {
  FakeWs.instances = [];
  createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'app-123',
    accessToken: 'tok-abc',
    onTranscript: () => {}
  });

  const ws = FakeWs.instances.at(-1)!;
  assert.equal(VOLC_DEFAULT_RESOURCE_ID, 'volc.seedasr.sauc.duration');
  assert.match(ws.url, /bigmodel_nostream$/);
  assert.equal(ws.headers?.['X-Api-App-Key'], 'app-123');
  assert.equal(ws.headers?.['X-Api-Access-Key'], 'tok-abc');
  assert.equal(ws.headers?.['X-Api-Resource-Id'], VOLC_DEFAULT_RESOURCE_ID);

  ws.emit('open');
  const config = decodeConfigFrame(ws);
  assert.equal(config.request.model_name, VOLC_DEFAULT_MODEL);
  assert.equal(config.audio.rate, 16000);
});

test('legacy Doubao ASR 1.0 resources are rejected instead of silently falling back', () => {
  FakeWs.instances = [];
  const errors: string[] = [];

  createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'app-123',
    accessToken: 'tok-abc',
    resourceId: 'volc.bigasr.sauc.duration',
    onTranscript: () => {},
    onError: (message) => errors.push(message)
  });

  assert.equal(FakeWs.instances.length, 0);
  assert.deepEqual(errors, ['Doubao ASR 2.0 requires a volc.seedasr.* resource']);
});

test('maps an upstream HTTP 403 handshake rejection to an actionable Doubao 2.0 message', () => {
  assert.equal(
    formatDoubaoAsr2Error('Unexpected server response: 403'),
    '豆包 ASR 2.0 权限不足（HTTP 403），请检查当前 App ID / Access Token 是否已开通所选 Seed-ASR 2.0 资源'
  );
});

test('surfaces the actionable Doubao 2.0 message through the session error callback', () => {
  FakeWs.instances = [];
  const errors: string[] = [];
  createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'a',
    accessToken: 'b',
    onTranscript: () => {},
    onError: (message) => errors.push(message)
  });

  FakeWs.instances.at(-1)!.emit('error', new Error('Unexpected server response: 403'));

  assert.deepEqual(errors, [
    '豆包 ASR 2.0 权限不足（HTTP 403），请检查当前 App ID / Access Token 是否已开通所选 Seed-ASR 2.0 资源'
  ]);
});

test('a custom resourceId + model flow into the headers and config frame', () => {
  FakeWs.instances = [];
  createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'a',
    accessToken: 'b',
    resourceId: 'volc.seedasr.custom',
    model: 'my-model',
    onTranscript: () => {}
  });
  const ws = FakeWs.instances.at(-1)!;
  assert.equal(ws.headers?.['X-Api-Resource-Id'], 'volc.seedasr.custom');
  ws.emit('open');
  assert.equal(decodeConfigFrame(ws).request.model_name, 'my-model');
});

test('audio frames are gzip-compressed binary with an incrementing sequence', () => {
  FakeWs.instances = [];
  const session = createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'a',
    accessToken: 'b',
    onTranscript: () => {}
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');

  const pcm = Buffer.from([10, 20, 30, 40]);
  session.sendAudio(pcm);

  // Two binary frames now: [config, audio]. Parse the audio one back.
  const binary = ws.sent.filter((d): d is Buffer => Buffer.isBuffer(d));
  assert.equal(binary.length, 2);
  const audio = parseFrame(binary[1]);
  assert.ok(audio);
  assert.equal(audio.messageType, MSG_AUDIO_ONLY);
  assert.deepEqual(audio.payload, pcm);
});

test('a full-server-response frame surfaces partials then finals via onTranscript', () => {
  FakeWs.instances = [];
  const got: Array<{ text: string; isFinal: boolean }> = [];
  createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'a',
    accessToken: 'b',
    onTranscript: (t) => got.push(t)
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');

  const partialFrame = buildFrame({
    messageType: MSG_FULL_SERVER,
    flags: FLAG_POS_SEQ,
    serialization: SER_JSON,
    compression: COMP_GZIP,
    sequence: 1,
    payload: zlib.gzipSync(Buffer.from(JSON.stringify({ result: { text: 'hello' } })))
  });
  const finalFrame = buildFrame({
    messageType: MSG_FULL_SERVER,
    flags: FLAG_POS_SEQ,
    serialization: SER_JSON,
    compression: COMP_GZIP,
    sequence: 2,
    payload: zlib.gzipSync(
      Buffer.from(JSON.stringify({ result: { utterances: [{ text: 'hello world.', definite: true }] } }))
    )
  });
  ws.emit('message', partialFrame);
  ws.emit('message', finalFrame);

  assert.deepEqual(got, [
    { text: 'hello', isFinal: false },
    { text: 'hello world.', isFinal: true }
  ]);
});

test('stop waits for the last server frame and retains its final transcript', async () => {
  FakeWs.instances = [];
  const got: Array<{ text: string; isFinal: boolean }> = [];
  const session = createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'a',
    accessToken: 'b',
    stopTimeoutMs: 50,
    onTranscript: (transcript) => got.push(transcript)
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');

  const before = ws.sent.filter((d): d is Buffer => Buffer.isBuffer(d)).length;
  const stopping = session.stop();
  const after = ws.sent.filter((d): d is Buffer => Buffer.isBuffer(d)).length;
  assert.equal(after, before + 1, 'expected a final last-packet frame');
  assert.equal(ws.terminated, false, 'the socket must remain open for the terminal response');

  ws.emit(
    'message',
    buildFrame({
      messageType: MSG_FULL_SERVER,
      flags: FLAG_LAST_SEQ,
      serialization: SER_JSON,
      compression: COMP_GZIP,
      sequence: -2,
      payload: zlib.gzipSync(
        Buffer.from(
          JSON.stringify({ result: { utterances: [{ text: '最后一句', definite: true }] } })
        )
      )
    })
  );

  assert.deepEqual(await stopping, { finalReceived: true, timedOut: false });
  assert.deepEqual(got, [{ text: '最后一句', isFinal: true }]);
});

test('stop terminates after a bounded timeout when Doubao never returns a terminal frame', async () => {
  FakeWs.instances = [];
  const session = createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'a',
    accessToken: 'b',
    stopTimeoutMs: 5,
    onTranscript: () => {}
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');

  const result = await session.stop();

  assert.equal(result.finalReceived, false);
  assert.equal(result.timedOut, true);
  assert.match(result.reason ?? '', /timeout/i);
  assert.equal(ws.terminated, true);
});

test('a server-error frame reports via onError and stops forwarding audio', () => {
  FakeWs.instances = [];
  const errors: string[] = [];
  const session = createVolcSession({
    WebSocket: FakeWsCtor,
    appId: 'a',
    accessToken: 'b',
    onTranscript: () => {},
    onError: (m) => errors.push(m)
  });
  const ws = FakeWs.instances.at(-1)!;
  ws.emit('open');

  const errorFrame = buildFrame({
    messageType: 0xf,
    flags: FLAG_POS_SEQ,
    serialization: SER_JSON,
    compression: COMP_GZIP,
    sequence: 1,
    payload: zlib.gzipSync(Buffer.from(JSON.stringify({ error: 'resourceId not allowed' })))
  });
  ws.emit('message', errorFrame);
  assert.deepEqual(errors, ['resourceId not allowed']);

  const binaryBefore = ws.sent.filter((d) => Buffer.isBuffer(d)).length;
  session.sendAudio(Buffer.from([1, 2]));
  assert.equal(ws.sent.filter((d) => Buffer.isBuffer(d)).length, binaryBefore);
});

// --- Relay provider-switch: audio routes to the chosen client ----------------
// Inject BOTH a fake Paraformer factory and a fake Volc factory, then assert the
// relay routes start/audio to the right one based on the configured provider.

interface RecordingSession extends AsrSession {
  frames: Buffer[];
  stopped: boolean;
}

function makeRecordingFactory<TDeps>() {
  const created: Array<{ deps: TDeps; session: RecordingSession }> = [];
  const factory = (deps: TDeps): AsrSession => {
    const session: RecordingSession = {
      frames: [],
      stopped: false,
      isReady: true,
      sendAudio(pcm: Buffer) {
        session.frames.push(pcm);
      },
      async stop() {
        session.stopped = true;
        return { finalReceived: true, timedOut: false };
      }
    };
    created.push({ deps, session });
    return session;
  };
  return { factory, created };
}

function providerRelay() {
  const emits: TranscriptEmit[] = [];
  const para = makeRecordingFactory<ParaformerSessionDeps>();
  const volc = makeRecordingFactory<VolcSessionDeps>();
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: 'dashscope-key',
    sessionFactory: para.factory,
    volcSessionFactory: volc.factory
  });
  return { relay, emits, para: para.created, volc: volc.created };
}

test('default provider routes audio to the Paraformer client, not Volc', () => {
  const { relay, para, volc } = providerRelay();
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  relay.handleAudio({ source: 'mic', pcmBase64: Buffer.from([1, 2, 3]).toString('base64') });

  assert.equal(para.length, 1);
  assert.equal(volc.length, 0);
  assert.deepEqual(para[0].session.frames[0], Buffer.from([1, 2, 3]));
});

test('selecting volc + creds routes audio to the Volc client and emits its transcripts', () => {
  const { relay, emits, para, volc } = providerRelay();
  relay.setAsrProvider('volc', { appId: 'app-1', accessToken: 'tok-1', resourceId: 'r-1', model: 'm-1' });

  relay.handleAudioControl({ action: 'start', source: 'display' });
  assert.equal(volc.length, 1, 'a Volc session should be created');
  assert.equal(para.length, 0, 'no Paraformer session should be created');

  // Creds were injected into the Volc client (NOT hardcoded).
  assert.equal(volc[0].deps.appId, 'app-1');
  assert.equal(volc[0].deps.accessToken, 'tok-1');
  assert.equal(volc[0].deps.resourceId, 'r-1');
  assert.equal(volc[0].deps.model, 'm-1');

  // Audio routes to the Volc session.
  const pcm = Buffer.from([9, 8, 7, 6]);
  relay.handleAudio({ source: 'display', pcmBase64: pcm.toString('base64') });
  assert.deepEqual(volc[0].session.frames[0], pcm);

  // The Volc session's transcripts flow through emit, tagged with the source.
  volc[0].deps.onTranscript({ text: 'partial', isFinal: false });
  volc[0].deps.onTranscript({ text: 'final.', isFinal: true });
  assert.deepEqual(emits, [
    { source: 'display', text: 'partial', isFinal: false },
    { source: 'display', text: 'final.', isFinal: true }
  ]);
});

test('volc without creds emits a friendly error and creates no session', () => {
  const { relay, emits, volc } = providerRelay();
  relay.setAsrProvider('volc'); // no creds supplied

  relay.handleAudioControl({ action: 'start', source: 'mic' });
  assert.equal(volc.length, 0);
  assert.equal(emits.length, 1);
  assert.match(emits[0].text, /豆包 ASR 2\.0/);
  assert.equal(emits[0].isFinal, false);
});

test('switching back to paraformer after volc routes new sessions to Paraformer', () => {
  const { relay, para, volc } = providerRelay();
  relay.setAsrProvider('volc', { appId: 'a', accessToken: 'b' });
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  assert.equal(volc.length, 1);

  // Flip back to the default. The NEXT source start uses Paraformer.
  relay.setAsrProvider('paraformer');
  relay.handleAudioControl({ action: 'start', source: 'display' });
  assert.equal(para.length, 1);
});

test('switching provider during active capture reconnects after the old provider drains', async () => {
  const { relay, para, volc } = providerRelay();
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  assert.equal(para.length, 1);

  relay.setAsrProvider('volc', { appId: 'a', accessToken: 'b' });
  assert.equal(para[0].session.stopped, true, 'the old upstream session must stop');
  await Promise.resolve();

  const pcm = Buffer.from([4, 3, 2, 1]);
  relay.handleAudio({ source: 'mic', pcmBase64: pcm.toString('base64') });
  assert.equal(volc.length, 1, 'the next live frame must open the selected provider');
  assert.deepEqual(volc[0].session.frames[0], pcm);
});

test('changing an active server-owned Doubao 2.0 entitlement reconnects after drain', async () => {
  const { relay, volc } = providerRelay();
  relay.setAsrProvider('volc', {
    appId: 'a',
    accessToken: 'b',
    resourceId: 'volc.seedasr.sauc.concurrent'
  });
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  assert.equal(volc.length, 1);

  relay.setAsrProvider('volc', {
    appId: 'a',
    accessToken: 'b',
    resourceId: 'volc.seedasr.sauc.duration'
  });
  assert.equal(volc[0].session.stopped, true, 'the old Doubao model must stop');
  await Promise.resolve();

  relay.handleAudio({ source: 'mic', pcmBase64: Buffer.from([7, 7]).toString('base64') });
  assert.equal(volc.length, 2);
  assert.equal(volc[1].deps.resourceId, 'volc.seedasr.sauc.duration');
});
