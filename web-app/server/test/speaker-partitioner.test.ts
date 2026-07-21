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

/** Test fixture for the production contract: every requested transcript turn
 * receives an explicit semantic verdict; acoustic roles are evidence only. */
function classificationForTurns(
  turns: readonly SpeakerTurn[],
  speakerRoles: SpeakerClassification['speakerRoles'],
  turnOverrides: SpeakerClassification['turnRoles'] = []
): SpeakerClassification {
  const speakerRoleById = new Map(speakerRoles.map((entry) => [entry.speakerId, entry]));
  const overrideBySeq = new Map(turnOverrides.map((entry) => [entry.seq, entry]));
  const turnRoles = turns.flatMap((turn): SpeakerClassification['turnRoles'] => {
    const override = overrideBySeq.get(turn.seq);
    if (override) return [override];
    if (typeof turn.speakerId !== 'number') return [];
    const speakerRole = speakerRoleById.get(turn.speakerId);
    if (!speakerRole || speakerRole.role === 'unknown') return [];
    return [{ seq: turn.seq, role: speakerRole.role, confidence: speakerRole.confidence }];
  });
  return classification(speakerRoles, turnRoles);
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

test('native final audit input includes every requested turn with adjacent context', () => {
  const turns: SpeakerTurn[] = Array.from({ length: 20 }, (_, seq) => ({
    seq,
    source: 'mic',
    speakerId: seq % 3,
    text: `第 ${seq} 段面试转写，包含可核验的上下文证据。`
  }));

  const input = buildSpeakerClassifierInput(turns, {
    final: true,
    reviewSeqs: [7, 8],
    auditPass: 'verification'
  });

  assert.match(input, /classification-mode=final-turn-audit/);
  assert.match(input, /required-turn-verdicts seqs=7,8/);
  assert.match(input, /review-pass=verification/);
  assert.match(input, /\[seq=6 /, 'left context must be included');
  assert.match(input, /\[seq=7 /);
  assert.match(input, /\[seq=8 /);
  assert.match(input, /\[seq=9 /, 'right context must be included');
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
        // Flash can be confidently wrong when it sees this isolated clause.
        // Matching outer edges plus the explicit continuity group must still
        // keep the complete ASR-split question on one role.
        { seq: 8, role: 'candidate', confidence: 0.99 },
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

test('final text-only classifier input restores unresolved early fragments with adjacent context', () => {
  const turns: SpeakerTurn[] = Array.from({ length: 40 }, (_, seq) => ({
    seq,
    source: 'mic',
    text: seq === 0 ? '我们的。' : seq === 1 ? '人员进行。' : `${seq}：${'具体面试证据'.repeat(20)}`
  }));

  const input = buildSpeakerClassifierInput(turns, { prioritySeqs: [0, 1] });

  assert.match(input, /priority-unresolved seqs=0,1/);
  assert.match(input, /\[seq=0 .*我们的/);
  assert.match(input, /\[seq=1 .*人员进行/);
  assert.match(input, /\[seq=2 /, 'adjacent context must accompany the fragments');
  assert.match(input, /\[seq=39 /, 'recent context must remain represented');
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

test('a failed final audit never preserves an unverified live role as final truth', async () => {
  const partitions: any[] = [];
  let calls = 0;
  const p = createSpeakerPartitioner({
    classify: async (turns, request) => {
      calls += 1;
      if (request?.final) throw new Error('final classifier unavailable');
      return classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.96 },
        { speakerId: 2, role: 'interviewer', confidence: 0.97 }
      ]);
    },
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
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

  assert.equal(calls, 4);
  assert.equal(partitions.at(-1).status, 'final');
  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => segment.role),
    ['unknown', 'unknown', 'unknown', 'unknown']
  );
});

test('final pass independently revisits every text-only turn', async () => {
  const requests: Array<{
    reviewSeqs?: readonly number[];
    final?: boolean;
    auditPass?: 'primary' | 'verification';
  }> = [];
  const partitions: any[] = [];
  let calls = 0;
  const p = createSpeakerPartitioner({
    classify: async (_turns, request) => {
      if (request) requests.push(request);
      calls += 1;
      return classification(
        [],
        (request?.reviewSeqs ?? []).map((seq) => ({
          seq,
          role: seq === 4 ? 'interviewer' : 'candidate',
          confidence: 0.76
        }))
      );
    },
    applySpeakerRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', text: '我们的。' });
  p.record({ seq: 1, source: 'mic', text: '人员进行。' });
  p.record({ seq: 2, source: 'mic', text: '我会先说明安全事项，再安排工作人员观看完整演练。' });
  p.record({ seq: 3, source: 'mic', text: '随后让所有参训人员亲自操作并记录复盘结论。' });
  p.record({ seq: 4, source: 'mic', text: '请说明你如何验证这次演练真正有效？' });
  p.record({ seq: 5, source: 'mic', text: '我会检查到场时间和关键动作完成率。' });
  await p.flush();
  await p.finalize();

  assert.equal(calls, 4);
  const finalRequests = requests.filter((request) => request.final);
  assert.equal(finalRequests.length, 2);
  assert.deepEqual(finalRequests.map((request) => request.auditPass).sort(), [
    'primary',
    'verification'
  ]);
  assert.deepEqual(finalRequests[0].reviewSeqs, [0, 1, 2, 3, 4, 5]);
  const final = partitions.at(-1);
  assert.equal(final.segments[0].role, 'candidate');
  assert.match(final.segments[0].text, /我们的。 人员进行。/);
  assert.equal(
    final.segments.some((segment: any) => segment.role === 'unknown'),
    false,
    'two agreeing moderate-confidence final audits are sufficient'
  );
});

test('final native audit covers every transcript turn twice', async () => {
  const requests: Array<{
    final?: boolean;
    reviewSeqs?: readonly number[];
    auditPass?: 'primary' | 'verification';
  }> = [];
  const p = createSpeakerPartitioner({
    classify: async (_turns, request) => {
      if (request?.final) requests.push(request);
      return classification(
        [],
        (request?.reviewSeqs ?? []).map((seq) => ({
          seq,
          role: seq % 2 === 0 ? 'interviewer' : 'candidate',
          confidence: 0.97
        }))
      );
    },
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: () => {}
  });
  p.setEnabled(true);
  for (let seq = 0; seq < 17; seq += 1) {
    p.record({
      seq,
      source: 'mic',
      speakerId: seq % 3,
      text: `第 ${seq} 段完整面试证据，包含具体动作、判断依据和结果。`
    });
  }

  await p.finalize();

  const coverage = new Map<number, Set<string>>();
  for (const request of requests) {
    for (const seq of request.reviewSeqs ?? []) {
      const passes = coverage.get(seq) ?? new Set<string>();
      passes.add(request.auditPass ?? 'missing');
      coverage.set(seq, passes);
    }
  }
  assert.deepEqual([...coverage.keys()].sort((a, b) => a - b),
    Array.from({ length: 17 }, (_, seq) => seq));
  for (let seq = 0; seq < 17; seq += 1) {
    assert.deepEqual([...coverage.get(seq)!].sort(), ['primary', 'verification']);
  }
});

test('an explicit final unknown revokes a stale live turn verdict', async () => {
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async (_turns, request) =>
      request?.final
        ? classification(
            [],
            (request.reviewSeqs ?? []).map((seq) => ({
              seq,
              role: 'unknown',
              confidence: 0.99
            }))
          )
        : classification(
            [],
            (request?.reviewSeqs ?? []).map((seq) => ({
              seq,
              role: 'interviewer',
              confidence: 0.98
            }))
          ),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 1,
    text: '这是一段语义暂时无法确认的完整发言内容，包含足够长的现场信息和处理背景。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 2,
    text: '这是另一段语义暂时无法确认的完整发言内容，也包含足够长的现场信息和处理背景。'
  });
  await p.flush();
  assert.equal(partitions.at(-1).segments[0].role, 'interviewer');

  await p.finalize();

  assert.deepEqual(partitions.at(-1).segments.map((segment: any) => segment.role), [
    'unknown',
    'unknown'
  ]);
});

test('conflicting final audit passes fail safe to unknown', async () => {
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async (_turns, request) =>
      classification(
        [],
        (request?.reviewSeqs ?? []).map((seq) => ({
          seq,
          role: request?.auditPass === 'verification' ? 'interviewer' : 'candidate',
          confidence: 0.98
        }))
      ),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 1, text: '第一段完整但角色冲突的面试内容。' });
  p.record({ seq: 1, source: 'mic', speakerId: 2, text: '第二段完整但角色冲突的面试内容。' });

  await p.finalize();

  assert.deepEqual(partitions.at(-1).segments.map((segment: any) => segment.role), [
    'unknown',
    'unknown'
  ]);
});

test('an acoustic cluster baseline alone cannot feed role-sensitive Auto callbacks', async () => {
  const candidates: number[] = [];
  const interviewers: number[] = [];
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async () =>
      classification([
        { speakerId: 1, role: 'candidate', confidence: 0.99 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn.seq),
    onInterviewerTurn: (turn) => interviewers.push(turn.seq),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 2, text: '请说明一个具体项目。' });
  p.record({ seq: 1, source: 'mic', speakerId: 1, text: '我负责园区消防整改并完成复验。' });

  await p.finalize();

  assert.deepEqual(candidates, []);
  assert.deepEqual(interviewers, []);
  assert.deepEqual(partitions.at(-1).segments.map((segment: any) => segment.role), [
    'unknown',
    'unknown'
  ]);
});

test('two agreeing semantic passes release each confirmed turn exactly once', async () => {
  const candidates: number[] = [];
  const interviewers: number[] = [];
  const p = createSpeakerPartitioner({
    classify: async (_turns, request) =>
      classification(
        [],
        (request?.reviewSeqs ?? []).map((seq) => ({
          seq,
          role: seq === 0 ? 'interviewer' : 'candidate',
          confidence: 0.98
        }))
      ),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn.seq),
    onInterviewerTurn: (turn) => interviewers.push(turn.seq),
    onPartition: () => {}
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 2, text: '请说明一个具体项目。' });
  p.record({ seq: 1, source: 'mic', speakerId: 1, text: '我负责园区消防整改并完成复验。' });
  await p.flush();
  await p.finalize();

  assert.deepEqual(interviewers, [0]);
  assert.deepEqual(candidates, [1]);
});

test('final weak-correction threshold never promotes a native acoustic cluster role', async () => {
  const applied: Array<{ speakerId: number; role: string }> = [];
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async () =>
      classification([], [{ seq: 0, role: 'candidate', confidence: 0.7 }]),
    applySpeakerRole: (speakerId, role) => {
      applied.push({ speakerId, role });
      return role;
    },
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 9, text: '语义仍然不完整的短片段。' });
  p.record({ seq: 1, source: 'mic', speakerId: 9, text: '同一个声纹的另一段模糊内容。' });
  await p.finalize();

  assert.deepEqual(applied, []);
  assert.deepEqual(partitions.at(-1).segments.map((segment: any) => segment.role), [
    'unknown'
  ]);
});

test('native turns are semantically mapped live and candidate history is released once', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const applied: Array<{ speakerId: number; role: string }> = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
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

  assert.deepEqual(applied, [], 'acoustic cluster roles must not become global identity state');
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

test('multiple native interviewer clusters map to one interviewer role around one candidate', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 10, role: 'interviewer', confidence: 0.99 },
        { speakerId: 11, role: 'interviewer', confidence: 0.98 },
        { speakerId: 20, role: 'candidate', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);

  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 10,
    text: '第一位面试官：请说明你负责的园区消防整改项目和个人职责。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 20,
    text: '我负责三万平方米园区，先核对巡检台账，再组织工程人员整改并安排复验。'
  });
  p.record({
    seq: 2,
    source: 'mic',
    speakerId: 11,
    text: '第二位面试官：你如何验证整改后没有再次发生同类故障？'
  });
  p.record({
    seq: 3,
    source: 'mic',
    speakerId: 20,
    text: '我连续复查三周的告警和工单，并用消防盲演确认平均响应时间缩短到五分钟。'
  });
  await p.finalize();

  assert.deepEqual(interviewers.map((turn) => [turn.seq, turn.speakerId]), [
    [0, 10],
    [2, 11]
  ]);
  assert.deepEqual(candidates.map((turn) => [turn.seq, turn.speakerId]), [
    [1, 20],
    [3, 20]
  ]);
  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.speakerId, segment.role]),
    [
      [10, 'interviewer'],
      [20, 'candidate'],
      [11, 'interviewer'],
      [20, 'candidate']
    ]
  );
});

test('delegated cohort labels unresolved transcript turns without releasing Auto callbacks', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const cohortCalls: Array<{ final?: boolean }> = [];
  const p = createSpeakerPartitioner({
    classify: async (turns, request) =>
      classification(
        [],
        (request?.reviewSeqs ?? turns.map((turn) => turn.seq)).map((seq) => ({
          seq,
          role: 'unknown',
          confidence: 0.99
        }))
      ),
    cohortHarness: {
      async evaluate(input) {
        cohortCalls.push({ final: input.final });
      },
      getRole(speakerId) {
        return speakerId === 30
          ? {
              state: 'delegated' as const,
              role: 'candidate' as const,
              confidence: 0.95,
              evidenceSeqs: [2, 4],
              contradictionSeqs: [],
              evaluatedRevision: 4,
              reasonCodes: ['two_pass_consensus']
            }
          : {
              state: 'observing' as const,
              role: 'unknown' as const,
              confidence: 0,
              evidenceSeqs: [],
              contradictionSeqs: [],
              evaluatedRevision: -1,
              reasonCodes: []
            };
      },
      reset() {}
    },
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);

  p.record({ seq: 0, source: 'mic', speakerId: 10, text: '请说明你负责的项目和个人职责。' });
  p.record({ seq: 1, source: 'mic', speakerId: 20, text: '我负责现场计划和人员协调，并跟进最终验收。' });
  p.record({ seq: 2, source: 'mic', speakerId: 30, text: '我先确认风险和负责人，再建立每天更新的整改清单。' });
  p.record({ seq: 3, source: 'mic', speakerId: 10, text: '如果整改延期，你会如何处理？' });
  p.record({ seq: 4, source: 'mic', speakerId: 30, text: '我会确认阻塞原因，调整资源和时限，必要时升级并保留问责记录。' });
  p.record({ seq: 5, source: 'mic', speakerId: 20, text: '最终用连续三周的告警和工单数据完成验证。' });
  await p.finalize();

  assert.deepEqual(candidates, [], 'cohort display prior must never feed candidate Auto evidence');
  assert.deepEqual(interviewers, [], 'cohort display prior must never feed interviewer monitor evidence');
  assert.equal(cohortCalls.at(-1)?.final, true);
  assert.deepEqual(
    partitions.at(-1).segments
      .filter((segment: any) => segment.speakerId === 30)
      .map((segment: any) => [segment.seq, segment.role, segment.roleSource]),
    [
      [2, 'candidate', 'cohort'],
      [4, 'candidate', 'cohort']
    ]
  );
});

test('per-turn semantic authority outranks an opposite delegated cohort', async () => {
  const partitions: any[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(
        turns,
        [
          { speakerId: 10, role: 'interviewer', confidence: 0.98 },
          { speakerId: 20, role: 'candidate', confidence: 0.98 },
          { speakerId: 30, role: 'interviewer', confidence: 0.97 }
        ]
      ),
    cohortHarness: {
      async evaluate() {},
      getRole(speakerId) {
        return speakerId === 30
          ? {
              state: 'delegated' as const,
              role: 'candidate' as const,
              confidence: 0.95,
              evidenceSeqs: [2, 4],
              contradictionSeqs: [],
              evaluatedRevision: 4,
              reasonCodes: ['two_pass_consensus']
            }
          : {
              state: 'observing' as const,
              role: 'unknown' as const,
              confidence: 0,
              evidenceSeqs: [],
              contradictionSeqs: [],
              evaluatedRevision: -1,
              reasonCodes: []
            };
      },
      reset() {}
    },
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);

  p.record({ seq: 0, source: 'mic', speakerId: 10, text: '请说明项目背景和你的具体职责。' });
  p.record({ seq: 1, source: 'mic', speakerId: 20, text: '我负责制定计划、协调人员并跟进现场验收。' });
  p.record({ seq: 2, source: 'mic', speakerId: 30, text: '第二位面试官想确认，你本人做出的关键决策是什么？' });
  p.record({ seq: 3, source: 'mic', speakerId: 20, text: '我决定先处理影响消防联动的高风险区域。' });
  await p.finalize();

  const target = partitions.at(-1).segments.find((segment: any) => segment.seq === 2);
  assert.deepEqual([target.role, target.roleSource], ['interviewer', 'semantic-turn']);
  assert.deepEqual(interviewers.map((turn) => turn.seq), [0, 2]);
});

test('display cohort evaluation never delays role-confirmed Auto callbacks', async () => {
  const candidates: SpeakerTurn[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 10, role: 'interviewer', confidence: 0.98 },
        { speakerId: 20, role: 'candidate', confidence: 0.98 }
      ]),
    cohortHarness: {
      async evaluate() {
        await gate;
      },
      getRole() {
        return {
          state: 'observing' as const,
          role: 'unknown' as const,
          confidence: 0,
          evidenceSeqs: [],
          contradictionSeqs: [],
          evaluatedRevision: -1,
          reasonCodes: []
        };
      },
      reset() {}
    },
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onPartition: () => {}
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 10, text: '请说明你在项目中的具体职责。' });
  p.record({ seq: 1, source: 'mic', speakerId: 20, text: '我负责制定计划、协调人员并跟进最终验收结果。' });

  const finalizing = p.finalize();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(candidates.map((turn) => turn.seq), [1]);
  release();
  await finalizing;
});

test('native clusters weak-correct one clear answer without remapping the shared acoustic id', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(
        turns,
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

test('repairs the real Seed answer split without releasing a false interviewer turn', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);

  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 2,
    text: '好，请听第三题。某小区自来水管道总是破裂，如果你是社区工作人员应该怎么解决？'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 1,
    text: '各位考官，作为社区工作人员，我会立即赶赴现场，拉开争执双方并说明应当冷静协商。'
  });
  p.record({
    seq: 2,
    source: 'mic',
    speakerId: 2,
    text: '目前会向双方进行一下询问，首先向居民询问水管破裂频次以及是否通过正规渠道反映。'
  });
  p.record({
    seq: 3,
    source: 'mic',
    speakerId: 1,
    text: '然后向维修人员询问破裂原因，并根据情况协调处理和跟踪复验。'
  });
  p.record({
    seq: 4,
    source: 'mic',
    speakerId: 1,
    text: '最高分八十九分，最低分八十三点五分，二号考生最终成绩为八十点六分。'
  });
  p.record({
    seq: 5,
    source: 'mic',
    speakerId: 2,
    text: '好，请考生确认分数并离场。'
  });
  await p.flush();
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'candidate'],
      [2, 'candidate'],
      [3, 'candidate'],
      [4, 'interviewer'],
      [5, 'interviewer']
    ]
  );
  assert.deepEqual(candidates.map((turn) => turn.seq), [1, 2, 3]);
  assert.deepEqual(
    interviewers.map((turn) => turn.seq),
    [0, 4, 5],
    'a provisional acoustic mismatch must not close Auto as a real interviewer turn'
  );
});

test('keeps a split score announcement on the interviewer role', async () => {
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 2, text: '好，请考生现场候分。' });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 1,
    text: '88分，85.5分，86分，89分，80.5分，86分，83.5分。'
  });
  p.record({
    seq: 2,
    source: 'mic',
    speakerId: 2,
    text: '去掉一个最高分89分，去掉一个最低分83.5分。'
  });
  p.record({
    seq: 3,
    source: 'mic',
    speakerId: 1,
    text: '二号选手最终成绩为86.6分。'
  });
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'interviewer'],
      [2, 'interviewer'],
      [3, 'interviewer']
    ]
  );
});

test('keeps an explicit interviewer handoff between two candidate turns', async () => {
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 1, text: '我先隔离风险区域，再组织工程团队整改。' });
  p.record({ seq: 1, source: 'mic', speakerId: 2, text: '所以你当时如何确认根本原因？' });
  p.record({ seq: 2, source: 'mic', speakerId: 1, text: '我决定先停用故障设备，并要求当天完成复验。' });
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'candidate'],
      [1, 'interviewer'],
      [2, 'candidate']
    ]
  );
});

test('repairs a short connective candidate fragment across sentence boundaries', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 2,
    text: '好，考生请听第一题，对此请谈谈你的理解。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 1,
    text: '那么我们现在年轻的青年干部，国家和党的未来是他们的希望。'
  });
  p.record({
    seq: 2,
    source: 'mic',
    speakerId: 2,
    text: '所以说我们的年轻干部都要打到'
  });
  p.record({
    seq: 3,
    source: 'mic',
    speakerId: 1,
    text: '基础增长才干，心无旁骛地做好自己的本职工作，才能将工作做实做牢。'
  });
  await p.flush();
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'candidate'],
      [2, 'candidate'],
      [3, 'candidate']
    ]
  );
  assert.deepEqual(candidates.map((turn) => turn.seq), [1, 2, 3]);
  assert.deepEqual(interviewers.map((turn) => turn.seq), [0]);
});

test('repairs an interviewer question stem split into the candidate acoustic cluster', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 2,
    text: '好，考生请听第一题，我们下面考察你的分析理解能力。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 1,
    text: '速生树材质疏松，是做不了扁担的，做了就会把担子挑翻。'
  });
  p.record({ seq: 2, source: 'mic', speakerId: 2, text: '对此，请谈谈你的理解。' });
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'interviewer'],
      [2, 'interviewer']
    ]
  );
  assert.deepEqual(candidates.map((turn) => turn.seq), []);
  assert.deepEqual(interviewers.map((turn) => turn.seq), [0, 1, 2]);
});

test('repairs a short interviewer question tail attached to the candidate cluster', async () => {
  const partitions: any[] = [];
  const candidates: SpeakerTurn[] = [];
  const interviewers: SpeakerTurn[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onInterviewerTurn: (turn) => interviewers.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 2,
    text: '好，请听第三题。某小区自来水管道总是破裂，两方发生冲突，如果你是社区的。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 1,
    text: '工作人员应该怎么解决？'
  });
  p.record({
    seq: 2,
    source: 'mic',
    speakerId: 1,
    text: '各位考官，作为社区工作人员，我会立即赶赴现场并先隔离冲突双方。'
  });
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'interviewer'],
      [2, 'candidate']
    ]
  );
  assert.deepEqual(candidates.map((turn) => turn.seq), [2]);
  assert.deepEqual(interviewers.map((turn) => turn.seq), [0, 1]);
});

test('keeps a candidate rhetorical question inside a substantive answer', async () => {
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({
    seq: 0,
    source: 'mic',
    speakerId: 2,
    text: '请说明你会如何调动同事参与消防演练。'
  });
  p.record({
    seq: 1,
    source: 'mic',
    speakerId: 1,
    text: '那么我们应该怎么做呢？首先我会召开动员会，说明演练与人身安全的关系。'
  });
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'candidate']
    ]
  );
});

test('keeps a short first-person answer between two interviewer turns', async () => {
  const partitions: any[] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) =>
      classificationForTurns(turns, [
        { speakerId: 1, role: 'candidate', confidence: 0.98 },
        { speakerId: 2, role: 'interviewer', confidence: 0.99 }
      ]),
    applySpeakerRole: (_speakerId, role) => role,
    resolveTurnRole: (_speakerId, role) => role,
    onCandidateTurn: () => {},
    onPartition: (partition) => partitions.push(partition)
  });
  p.setEnabled(true);
  p.record({ seq: 0, source: 'mic', speakerId: 2, text: '请说明你会如何处理设备故障。' });
  p.record({ seq: 1, source: 'mic', speakerId: 1, text: '我会先隔离现场并组织复验。' });
  p.record({ seq: 2, source: 'mic', speakerId: 2, text: '那么结果如何量化？' });
  await p.finalize();

  assert.deepEqual(
    partitions.at(-1).segments.map((segment: any) => [segment.seq, segment.role]),
    [
      [0, 'interviewer'],
      [1, 'candidate'],
      [2, 'interviewer']
    ]
  );
});

test('one long post-baseline turn requests an immediate semantic correction refresh', async () => {
  const snapshots: SpeakerTurn[][] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) => {
      snapshots.push(turns.map((turn) => ({ ...turn })));
      return classificationForTurns(turns, [
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
  assert.equal(snapshots.length, 2, 'primary and verification passes inspect the same window');

  p.record({
    seq: 2,
    source: 'mic',
    speakerId: 9,
    text: '我还组织夜间盲演，逐项记录各岗位到场时间和处置动作，复盘后调整排班，把平均响应时间从八分钟缩短到五分钟。'
  });
  await p.flush();

  assert.equal(snapshots.length, 4, 'a long new turn must not wait for two unrelated finals');
  assert.deepEqual(snapshots[2].map((turn) => turn.seq), [0, 1, 2]);
  assert.deepEqual(snapshots[3].map((turn) => turn.seq), [0, 1, 2]);
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
      return classificationForTurns(turns, [
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

  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[0].map((turn) => turn.seq), [0, 1, 2, 3]);
  assert.deepEqual(snapshots[1].map((turn) => turn.seq), [0, 1, 2, 3]);
});

test('live role assignment accepts one sufficiently substantive turn per native speaker', async () => {
  const snapshots: SpeakerTurn[][] = [];
  const p = createSpeakerPartitioner({
    classify: async (turns) => {
      snapshots.push(turns.map((turn) => ({ ...turn })));
      return classificationForTurns(turns, [
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
  assert.equal(snapshots.length, 2, 'two independent passes confirm the substantive speech acts');
  assert.deepEqual(snapshots[0].map((turn) => turn.seq), [0, 1]);
  assert.deepEqual(snapshots[1].map((turn) => turn.seq), [0, 1]);

  p.record({ seq: 2, source: 'mic', speakerId: 1, text: '我先停用风险区域，再组织整改和复验。' });
  p.record({ seq: 3, source: 'mic', speakerId: 2, text: '整改结果如何量化和留档？' });
  await p.flush();
  assert.equal(snapshots.length, 2, 'the refresh cadence still waits for three additional turns');
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
  assert.equal(calls, 2);
});

test('a mixed shared-audio lane classifies interviewer and candidate before releasing answer text', async () => {
  const candidates: number[] = [];
  const interviewers: number[] = [];
  let calls = 0;
  const p = createSpeakerPartitioner({
    classify: async (turns) => {
      calls += 1;
      return classificationForTurns(turns, [
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

  assert.equal(calls, 2, 'two independent semantic passes classify the substantial samples');
  assert.deepEqual(interviewers, [0]);
  assert.deepEqual(candidates, [1]);
});
