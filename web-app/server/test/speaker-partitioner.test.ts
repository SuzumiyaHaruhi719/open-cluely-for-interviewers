import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeakerPartitioner,
  type SpeakerClassification,
  type SpeakerTurn
} from '../src/speaker-partitioner';

function classification(
  speakerRoles: SpeakerClassification['speakerRoles'],
  turnRoles: SpeakerClassification['turnRoles'] = []
): SpeakerClassification {
  return { speakerRoles, turnRoles, model: 'deepseek-v4-flash' };
}

test('native speaker clusters are mapped live and candidate history is released once', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const applied: Array<{ speakerId: number; role: string }> = [];
  const p = createSpeakerPartitioner({
    classify: async () =>
      classification([
        { speakerId: 7, role: 'candidate', confidence: 0.98 },
        { speakerId: 9, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (speakerId, role) => {
      applied.push({ speakerId, role });
      return role;
    },
    onCandidateTurn: (turn) => candidates.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setSingleMic(true);

  p.record({ seq: 0, source: 'mic', speakerId: 7, text: '我负责过园区的消防演练。' });
  p.record({ seq: 1, source: 'mic', speakerId: 9, text: '当时遇到的最大风险是什么？' });
  p.record({ seq: 2, source: 'mic', speakerId: 7, text: '我先划分责任区域，再用盲演检查响应时间。' });
  p.record({ seq: 3, source: 'mic', speakerId: 9, text: '结果如何验证？' });
  await p.flush();

  assert.deepEqual(applied, [
    { speakerId: 7, role: 'candidate' },
    { speakerId: 9, role: 'interviewer' }
  ]);
  assert.deepEqual(candidates.map((turn) => turn.seq), [0, 2]);
  assert.equal(partitions.at(-1)?.status, 'live');
  assert.deepEqual(
    partitions.at(-1)?.segments.map((s: any) => [s.speakerId, s.role, s.text]),
    [
      [7, 'candidate', '我负责过园区的消防演练。'],
      [9, 'interviewer', '当时遇到的最大风险是什么？'],
      [7, 'candidate', '我先划分责任区域，再用盲演检查响应时间。'],
      [9, 'interviewer', '结果如何验证？']
    ]
  );

  await p.finalize();
  assert.equal(partitions.at(-1)?.status, 'final');
  assert.deepEqual(candidates.map((turn) => turn.seq), [0, 2], 'final pass must not feed the same answer twice');
});

test('ASR without native clusters receives a final Flash semantic partition', async () => {
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async () =>
      classification([], [
        { seq: 0, role: 'interviewer', confidence: 0.96 },
        { seq: 1, role: 'candidate', confidence: 0.95 },
        { seq: 2, role: 'interviewer', confidence: 0.92 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setSingleMic(true);
  p.record({ seq: 0, source: 'mic', text: '请介绍一个你独立负责的项目。' });
  p.record({ seq: 1, source: 'mic', text: '我独立负责三万平方米园区的日常运营。' });
  p.record({ seq: 2, source: 'mic', text: '你如何处理消防检查不合格？' });

  await p.finalize();

  const final = partitions.at(-1);
  assert.equal(final.status, 'final');
  assert.deepEqual(
    final.segments.map((s: any) => [s.speakerId, s.role]),
    [
      [0, 'interviewer'],
      [1, 'candidate'],
      [0, 'interviewer']
    ]
  );
});

test('dual-channel interviews do not spend a classifier call', async () => {
  let calls = 0;
  const p = createSpeakerPartitioner({
    classify: async () => {
      calls += 1;
      return classification([]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: () => {}
  });
  p.setSingleMic(false);
  p.record({ seq: 0, source: 'mic', text: '面试官问题' });
  p.record({ seq: 1, source: 'display', text: '候选人回答' });
  await p.finalize();
  assert.equal(calls, 0);
});

test('new-interview reset clears evidence but preserves the current single-mic mode', async () => {
  const snapshots: SpeakerTurn[][] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) => {
      snapshots.push(turns.map((turn) => ({ ...turn })));
      return classification([
        { speakerId: 1, role: 'candidate', confidence: 0.9 },
        { speakerId: 2, role: 'interviewer', confidence: 0.9 }
      ]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: () => {}
  });
  p.setSingleMic(true);
  p.record({ seq: 99, source: 'mic', speakerId: 1, text: '上一场面试的旧证据' });

  p.reset();
  p.record({ seq: 0, source: 'mic', speakerId: 1, text: '候选人先介绍一个具体项目结果。' });
  p.record({ seq: 1, source: 'mic', speakerId: 2, text: '面试官追问当时最大的风险。' });
  p.record({ seq: 2, source: 'mic', speakerId: 1, text: '候选人说明处置动作和验证指标。' });
  p.record({ seq: 3, source: 'mic', speakerId: 2, text: '面试官继续追问复盘结论。' });
  await p.flush();

  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].map((turn) => turn.seq), [0, 1, 2, 3]);
});

test('live role assignment waits for two substantive turns per native speaker', async () => {
  const snapshots: SpeakerTurn[][] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) => {
      snapshots.push(turns.map((turn) => ({ ...turn })));
      return classification([
        { speakerId: 1, role: 'candidate', confidence: 0.95 },
        { speakerId: 2, role: 'interviewer', confidence: 0.95 }
      ]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: () => {}
  });
  p.setSingleMic(true);

  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 1,
    text: '我负责整个园区运营、年度预算、租户费用收缴和工程团队管理，并持续跟踪消防整改闭环与服务满意度。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 2,
    text: '请具体说明你如何处理消防检查中的重大隐患，包括现场隔离、责任分工、整改时限、复验标准和台账留存。'
  });
  await p.flush();
  assert.equal(snapshots.length, 0, 'one sample per cluster is not enough for a stable role map');

  p.record({ seq: 2, source: 'mic', speakerId: 1, text: '我先停用风险区域，再组织整改和复验。' });
  p.record({ seq: 3, source: 'mic', speakerId: 2, text: '整改结果如何量化和留档？' });
  await p.flush();
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].map((turn) => turn.seq), [0, 1, 2, 3]);
});

test('final role assignment requires at least two substantive turns', async () => {
  let calls = 0;
  const p = createSpeakerPartitioner({
    classify: async () => {
      calls += 1;
      return classification([]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: () => {}
  });
  p.setSingleMic(true);

  p.record({ seq: 0, source: 'mic', text: '只有一段完整回答。' });
  await p.finalize();
  assert.equal(calls, 0);

  p.record({ seq: 1, source: 'mic', text: '现在补充了第二段有效对话。' });
  await p.finalize();
  assert.equal(calls, 1);
});
