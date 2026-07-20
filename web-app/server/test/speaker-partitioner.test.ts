import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpeakerClassifierInput,
  createSpeakerPartitioner,
  parseSpeakerClassification,
  type SpeakerClassification,
  type SpeakerTurn
} from '../src/speaker-partitioner';

function classification(
  speakerRoles: SpeakerClassification['speakerRoles'],
  turnRoles: SpeakerClassification['turnRoles'] = []
): SpeakerClassification {
  return { speakerRoles, turnRoles, model: 'deepseek-v4-flash' };
}

test('native-cluster classifier input stays compact across a full interview', () => {
  const turns: SpeakerTurn[] = Array.from({ length: 60 }, (_, seq) => ({
    seq,
    source: 'mic',
    speakerId: seq > 57 ? 4 : seq > 54 ? 3 : seq % 2 === 0 ? 1 : 2,
    text: `${seq % 2 === 0 ? '候选人回答' : '面试官提问'}${seq}：${'具体证据'.repeat(120)}`
  }));

  const input = buildSpeakerClassifierInput(turns);

  assert.match(input, /mode=native-clusters/);
  assert.match(input, /speaker=1/);
  assert.match(input, /speaker=2/);
  assert.match(input, /speaker=3/);
  assert.match(input, /speaker=4/);
  assert.match(input, /每个 seq 都必须返回 turnRoles/);
  assert.ok(input.length <= 6_000);
  assert.ok((input.match(/^\[seq=/gm) ?? []).length <= 12, 'only representative turns should be sent');
});

test('native classifier preserves recent question-answer adjacency for weak correction', () => {
  const turns: SpeakerTurn[] = Array.from({ length: 20 }, (_, seq) => ({
    seq,
    source: 'mic',
    speakerId: seq % 2 === 0 ? 9 : 7,
    text: `早期样本 ${seq}：园区运营职责和现场管理证据。`
  }));
  turns[12] = {
    seq: 12,
    source: 'mic',
    speakerId: 9,
    text: '请结合一次具体经历，说明你如何组织园区消防演练并验证演练结果。'
  };
  turns[13] = {
    seq: 13,
    source: 'mic',
    speakerId: 7,
    text: '我先按楼栋划分责任区，再邀请消防人员培训逃生和器材操作；演练当天记录各组到场时间，复盘后调整排班，把平均响应时间从八分钟缩短到五分钟。'
  };

  const input = buildSpeakerClassifierInput(turns);

  assert.match(input, /\[recent-context-for-weak-correction\]/);
  assert.match(input, /\[seq=12 .*如何组织园区消防演练/);
  assert.match(input, /\[seq=13 .*平均响应时间从八分钟缩短到五分钟/);
  assert.match(input, /明显在回答相邻问题.*turnRoles/);
  assert.match(input, /短片段.*相邻.*继承同一个语义角色/);
  assert.match(input, /最近上下文中的每个 seq 都必须返回 turnRoles/);
  assert.ok((input.match(/^\[seq=/gm) ?? []).length <= 12);
  assert.ok(input.length <= 6_000);
});

test('weak correction keeps one split grammatical question on the interviewer role', () => {
  const turns: SpeakerTurn[] = [
    {
      seq: 7,
      source: 'mic',
      speakerId: 2,
      text: '好，请听第二题，为了防范火灾，你单位组织消防演练'
    },
    {
      seq: 8,
      source: 'mic',
      speakerId: 1,
      text: '但是同事们的参与热情都不高，敷衍了事'
    },
    {
      seq: 9,
      source: 'mic',
      speakerId: 2,
      text: '领导交由你负责本次演练，作为组织负责人，你将如何开展？'
    }
  ];

  const input = buildSpeakerClassifierInput(turns);
  assert.match(input, /\[continuity-group seqs=7,8,9\]/);

  const parsed = parseSpeakerClassification(
    JSON.stringify({
      speakerRoles: [
        { speakerId: 1, role: 'candidate', confidence: 0.95 },
        { speakerId: 2, role: 'interviewer', confidence: 0.95 }
      ],
      turnRoles: [
        { seq: 7, role: 'interviewer', confidence: 0.95 },
        { seq: 8, role: 'candidate', confidence: 0.85 },
        { seq: 9, role: 'interviewer', confidence: 0.95 }
      ]
    }),
    turns
  );

  assert.deepEqual(
    parsed.turnRoles.map(({ seq, role, confidence }) => [seq, role, confidence]),
    [
      [7, 'interviewer', 0.95],
      [8, 'interviewer', 0.95],
      [9, 'interviewer', 0.95]
    ]
  );
});

test('two adjacent fragments never form a continuity group without model-backed outer edges', () => {
  const input = buildSpeakerClassifierInput([
    {
      seq: 0,
      source: 'mic',
      speakerId: 2,
      text: '请结合具体经历说明你如何处理园区突发消防风险'
    },
    {
      seq: 1,
      source: 'mic',
      speakerId: 1,
      text: '那么我会先隔离风险区域，再组织整改和复验。'
    }
  ]);

  assert.doesNotMatch(input, /\[continuity-group/);
});

test('text-only classifier input uses a bounded recent window for incremental role caching', () => {
  const turns: SpeakerTurn[] = Array.from({ length: 40 }, (_, seq) => ({
    seq,
    source: 'mic',
    text: `${seq}：${'一段足够长的转写'.repeat(80)}`
  }));

  const input = buildSpeakerClassifierInput(turns);

  assert.match(input, /mode=turns-without-clusters/);
  assert.doesNotMatch(input, /\[seq=0 /);
  assert.match(input, /\[seq=39 /);
  assert.ok((input.match(/^\[seq=/gm) ?? []).length <= 12);
  assert.ok(input.length <= 6_000);
});

test('hybrid classifier input keeps text-only turns when the ASR provider changes mid-interview', () => {
  const turns: SpeakerTurn[] = [
    {
      seq: 0,
      source: 'mic',
      speakerId: 9,
      text: '请结合一次具体经历说明，你如何处理园区消防检查发现的重大隐患。'
    },
    {
      seq: 1,
      source: 'mic',
      speakerId: 7,
      text: '我先隔离风险区域，再明确责任人、整改时限和复验标准。'
    },
    { seq: 2, source: 'mic', text: '最后把复验结果和现场照片写入消防台账。' },
    { seq: 3, source: 'mic', text: '这个整改结果如何向租户解释？' }
  ];

  const input = buildSpeakerClassifierInput(turns);

  assert.match(input, /mode=hybrid/);
  assert.match(input, /\[seq=0 .*speaker=9\]/);
  assert.match(input, /\[seq=1 .*speaker=7\]/);
  assert.match(input, /\[seq=2 .*speaker=none\]/);
  assert.match(input, /\[seq=3 .*speaker=none\]/);
  assert.match(input, /speaker=none.*turnRoles/);
});

test('a failed final classification preserves the last stable live role map', async () => {
  const partitions: any[] = [];
  let calls = 0;
  const p = createSpeakerPartitioner({
    classify: async () => {
      calls += 1;
      return calls === 1
        ? classification([
            { speakerId: 1, role: 'candidate', confidence: 0.96 },
            { speakerId: 2, role: 'interviewer', confidence: 0.97 }
          ])
        : classification([]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 1, text: '我独立负责园区运营、消防整改、租户服务和工程团队协同。' });
  p.record({ seq: 1, source: 'mic', speakerId: 2, text: '请具体说明你如何识别消防风险，并验证整改已经真正闭环。' });
  p.record({ seq: 2, source: 'mic', speakerId: 1, text: '我先隔离现场并组织复验。' });
  p.record({ seq: 3, source: 'mic', speakerId: 2, text: '结果如何留档？' });
  await p.flush();
  await p.finalize();

  assert.equal(calls, 2);
  assert.equal(partitions.at(-1).status, 'final');
  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => segment.role),
    ['candidate', 'interviewer', 'candidate', 'interviewer']
  );
});

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
  p.setEnabled(true);

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

test('native clusters weak-correct one clear answer without remapping the shared acoustic id', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async () =>
      classification(
        [
          { speakerId: 1, role: 'candidate', confidence: 0.98 },
          { speakerId: 2, role: 'interviewer', confidence: 0.99 }
        ],
        [{ seq: 1, role: 'candidate', confidence: 0.97 }]
      ),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);

  p.record({ seq: 0, source: 'mic', speakerId: 2, text: '请结合一次具体经历说明，你如何组织园区消防演练。' });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 2,
    text: '我先按楼栋划分责任区，再邀请消防人员培训；演练当天记录各组响应时间，复盘后调整排班，把平均到场时间从八分钟缩短到五分钟。'
  });
  p.record({ seq: 2, source: 'mic', speakerId: 2, text: '这次演练暴露出的最大风险是什么？' });
  p.record({ seq: 3, source: 'mic', speakerId: 1, text: '最大风险是夜班人员对消防器材位置不熟悉。' });
  await p.finalize();

  const final = partitions.at(-1);
  assert.equal(final.status, 'final');
  assert.deepEqual(
    final.segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'candidate'],
      [2, 'interviewer'],
      [3, 'candidate']
    ]
  );
  assert.deepEqual(candidates.map((turn) => turn.seq), [1, 3]);
  assert.deepEqual(interviewers.map((turn) => turn.seq), [0, 2]);
});

test('one long post-baseline turn requests an immediate semantic correction refresh', async () => {
  const snapshots: SpeakerTurn[][] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) => {
      snapshots.push(turns.map((turn) => ({ ...turn })));
      return classification([
        { speakerId: 7, role: 'candidate', confidence: 0.98 },
        { speakerId: 9, role: 'interviewer', confidence: 0.98 }
      ]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: () => {}
  });
  p.setEnabled(true);
  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 9,
    text: '请结合一次具体经历说明，你如何识别园区消防隐患、推动整改并验证闭环结果。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 7,
    text: '我先核对巡检台账，再隔离风险区域，明确责任人和整改时限，最后组织复验并把现场证据归档。'
  });
  await p.flush();
  assert.equal(snapshots.length, 1);

  p.record({
    seq: 2,
    source: 'mic',
    speakerId: 9,
    text: '我还组织夜间盲演，逐项记录各岗位到场时间和处置动作，复盘后调整排班，把平均响应时间从八分钟缩短到五分钟。'
  });
  await p.flush();

  assert.equal(snapshots.length, 2, 'a long new turn must not wait for two unrelated finals');
  assert.deepEqual(snapshots[1].map((turn) => turn.seq), [0, 1, 2]);
});

test('low-confidence cluster guesses cannot become sticky speaker roles', async () => {
  const applied: Array<{ speakerId: number; role: string }> = [];
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async () =>
      classification([
        { speakerId: 7, role: 'candidate', confidence: 0.61 },
        { speakerId: 9, role: 'interviewer', confidence: 0.58 }
      ]),
    applySpeakerRole: (speakerId, role) => {
      applied.push({ speakerId, role });
      return role;
    },
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 9, text: '请介绍一次具体的消防整改经历。' });
  p.record({ seq: 1, source: 'mic', speakerId: 7, text: '我负责识别风险、组织整改和最终复验。' });
  await p.finalize();

  assert.deepEqual(applied, []);
  assert.deepEqual(partitions.at(-1).segments.map((segment: any) => segment.role), [
    'unknown',
    'unknown'
  ]);
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
  p.setEnabled(true);
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

test('semantic partitioning stays disabled when the client does not request it', async () => {
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
  p.setEnabled(false);
  p.record({ seq: 0, source: 'mic', text: '面试官问题' });
  p.record({ seq: 1, source: 'display', text: '候选人回答' });
  await p.finalize();
  assert.equal(calls, 0);
});

test('new-interview reset clears evidence but preserves the current enabled state', async () => {
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
  p.setEnabled(true);
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

test('live role assignment accepts one sufficiently substantive turn per native speaker', async () => {
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
  p.setEnabled(true);

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
  assert.equal(snapshots.length, 1, 'substantive speech-act evidence is enough for a stable role map');
  assert.deepEqual(snapshots[0].map((turn) => turn.seq), [0, 1]);

  p.record({ seq: 2, source: 'mic', speakerId: 1, text: '我先停用风险区域，再组织整改和复验。' });
  p.record({ seq: 3, source: 'mic', speakerId: 2, text: '整改结果如何量化和留档？' });
  await p.flush();
  assert.equal(snapshots.length, 1, 'the refresh cadence still waits for three additional turns');
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
  p.setEnabled(true);

  p.record({ seq: 0, source: 'mic', text: '只有一段完整回答。' });
  await p.finalize();
  assert.equal(calls, 0);

  p.record({ seq: 1, source: 'mic', text: '现在补充了第二段有效对话。' });
  await p.finalize();
  assert.equal(calls, 1);
});

test('a mixed shared-audio lane classifies interviewer and candidate before releasing answer text', async () => {
  const candidates: number[] = [];
  const interviewers: number[] = [];
  let calls = 0;
  const p = createSpeakerPartitioner({
    classify: async () => {
      calls += 1;
      return classification([
        { speakerId: 1, role: 'interviewer', confidence: 0.98 },
        { speakerId: 2, role: 'candidate', confidence: 0.98 }
      ]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn.seq),
    onInterviewerTurn: (turn) => interviewers.push(turn.seq),
    onPartition: () => {}
  });
  p.setEnabled(true);

  p.record({
    seq: 0,
    source: 'display',
    speakerId: 1,
    text: '请结合一次具体经历说明，你如何处理园区消防检查发现的重大隐患。'
  });
  p.record({
    seq: 1,
    source: 'display',
    speakerId: 2,
    text: '我先隔离风险区域，再明确责任人、整改时限和复验标准，最后把证据写入消防台账。'
  });
  await p.flush();

  assert.equal(calls, 1, 'one substantial sample per native cluster is enough to classify');
  assert.deepEqual(interviewers, [0]);
  assert.deepEqual(candidates, [1]);
});
