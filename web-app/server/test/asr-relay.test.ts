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

test('funasr provider emits transcripts carrying the speaker id', () => {
  const emits: any[] = [];
  const created: any[] = [];
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: 'k',
    sessionFactory: () => {
      throw new Error('paraformer factory should not run');
    },
    funasrSessionFactory: (deps: any) => {
      const s = { isReady: true, sendAudio() {}, stop() {}, deps };
      created.push(s);
      return s;
    }
  });
  relay.setAsrProvider('funasr', undefined, { url: 'ws://funasr:10096' });
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  created[0].deps.onTranscript({ text: '你好', isFinal: true, speakerId: 1 });
  assert.deepEqual(emits, [{ source: 'mic', text: '你好', isFinal: true, speakerId: 1 }]);
});

test('funasr with a blank url emits a friendly error and creates no session', () => {
  // NOTE: relies on the test env having NO FUNASR_WS_URL — config.funasrWsUrl is
  // then '' and a blank configure url leaves the relay with no URL to dial.
  const emits: any[] = [];
  let funasrCalls = 0;
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: 'k',
    funasrSessionFactory: () => {
      funasrCalls += 1;
      throw new Error('funasr factory should not run for a blank url');
    }
  });

  relay.setAsrProvider('funasr', undefined, { url: '' });
  relay.handleAudioControl({ action: 'start', source: 'mic' });

  // No session was created, and the failure surfaced once on the mic lane as a
  // non-final transcript-shaped error carrying the friendly "FunASR" text.
  assert.equal(funasrCalls, 0);
  assert.equal(emits.length, 1);
  assert.equal(emits[0].source, 'mic');
  assert.equal(emits[0].isFinal, false);
  assert.match(emits[0].text, /FunASR unavailable/i);
});
