import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCohortEvidence,
  consensusCohortAudits,
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
