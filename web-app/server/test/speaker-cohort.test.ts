import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCohortAuditInput,
  buildCohortEvidence,
  consensusCohortAudits,
  createSpeakerCohortHarness,
  parseCohortAudit,
  type CohortAudit,
  type CohortEvidencePacket,
  type CohortTurn,
  type ConfirmedTurnRole
} from '../src/speaker-cohort';

function turn(seq: number, speakerId: number, text: string): CohortTurn {
  return { seq, source: 'mic', speakerId, text };
}

const baseTurns: CohortTurn[] = [
  turn(0, 10, '请结合一次具体项目，说明你负责的园区消防整改工作。'),
  turn(1, 20, '我负责三万平方米园区，先核对巡检台账，再组织工程人员完成整改和复验。'),
  turn(2, 11, '第二位面试官想了解，你用什么标准判断整改已经真正完成？'),
  turn(3, 20, '我连续复查三周告警与工单数据，并用消防盲演确认现场响应时间。')
];

const baseConfirmed: ConfirmedTurnRole[] = [
  { seq: 0, role: 'interviewer', confidence: 0.98 },
  { seq: 1, role: 'candidate', confidence: 0.97 },
  { seq: 2, role: 'interviewer', confidence: 0.96 },
  { seq: 3, role: 'candidate', confidence: 0.98 }
];

function eligiblePacket(): CohortEvidencePacket {
  const packet = buildCohortEvidence(
    [
      ...baseTurns,
      turn(4, 30, '我先把每个隐患分配到具体负责人，并约定当天反馈整改照片和复验记录。'),
      turn(5, 10, '如果整改负责人没有按时完成，你会如何处理？'),
      turn(6, 30, '我会先确认阻塞原因，再调整资源和时限，仍未完成就升级到园区负责人并记录问责。')
    ],
    baseConfirmed,
    30
  );
  assert.ok(packet);
  return packet;
}

function audit(
  packet: CohortEvidencePacket,
  role: 'interviewer' | 'candidate' | 'unknown',
  options: Partial<CohortAudit> = {}
): CohortAudit {
  return {
    role,
    confidence: 0.94,
    interviewerFit: role === 'interviewer' ? 0.92 : 0.2,
    candidateFit: role === 'candidate' ? 0.92 : 0.2,
    targetRoles: packet.requiredSeqs.map((seq) => ({ seq, role, confidence: 0.91 })),
    evidenceSeqs: [...packet.requiredSeqs],
    contradictionSeqs: [],
    model: 'deepseek-v4-flash',
    ...options
  };
}

test('new cluster stays ineligible when two fragments belong to one adjacency window', () => {
  const packet = buildCohortEvidence(
    [
      ...baseTurns,
      turn(4, 30, '我先把每个隐患分配到具体负责人并约定整改时限，'),
      turn(5, 30, '然后每天跟进整改照片、复验记录和逾期原因。')
    ],
    baseConfirmed,
    30
  );

  assert.equal(packet, null);
});

test('new cluster becomes eligible only after a second substantive adjacency window', () => {
  const packet = eligiblePacket();

  assert.equal(packet.targetSpeakerId, 30);
  assert.deepEqual(packet.requiredSeqs, [4, 6]);
  assert.equal(packet.interviewerAnchors.length, 2);
  assert.equal(packet.candidateAnchors.length, 2);
  assert.deepEqual(packet.neighbours.map((entry) => entry.seq), [3, 5]);
  assert.equal(packet.revision, 6);
});

test('target cluster cannot use its own confirmed turns to seed either role bank', () => {
  const packet = buildCohortEvidence(
    [
      turn(0, 10, '请说明你承担的具体职责和最终结果。'),
      turn(1, 20, '我负责制定计划、协调人员并跟进最终验收。'),
      turn(2, 30, '我先确认风险和负责人，再形成整改清单并每天跟进。'),
      turn(3, 10, '结果如何验证？'),
      turn(4, 30, '我用连续三周的告警、工单和复验记录确认问题没有复发。')
    ],
    [
      { seq: 0, role: 'interviewer', confidence: 0.98 },
      { seq: 1, role: 'candidate', confidence: 0.97 },
      { seq: 2, role: 'candidate', confidence: 0.99 },
      { seq: 3, role: 'interviewer', confidence: 0.96 },
      { seq: 4, role: 'candidate', confidence: 0.99 }
    ],
    30
  );

  assert.equal(packet, null, 'only one non-target candidate anchor exists');
});

test('parser rejects citations outside the bounded evidence packet', () => {
  const packet = eligiblePacket();
  const parsed = parseCohortAudit(
    JSON.stringify({
      role: 'candidate',
      confidence: 0.99,
      interviewerFit: 0.1,
      candidateFit: 0.95,
      targetRoles: packet.requiredSeqs.map((seq) => ({ seq, role: 'candidate', confidence: 0.95 })),
      evidenceSeqs: [999],
      contradictionSeqs: []
    }),
    packet
  );

  assert.equal(parsed, null);
});

test('parser accepts fenced strict JSON and normalizes duplicate citations', () => {
  const packet = eligiblePacket();
  const parsed = parseCohortAudit(
    `\`\`\`json\n${JSON.stringify({
      role: 'candidate',
      confidence: 0.94,
      interviewerFit: 0.2,
      candidateFit: 0.92,
      targetRoles: packet.requiredSeqs.map((seq) => ({ seq, role: 'candidate', confidence: 0.91 })),
      evidenceSeqs: [4, 6, 4],
      contradictionSeqs: []
    })}\n\`\`\``,
    packet
  );

  assert.deepEqual(parsed?.evidenceSeqs, [4, 6]);
});

test('consensus rejects agreement without the required role-fit margin', () => {
  const packet = eligiblePacket();
  const primary = audit(packet, 'candidate', { candidateFit: 0.84, interviewerFit: 0.72 });
  const verification = audit(packet, 'candidate', { candidateFit: 0.82, interviewerFit: 0.71 });

  assert.equal(consensusCohortAudits(packet, primary, verification), null);
});

test('consensus rejects pass disagreement, missing coverage, and contradictions', () => {
  const packet = eligiblePacket();

  assert.equal(
    consensusCohortAudits(packet, audit(packet, 'candidate'), audit(packet, 'interviewer')),
    null
  );
  assert.equal(
    consensusCohortAudits(
      packet,
      audit(packet, 'candidate'),
      audit(packet, 'candidate', { targetRoles: [{ seq: 4, role: 'candidate', confidence: 0.95 }] })
    ),
    null
  );
  assert.equal(
    consensusCohortAudits(
      packet,
      audit(packet, 'candidate'),
      audit(packet, 'candidate', { contradictionSeqs: [4] })
    ),
    null
  );
  assert.equal(
    consensusCohortAudits(
      packet,
      audit(packet, 'candidate', { evidenceSeqs: [4] }),
      audit(packet, 'candidate', { evidenceSeqs: [4] })
    ),
    null
  );
});

test('consensus accepts complete independent agreement with shared evidence', () => {
  const packet = eligiblePacket();
  const result = consensusCohortAudits(
    packet,
    audit(packet, 'candidate', { confidence: 0.94 }),
    audit(packet, 'candidate', { confidence: 0.91, candidateFit: 0.89, interviewerFit: 0.35 })
  );

  assert.deepEqual(result, {
    speakerId: 30,
    role: 'candidate',
    confidence: 0.91,
    evidenceSeqs: [4, 6],
    contradictionSeqs: []
  });
});

test('consensus accepts provider-shaped contextual citations when every target is independently covered', () => {
  const packet = eligiblePacket();
  const providerEvidence = [1, 3, 5];
  const result = consensusCohortAudits(
    packet,
    audit(packet, 'candidate', { evidenceSeqs: providerEvidence }),
    audit(packet, 'candidate', {
      confidence: 0.91,
      candidateFit: 0.89,
      interviewerFit: 0.35,
      evidenceSeqs: providerEvidence
    })
  );

  assert.deepEqual(result, {
    speakerId: 30,
    role: 'candidate',
    confidence: 0.91,
    evidenceSeqs: [4, 6],
    contradictionSeqs: []
  });
});

test('audit passes reverse balanced evidence order to reduce prompt anchoring', () => {
  const packet = eligiblePacket();
  const primary = buildCohortAuditInput(packet, 'primary');
  const verification = buildCohortAuditInput(packet, 'verification');

  assert.ok(primary.indexOf('[interviewer-evidence]') < primary.indexOf('[candidate-evidence]'));
  assert.ok(verification.indexOf('[candidate-evidence]') < verification.indexOf('[interviewer-evidence]'));
  assert.match(primary, /required-target-seqs=4,6/);
  assert.match(verification, /target-speaker=30/);
});

test('harness delegates only after two independent audits agree', async () => {
  const packet = eligiblePacket();
  const passes: string[] = [];
  const harness = createSpeakerCohortHarness({
    audit: async (received, pass) => {
      passes.push(pass);
      return audit(received, 'candidate');
    }
  });

  await harness.evaluate({
    turns: [...packet.interviewerAnchors, ...packet.candidateAnchors, ...packet.neighbours, ...packet.targets]
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.seq === entry.seq) === index)
      .sort((left, right) => left.seq - right.seq),
    confirmed: baseConfirmed
  });

  assert.deepEqual(passes.sort(), ['primary', 'verification']);
  assert.deepEqual(harness.getRole(30), {
    state: 'delegated',
    role: 'candidate',
    confidence: 0.94,
    evidenceSeqs: [4, 6],
    contradictionSeqs: [],
    evaluatedRevision: 6
  });
});

test('harness never re-evaluates an unchanged evidence revision', async () => {
  const turns = [
    ...baseTurns,
    turn(4, 30, '我先把每个隐患分配到具体负责人，并约定当天反馈整改照片和复验记录。'),
    turn(5, 10, '如果整改负责人没有按时完成，你会如何处理？'),
    turn(6, 30, '我会先确认阻塞原因，再调整资源和时限，仍未完成就升级到园区负责人并记录问责。')
  ];
  let calls = 0;
  const harness = createSpeakerCohortHarness({
    audit: async (packet) => {
      calls += 1;
      return audit(packet, 'candidate');
    }
  });

  await harness.evaluate({ turns, confirmed: baseConfirmed });
  await harness.evaluate({ turns, confirmed: baseConfirmed });

  assert.equal(calls, 2);
});

test('two confirmed opposite target turns revoke delegation without an immediate flip', async () => {
  const initialTurns = [
    ...baseTurns,
    turn(4, 30, '我先把每个隐患分配到具体负责人，并约定当天反馈整改照片和复验记录。'),
    turn(5, 10, '如果整改负责人没有按时完成，你会如何处理？'),
    turn(6, 30, '我会先确认阻塞原因，再调整资源和时限，仍未完成就升级到园区负责人并记录问责。')
  ];
  let calls = 0;
  const harness = createSpeakerCohortHarness({
    audit: async (packet) => {
      calls += 1;
      return audit(packet, 'candidate');
    }
  });
  await harness.evaluate({ turns: initialTurns, confirmed: baseConfirmed });

  const contradictedTurns = [
    ...initialTurns,
    turn(7, 30, '请具体说明这项整改中你本人做出的关键取舍是什么？'),
    turn(8, 20, '我选择先处理高风险区域，并暂缓不会影响消防联动的普通工单。'),
    turn(9, 30, '如果资源只能支持一个方案，你为什么优先选择高风险区域？')
  ];
  await harness.evaluate({
    turns: contradictedTurns,
    confirmed: [
      ...baseConfirmed,
      { seq: 7, role: 'interviewer', confidence: 0.96 },
      { seq: 9, role: 'interviewer', confidence: 0.95 }
    ]
  });

  assert.equal(calls, 2, 'revocation must wait for fresh evidence before evaluating an opposite role');
  assert.deepEqual(harness.getRole(30), {
    state: 'contested',
    role: 'unknown',
    confidence: 0,
    evidenceSeqs: [],
    contradictionSeqs: [7, 9],
    evaluatedRevision: 9
  });
});

test('reset invalidates an in-flight cohort decision', async () => {
  const turns = [
    ...baseTurns,
    turn(4, 30, '我先把每个隐患分配到具体负责人，并约定当天反馈整改照片和复验记录。'),
    turn(5, 10, '如果整改负责人没有按时完成，你会如何处理？'),
    turn(6, 30, '我会先确认阻塞原因，再调整资源和时限，仍未完成就升级到园区负责人并记录问责。')
  ];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const harness = createSpeakerCohortHarness({
    audit: async (packet) => {
      await gate;
      return audit(packet, 'candidate');
    }
  });

  const evaluating = harness.evaluate({ turns, confirmed: baseConfirmed });
  harness.reset();
  release();
  await evaluating;

  assert.equal(harness.getRole(30).state, 'observing');
});

test('harness audits only voiceprints that appear after the two established clusters', async () => {
  const turns = [
    turn(0, 10, '第一位面试官请候选人说明园区整改项目和个人职责。'),
    turn(1, 20, '我负责制定整改计划、协调工程人员并跟进最终验收。'),
    turn(2, 10, '请说明你如何识别最高风险的消防隐患。'),
    turn(3, 20, '我先检查联动设备和疏散通道，再按影响范围划分风险等级。'),
    turn(4, 30, '我还会把每个隐患分配到具体负责人，并约定整改时限和复验标准。'),
    turn(5, 10, '如果负责人延期，你会如何处理和记录？'),
    turn(6, 30, '我会确认阻塞原因、调整资源，仍未完成就升级并保留问责记录。'),
    turn(7, 40, '第二位面试官想进一步确认，在资源受限时你本人做出的关键取舍是什么？'),
    turn(8, 20, '我决定先处理影响消防联动的高风险区域，再处理普通工单。'),
    turn(9, 40, '你具体使用哪些连续数据证明这个优先级最终降低了现场风险并且没有反弹？')
  ];
  const confirmed: ConfirmedTurnRole[] = [
    { seq: 0, role: 'interviewer', confidence: 0.98 },
    { seq: 1, role: 'candidate', confidence: 0.98 },
    { seq: 2, role: 'interviewer', confidence: 0.97 },
    { seq: 3, role: 'candidate', confidence: 0.97 },
    { seq: 4, role: 'candidate', confidence: 0.96 },
    { seq: 5, role: 'interviewer', confidence: 0.97 },
    { seq: 6, role: 'candidate', confidence: 0.96 },
    { seq: 7, role: 'interviewer', confidence: 0.96 },
    { seq: 8, role: 'candidate', confidence: 0.97 },
    { seq: 9, role: 'interviewer', confidence: 0.96 }
  ];
  const auditedIds: number[] = [];
  const harness = createSpeakerCohortHarness({
    audit: async (packet) => {
      auditedIds.push(packet.targetSpeakerId);
      return audit(packet, packet.targetSpeakerId === 40 ? 'interviewer' : 'candidate');
    }
  });

  await harness.evaluate({ turns, confirmed });

  assert.deepEqual([...new Set(auditedIds)].sort((left, right) => left - right), [30, 40]);
});
