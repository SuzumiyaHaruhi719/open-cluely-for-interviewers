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
      at: 780,
      message: {
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          { speakerId: 1, role: 'interviewer', state: 'delegated', roleSource: 'cohort', confidence: 0.96, evidenceVersion: 1, updatedAtMs: 500, reasonCodes: ['two_pass_consensus'] },
          { speakerId: 2, role: 'candidate', state: 'delegated', roleSource: 'cohort', confidence: 0.95, evidenceVersion: 1, updatedAtMs: 500, reasonCodes: ['two_pass_consensus'] }
        ],
        segments: [
          { seq: 0, speakerId: 1, role: 'interviewer', roleSource: 'cohort', text: '面试官提问' },
          { seq: 1, speakerId: 2, role: 'candidate', roleSource: 'cohort', text: '候选人回答' }
        ]
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
        speakerAssignments: [
          {
            speakerId: 1,
            role: 'interviewer',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.96,
            evidenceVersion: 1,
            updatedAtMs: 500,
            reasonCodes: ['two_pass_consensus']
          },
          {
            speakerId: 2,
            role: 'candidate',
            state: 'delegated',
            roleSource: 'cohort',
            confidence: 0.95,
            evidenceVersion: 1,
            updatedAtMs: 500,
            reasonCodes: ['two_pass_consensus']
          }
        ],
        segments: [
          { seq: 0, speakerId: 1, role: 'interviewer', roleSource: 'cohort', text: '面试官提问' },
          { seq: 1, speakerId: 2, role: 'candidate', roleSource: 'cohort', text: '候选人回答' }
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
  assert.deepEqual(report.mixedRoleSpeakerIds, []);
  assert.deepEqual(report.pendingSubstantiveSpeakerIds, []);
  assert.deepEqual(report.invalidAutoQuestionIds, []);
  assert.equal(report.invalidPartitionCount, 0);
  assert.equal(report.qaPassed, true);
  assert.deepEqual(report.assignmentHistories['2'].map((entry) => entry.role), [
    'candidate',
    'candidate'
  ]);
});

test('summarizeAsrRun fails QA for mixed assignments, substantive pending ids, and invalid Auto anchors', () => {
  const report = summarizeAsrRun([
    { at: 0, message: { type: 'transcript', text: '我负责制定项目计划和跨部门执行。', isFinal: true, speakerId: 7 } },
    { at: 10, message: { type: 'transcript', text: '我还验证了关键指标并完成复盘闭环。', isFinal: true, speakerId: 7 } },
    { at: 20, message: { type: 'transcript', text: '另一位说话人的第一段完整证据样本，包含具体项目背景、个人行动和判断依据。', isFinal: true, speakerId: 9 } },
    { at: 30, message: { type: 'transcript', text: '另一位说话人的第二段完整证据样本，包含量化结果、复盘方法和后续改进。', isFinal: true, speakerId: 9 } },
    {
      at: 40,
      message: {
        type: 'speaker-partition',
        status: 'live',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          { speakerId: 7, role: 'candidate', state: 'delegated', roleSource: 'cohort', confidence: 0.95, evidenceVersion: 1, updatedAtMs: 40, reasonCodes: [] },
          { speakerId: 9, role: 'unknown', state: 'observing', roleSource: 'unknown', confidence: 0, evidenceVersion: 1, updatedAtMs: 40, reasonCodes: ['insufficient_evidence'] }
        ],
        segments: [
          { seq: 0, speakerId: 7, role: 'candidate', roleSource: 'cohort', text: '候选人证据' },
          { seq: 2, speakerId: 9, role: 'unknown', roleSource: 'unknown', text: '待确认证据' }
        ]
      }
    },
    {
      at: 50,
      message: {
        type: 'result',
        requestId: 'bad-auto',
        trigger: 'auto',
        anchorSeq: 2,
        elapsedMs: 100,
        output: { primary_question: '错误锚点问题？' }
      }
    },
    {
      at: 60,
      message: {
        type: 'speaker-partition',
        status: 'final',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          { speakerId: 7, role: 'interviewer', state: 'delegated', roleSource: 'cohort', confidence: 0.95, evidenceVersion: 3, updatedAtMs: 60, reasonCodes: [] },
          { speakerId: 9, role: 'unknown', state: 'contested', roleSource: 'unknown', confidence: 0, evidenceVersion: 3, updatedAtMs: 60, reasonCodes: ['opposite_role_contradictions'] }
        ],
        segments: [
          { seq: 0, speakerId: 7, role: 'interviewer', roleSource: 'cohort', text: '角色翻转' },
          { seq: 2, speakerId: 9, role: 'candidate', roleSource: 'unknown', text: '无效冲突' }
        ]
      }
    },
    { at: 70, message: { type: 'asr-status', state: 'stopped' } }
  ]);

  assert.deepEqual(report.mixedRoleSpeakerIds, [7]);
  assert.deepEqual(report.pendingSubstantiveSpeakerIds, [9]);
  assert.deepEqual(report.invalidAutoQuestionIds, ['bad-auto']);
  assert.equal(report.invalidPartitionCount, 1);
  assert.equal(report.qaPassed, false);
});

test('summarizeAsrRun accepts an explicit unresolved voiceprint that is excluded from Auto', () => {
  const report = summarizeAsrRun([
    { at: 0, message: { type: 'transcript', text: '片头旁白介绍本期互联网用户运营专家面试的完整内容和岗位背景。', isFinal: true, speakerId: 9 } },
    { at: 10, message: { type: 'transcript', text: '片尾评论复盘候选人的面试结果并提醒观看者注意后续求职风险。', isFinal: true, speakerId: 9 } },
    {
      at: 20,
      message: {
        type: 'speaker-partition',
        status: 'final',
        model: 'deepseek-v4-flash',
        speakerAssignments: [
          { speakerId: 9, role: 'unknown', state: 'observing', roleSource: 'unknown', confidence: 0, evidenceVersion: 1, updatedAtMs: 20, reasonCodes: ['audit_no_consensus'] }
        ],
        segments: [
          { seq: 0, speakerId: 9, role: 'unknown', roleSource: 'unknown', text: '片头旁白介绍本期互联网用户运营专家面试的完整内容和岗位背景。 片尾评论复盘候选人的面试结果并提醒观看者注意后续求职风险。' }
        ]
      }
    },
    { at: 30, message: { type: 'asr-status', state: 'stopped' } }
  ]);

  assert.deepEqual(report.pendingSubstantiveSpeakerIds, [9]);
  assert.deepEqual(report.unsafePendingSubstantiveSpeakerIds, []);
  assert.equal(report.qaChecks.ambiguousSpeakersFailSafe, true);
  assert.equal(report.qaPassed, true);
});

test('summarizeAsrRun rejects a substantive voiceprint with no final fail-safe assignment', () => {
  const report = summarizeAsrRun([
    { at: 0, message: { type: 'transcript', text: '第一段完整参与者发言包含项目背景个人行动判断依据和最终结果。', isFinal: true, speakerId: 8 } },
    { at: 10, message: { type: 'transcript', text: '第二段完整参与者发言继续说明量化指标复盘方法和后续改进。', isFinal: true, speakerId: 8 } },
    { at: 20, message: { type: 'speaker-partition', status: 'final', model: 'deepseek-v4-flash', speakerAssignments: [], segments: [] } },
    { at: 30, message: { type: 'asr-status', state: 'stopped' } }
  ]);

  assert.deepEqual(report.pendingSubstantiveSpeakerIds, [8]);
  assert.deepEqual(report.unsafePendingSubstantiveSpeakerIds, [8]);
  assert.equal(report.qaChecks.ambiguousSpeakersFailSafe, false);
  assert.equal(report.qaPassed, false);
});
