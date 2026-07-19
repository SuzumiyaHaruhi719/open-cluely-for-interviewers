import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AudioSource } from '@open-cluely/contract';
import { createAsrRelay, type TranscriptEmit } from '../src/asr-relay';
import type { ParaformerSession, ParaformerSessionDeps } from '../src/paraformer-client';

// --- Fake Paraformer session ------------------------------------------------
// Records frames it receives and exposes hooks so the test can drive transcript
// callbacks deterministically. No network, no real ws.

interface FakeSession extends ParaformerSession {
  frames: Buffer[];
  stopped: boolean;
  deps: ParaformerSessionDeps;
}

function makeFakeFactory() {
  const created: FakeSession[] = [];
  const factory = (deps: ParaformerSessionDeps): ParaformerSession => {
    const session: FakeSession = {
      frames: [],
      stopped: false,
      deps,
      isReady: true,
      sendAudio(pcm: Buffer) {
        session.frames.push(pcm);
      },
      stop() {
        session.stopped = true;
      }
    };
    created.push(session);
    return session;
  };
  return { factory, created };
}

const FAKE_KEY = 'sk-test-key';

function relayWith(overrides: { onDisplayFinal?: (text: string) => void } = {}) {
  const emits: TranscriptEmit[] = [];
  const { factory, created } = makeFakeFactory();
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: FAKE_KEY,
    sessionFactory: factory,
    onDisplayFinal: overrides.onDisplayFinal
  });
  return { relay, emits, created };
}

test('audio-control start lazily creates a session per source with the API key', () => {
  const { relay, created } = relayWith();

  relay.handleAudioControl({ action: 'start', source: 'mic' });
  assert.equal(created.length, 1);
  assert.equal(created[0].deps.apiKey, FAKE_KEY);

  // A second start for the SAME source must not create a duplicate session.
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  assert.equal(created.length, 1);

  // A different source gets its own session (two independent lanes).
  relay.handleAudioControl({ action: 'start', source: 'display' });
  assert.equal(created.length, 2);
});

test('audio frames decode from base64 and forward to the matching session', () => {
  const { relay, created } = relayWith();
  relay.handleAudioControl({ action: 'start', source: 'mic' });

  const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  relay.handleAudio({ source: 'mic', pcmBase64: pcm.toString('base64') });

  assert.equal(created.length, 1);
  assert.equal(created[0].frames.length, 1);
  assert.deepEqual(created[0].frames[0], pcm);
});

test('a frame arriving before an explicit start lazily opens the session', () => {
  const { relay, created } = relayWith();
  const pcm = Buffer.from([0xaa, 0xbb]);
  relay.handleAudio({ source: 'display', pcmBase64: pcm.toString('base64') });

  assert.equal(created.length, 1);
  assert.deepEqual(created[0].frames[0], pcm);
});

test('transcript callbacks become transcript emits tagged with the source', () => {
  const { relay, emits, created } = relayWith();
  relay.handleAudioControl({ action: 'start', source: 'display' });

  const onTranscript = created[0].deps.onTranscript;
  onTranscript({ text: 'partial words', isFinal: false });
  onTranscript({ text: 'final sentence.', isFinal: true });

  assert.deepEqual(emits, [
    { source: 'display', text: 'partial words', isFinal: false },
    { source: 'display', text: 'final sentence.', isFinal: true }
  ]);
});

test('onDisplayFinal fires only for FINAL display transcripts when auto-analyze is on', () => {
  const analyzed: string[] = [];
  const { relay, created } = relayWith({ onDisplayFinal: (t) => analyzed.push(t) });

  relay.handleAudioControl({ action: 'start', source: 'display' });
  relay.handleAudioControl({ action: 'start', source: 'mic' });

  const displayCb = created[0].deps.onTranscript;
  const micCb = created[1].deps.onTranscript;

  // Auto-analyze OFF by default: no callback even on a display final.
  displayCb({ text: 'first answer', isFinal: true });
  assert.deepEqual(analyzed, []);

  relay.setAutoAnalyzeDisplay(true);

  // Partial display transcript: still no analyze.
  displayCb({ text: 'second ans', isFinal: false });
  assert.deepEqual(analyzed, []);

  // Mic final: never triggers analyze (only the interviewee lane does).
  micCb({ text: 'interviewer talking', isFinal: true });
  assert.deepEqual(analyzed, []);

  // Display final with auto-analyze on: fires exactly once with the text.
  displayCb({ text: 'second answer complete', isFinal: true });
  assert.deepEqual(analyzed, ['second answer complete']);
});

test('audio-control stop ends the session; dispose stops all sources', () => {
  const { relay, created } = relayWith();
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  relay.handleAudioControl({ action: 'start', source: 'display' });

  relay.handleAudioControl({ action: 'stop', source: 'mic' });
  assert.equal(created[0].stopped, true);
  assert.equal(created[1].stopped, false);

  relay.dispose();
  assert.equal(created[1].stopped, true);

  // After dispose, further audio is ignored (no new sessions, no throw).
  const before = created.length;
  relay.handleAudio({ source: 'mic', pcmBase64: Buffer.from([0x00]).toString('base64') });
  assert.equal(created.length, before);
});

test('with no API key, start emits a friendly error and creates no session', () => {
  const emits: TranscriptEmit[] = [];
  const { factory, created } = makeFakeFactory();
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: '',
    sessionFactory: factory
  });

  relay.handleAudioControl({ action: 'start', source: 'mic' as AudioSource });
  assert.equal(created.length, 0);
  assert.equal(emits.length, 1);
  assert.equal(emits[0].source, 'mic');
  assert.match(emits[0].text, /API key/i);
  assert.equal(emits[0].isFinal, false);
});

test('text-only Paraformer finals never invent an acoustic speaker id', () => {
  const { relay, emits, created } = relayWith();
  relay.setAsrProvider('paraformer');
  relay.handleAudioControl({ action: 'start', source: 'mic' });

  created[0].deps.onTranscript({ text: '候选人的回答', isFinal: true });

  assert.deepEqual(emits, [{ source: 'mic', text: '候选人的回答', isFinal: true }]);
});

test('sim provider replays scripted speaker finals without any cloud ASR key', () => {
  const emits: any[] = [];
  const simCreated: any[] = [];
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: '',
    simSessionFactory: (deps: any) => {
      const s = { isReady: true, sendAudio() {}, stop() {}, deps };
      simCreated.push(s);
      return s;
    }
  });

  relay.setSimScript([
    { speakerId: 0, text: '面试官：讲讲这个迁移的背景' },
    { speakerId: 1, text: '候选人：我负责把队列迁到幂等写入' }
  ]);
  relay.setAsrProvider('sim');
  relay.handleAudioControl({ action: 'start', source: 'mic' });

  assert.equal(simCreated.length, 1);
  assert.deepEqual(simCreated[0].deps.script, [
    { speakerId: 0, text: '面试官：讲讲这个迁移的背景' },
    { speakerId: 1, text: '候选人：我负责把队列迁到幂等写入' }
  ]);

  simCreated[0].deps.onTranscript({ text: '面试官：讲讲这个迁移的背景', isFinal: true, speakerId: 0 });
  simCreated[0].deps.onTranscript({ text: '候选人：我负责把队列迁到幂等写入', isFinal: true, speakerId: 1 });

  assert.deepEqual(emits, [
    { source: 'mic', text: '面试官：讲讲这个迁移的背景', isFinal: true, speakerId: 0 },
    { source: 'mic', text: '候选人：我负责把队列迁到幂等写入', isFinal: true, speakerId: 1 }
  ]);
});
