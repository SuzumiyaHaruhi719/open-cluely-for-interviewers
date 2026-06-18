import { test } from 'node:test';
import assert from 'node:assert/strict';

// iFlytek creds must exist BEFORE the relay (and its `config` singleton) loads,
// so set them here and pull the relay in via a dynamic import inside each test
// (top-level await isn't available under tsx's CJS output). tsx runs each test
// file in its own process, so this does not leak into other suites.
process.env.XFYUN_APP_ID = 'app';
process.env.XFYUN_API_KEY = 'key';
process.env.XFYUN_API_SECRET = 'secret';

async function loadRelay() {
  const mod = await import('../src/asr-relay');
  return mod.createAsrRelay;
}

/** Capture a fake xfyun session so the test can drive its onTranscript. */
function makeXfyunFactory() {
  const created: any[] = [];
  const factory = (deps: any) => {
    const s = { isReady: true, sendAudio() {}, stop() {}, deps };
    created.push(s);
    return s;
  };
  return { factory, created };
}

test('xfyun: an over-segmented stream (rl ids 1,2,3,4) is capped to ≤ 2 distinct speakers', async () => {
  const createAsrRelay = await loadRelay();
  const emits: any[] = [];
  const { factory, created } = makeXfyunFactory();
  const relay = createAsrRelay({
    emit: (t) => emits.push(t),
    apiKey: '',
    xfyunSessionFactory: factory
  });

  relay.setAsrProvider('xfyun');
  relay.handleAudioControl({ action: 'start', source: 'mic' });
  assert.equal(created.length, 1);

  // iFlytek over-segments 2 people into rl ids 1,2,3,4 on finals.
  const onTranscript = created[0].deps.onTranscript;
  onTranscript({ text: '问题一', isFinal: true, speakerId: 1 });
  onTranscript({ text: '回答一', isFinal: true, speakerId: 2 });
  onTranscript({ text: '问题二', isFinal: true, speakerId: 3 });
  onTranscript({ text: '回答二', isFinal: true, speakerId: 4 });

  const finalSpeakerIds = emits
    .filter((e) => e.isFinal && typeof e.speakerId === 'number')
    .map((e) => e.speakerId);
  // Four raw ids in, but the UI must never see more than two distinct speakers.
  assert.equal(finalSpeakerIds.length, 4);
  assert.ok(
    new Set(finalSpeakerIds).size <= 2,
    `expected ≤2 distinct capped speakers, got ${[...new Set(finalSpeakerIds)].join(',')}`
  );
  // Capped slots are 0/1 (first-seen → 0, second → 1).
  assert.deepEqual([finalSpeakerIds[0], finalSpeakerIds[1]], [0, 1]);
});

test('xfyun: partials (no speakerId) are forwarded untouched by the cap', async () => {
  const createAsrRelay = await loadRelay();
  const emits: any[] = [];
  const { factory, created } = makeXfyunFactory();
  const relay = createAsrRelay({ emit: (t) => emits.push(t), apiKey: '', xfyunSessionFactory: factory });
  relay.setAsrProvider('xfyun');
  relay.handleAudioControl({ action: 'start', source: 'mic' });

  created[0].deps.onTranscript({ text: '半句', isFinal: false, speakerId: null });
  assert.deepEqual(emits, [{ source: 'mic', text: '半句', isFinal: false }]);
});

test('xfyun: a genuine 2-speaker stream keeps both speakers (0 and 1)', async () => {
  const createAsrRelay = await loadRelay();
  const emits: any[] = [];
  const { factory, created } = makeXfyunFactory();
  const relay = createAsrRelay({ emit: (t) => emits.push(t), apiKey: '', xfyunSessionFactory: factory });
  relay.setAsrProvider('xfyun');
  relay.handleAudioControl({ action: 'start', source: 'mic' });

  const onTranscript = created[0].deps.onTranscript;
  onTranscript({ text: 'a', isFinal: true, speakerId: 5 });
  onTranscript({ text: 'b', isFinal: true, speakerId: 9 });
  onTranscript({ text: 'c', isFinal: true, speakerId: 5 });

  const ids = emits.filter((e) => e.isFinal).map((e) => e.speakerId);
  assert.deepEqual(ids, [0, 1, 0]);
});
