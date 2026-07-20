import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveAsrOptions, parsePcm16Wav, summarizeAsrRun } from './live-asr-lib.mjs';

function chunk(id, payload) {
  const padded = payload.length + (payload.length % 2);
  const out = Buffer.alloc(8 + padded);
  out.write(id, 0, 4, 'ascii');
  out.writeUInt32LE(payload.length, 4);
  payload.copy(out, 8);
  return out;
}

function fixtureWav(pcm) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(16_000, 4);
  fmt.writeUInt32LE(32_000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const body = Buffer.concat([chunk('JUNK', Buffer.from([1, 2, 3])), chunk('fmt ', fmt), chunk('data', pcm)]);
  const wav = Buffer.alloc(12 + body.length);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  body.copy(wav, 12);
  return wav;
}

test('parsePcm16Wav finds a padded data chunk instead of assuming a 44-byte header', () => {
  const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const parsed = parsePcm16Wav(fixtureWav(pcm));

  assert.equal(parsed.sampleRate, 16_000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.deepEqual(parsed.pcm, pcm);
});

test('parseLiveAsrOptions makes automatic generation explicit and keeps diarization on', () => {
  assert.deepEqual(parseLiveAsrOptions([]), { autoGenerate: false, diarize: true });
  assert.deepEqual(parseLiveAsrOptions(['--auto-generate']), {
    autoGenerate: true,
    diarize: true
  });
  assert.deepEqual(parseLiveAsrOptions(['--auto-generate', '--no-diarize']), {
    autoGenerate: true,
    diarize: false
  });
});

test('summarizeAsrRun separates provider lifecycle, finals, speakers, and final role correction', () => {
  const report = summarizeAsrRun([
    { at: 100, message: { type: 'asr-status', provider: 'volc', state: 'connecting' } },
    { at: 180, message: { type: 'asr-status', provider: 'volc', state: 'live' } },
    { at: 420, message: { type: 'transcript', text: '面试官提问', isFinal: true, speakerId: 1 } },
    { at: 610, message: { type: 'transcript', text: '候选人回答', isFinal: true, speakerId: 2 } },
    {
      at: 700,
      message: { type: 'auto-monitor', status: 'evaluating', model: 'deepseek-v4-flash' }
    },
    {
      at: 760,
      message: {
        type: 'auto-monitor',
        status: 'delegating',
        model: 'deepseek-v4-flash',
        elapsedMs: 60
      }
    },
    {
      at: 880,
      message: {
        type: 'result',
        requestId: 'auto-1',
        trigger: 'auto',
        anchorSeq: 1,
        elapsedMs: 120,
        tokensUsed: { input: 300, output: 45, total: 345 },
        output: { primary_question: '你如何验证这个结果？' }
      }
    },
    {
      at: 900,
      message: {
        type: 'speaker-partition',
        status: 'final',
        model: 'deepseek-v4-flash',
        segments: [
          { seq: 0, speakerId: 1, role: 'interviewer', text: '面试官提问' },
          { seq: 1, speakerId: 2, role: 'candidate', text: '候选人回答' }
        ]
      }
    },
    { at: 920, message: { type: 'asr-status', provider: 'volc', state: 'stopped' } }
  ]);

  assert.deepEqual(report.statuses, ['connecting', 'live', 'stopped']);
  assert.deepEqual(report.statusEvents, [
    { state: 'connecting', atMs: 0 },
    { state: 'live', atMs: 80 },
    { state: 'stopped', atMs: 820 }
  ]);
  assert.equal(report.finalCount, 2);
  assert.deepEqual(report.speakerIds, [1, 2]);
  assert.equal(report.finalPartition?.model, 'deepseek-v4-flash');
  assert.deepEqual(report.finalPartition?.roles, { interviewer: 1, candidate: 1, unknown: 0 });
  assert.equal(report.finalPartitionBeforeStopped, true);
  assert.equal(report.firstFinalMs, 320);
  assert.deepEqual(report.autoMonitorStates, [
    { status: 'evaluating', model: 'deepseek-v4-flash', atMs: 600 },
    { status: 'delegating', model: 'deepseek-v4-flash', elapsedMs: 60, atMs: 660 }
  ]);
  assert.deepEqual(report.autoQuestions, [
    {
      requestId: 'auto-1',
      question: '你如何验证这个结果？',
      anchorSeq: 1,
      tokensUsed: { input: 300, output: 45, total: 345 },
      elapsedMs: 120,
      atMs: 780
    }
  ]);
  assert.equal(report.autoQuestionCount, 1);
});
