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
