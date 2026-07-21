# P7/P8 User Operations and Voiceprint MP3 Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate P7 and P8 user-operations interview profiles, make whole native voiceprints authoritative for roles and Auto-question evidence, and verify the result with the full supplied 8m13s recording at 1× through Doubao Seed ASR 2.0.

**Architecture:** Reuse the existing two-pass `speaker-cohort.ts` harness, but evaluate every native speaker ID and publish explicit assignment state with each atomic speaker partition. Per-turn semantic classification remains an evidence source for native IDs and the authority only for text-only turns. The renderer stores one role map per native ID, and the existing Auto trigger receives only candidate turns whose native ID has been delegated or manually assigned.

**Tech Stack:** TypeScript, Node 20, WebSocket, React 18, Vitest, Node test runner, DeepSeek V4 Flash, Doubao Seed ASR 2.0, Vite.

## Global Constraints

- Work directly on `main`; commit and push each independently testable checkpoint.
- Native `speakerId` is the role unit: one native ID may never appear as both interviewer and candidate in an accepted partition.
- Ambiguous or contested IDs stay `unknown`/`待确认` and are excluded from automatic question release.
- Automated role changes must pass the existing two independent DeepSeek V4 Flash audits at confidence `0.88` and fit margin `0.18`.
- A delegated role cannot flip directly; it must first become contested and later pass a fresh promotion audit.
- Manual whole-voiceprint assignments always win.
- Multiple native IDs may share the interviewer or candidate role.
- Text-only turns keep per-turn semantic classification.
- Balanced Auto defaults remain 120 new candidate characters, 3-second semantic quiet, 20-second cooldown, and the 3-wait/280-character liveness guard.
- P7 and P8 are distinct picker records and distinct Expert contexts; both scorecards total exactly 100.
- The supplied source file is never modified; live tests use a temporary mono 16 kHz PCM16 WAV.
- Update the matching Obsidian implementation notes after behavior changes.

---

### Task 1: Add separate P7 and P8 built-in interview profiles

**Files:**
- Modify: `web-app/web/src/desktop/jobProfiles.test.ts`
- Modify: `web-app/web/src/desktop/jobProfiles.ts`

**Interfaces:**
- Produces: `USER_OPERATIONS_P7_PROFILE: JobProfile`
- Produces: `USER_OPERATIONS_P8_PROFILE: JobProfile`
- Extends: `JOB_PROFILES` with `user-operations-p7` and `user-operations-p8`
- Preserves: `buildInterviewGuideLines(profile: JobProfile): string[]`

- [ ] **Step 1: Write failing profile and search tests**

Add imports and assertions that make the level split observable:

```ts
import {
  JOB_PROFILES,
  PROPERTY_MANAGER_PROFILE,
  USER_OPERATIONS_P7_PROFILE,
  USER_OPERATIONS_P8_PROFILE,
  buildInterviewGuideLines,
  searchJobProfiles
} from './jobProfiles';

describe('User Operations P7/P8 job profiles', () => {
  test('keeps P7 and P8 as complete independent Expert contexts', () => {
    expect(USER_OPERATIONS_P7_PROFILE).toMatchObject({
      id: 'user-operations-p7',
      title: '用户运营专家（P7）',
      reportsTo: '用户运营负责人'
    });
    expect(USER_OPERATIONS_P8_PROFILE).toMatchObject({
      id: 'user-operations-p8',
      title: '用户运营专家（P8）',
      reportsTo: '业务负责人或用户运营负责人'
    });
    expect(USER_OPERATIONS_P7_PROFILE.jobDescription).toContain('独立负责一个复杂用户运营域');
    expect(USER_OPERATIONS_P8_PROFILE.jobDescription).toContain('跨业务、跨产品或跨区域');
    expect(USER_OPERATIONS_P7_PROFILE.jobDescription).not.toContain('用户运营专家（P8）');
    expect(USER_OPERATIONS_P8_PROFILE.jobDescription).not.toContain('用户运营专家（P7）');
    expect(USER_OPERATIONS_P7_PROFILE.interviewGuide.reduce((n, item) => n + item.weight, 0)).toBe(100);
    expect(USER_OPERATIONS_P8_PROFILE.interviewGuide.reduce((n, item) => n + item.weight, 0)).toBe(100);
    expect(buildInterviewGuideLines(USER_OPERATIONS_P7_PROFILE).join('\n')).toContain('可验证证据');
    expect(buildInterviewGuideLines(USER_OPERATIONS_P8_PROFILE).join('\n')).toContain('警示信号');
  });

  test('fuzzy search distinguishes levels and returns both for generic intent', () => {
    expect(searchJobProfiles('P7').map((profile) => profile.id)).toEqual(['user-operations-p7']);
    expect(searchJobProfiles('P8').map((profile) => profile.id)).toEqual(['user-operations-p8']);
    expect(searchJobProfiles('用户运营').map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['user-operations-p7', 'user-operations-p8'])
    );
    expect(JOB_PROFILES.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['property-manager', 'user-operations-p7', 'user-operations-p8'])
    );
  });
});
```

- [ ] **Step 2: Run the focused web test and verify RED**

Run:

```bash
cd web-app
npm exec --workspace @open-cluely/web vitest run src/desktop/jobProfiles.test.ts
```

Expected: FAIL because both `USER_OPERATIONS_*_PROFILE` exports are missing.

- [ ] **Step 3: Add the two complete records**

In `jobProfiles.ts`, add two standalone JD strings using the exact Chinese responsibilities and requirements in `docs/superpowers/specs/2026-07-21-p7p8-user-operations-voiceprint-design.md`. Add complete guide entries using these exact IDs and weights:

```ts
function userOperationsGuideItem(
  id: string,
  competency: string,
  weight: number,
  primaryQuestion: string,
  followUps: readonly string[],
  evidenceSignals: readonly string[],
  redFlags: readonly string[]
): InterviewGuideItem {
  return { id, competency, weight, primaryQuestion, followUps, evidenceSignals, redFlags };
}

const P7_USER_OPERATIONS_GUIDE: readonly InterviewGuideItem[] = [
  userOperationsGuideItem(
    'p7-strategy-diagnosis', '战略理解与问题诊断', 12,
    '请选一个你独立负责的复杂运营域，说明接手时的业务目标、用户问题、关键约束和你的前三项取舍。',
    ['哪些信息改变了你的原始判断？', '为什么没有优先做另外两个看起来更快的方案？'],
    ['说明基线、约束、优先级和决策依据', '结果能追溯到候选人的具体判断'],
    ['只复述通用方法论', '无法说明个人决策权或取舍']
  ),
  userOperationsGuideItem(
    'p7-lifecycle-growth', '生命周期增长与留存', 15,
    '讲一次你通过用户分层和生命周期策略改善留存或复购的案例。',
    ['分层规则为什么有效？', '短期转化和长期留存冲突时如何取舍？'],
    ['有清楚的分层逻辑与前后留存数据', '能说明触达、产品和运营动作的增量贡献'],
    ['只讲活动曝光或总新增', '没有长期留存或复购验证']
  ),
  userOperationsGuideItem(
    'p7-data-experiment', '数据、指标与实验', 15,
    '复盘一个关键增长实验：假设、样本、对照、停止条件、增量结果和最终决策分别是什么？',
    ['如何排除同期渠道或产品变化？', '哪个指标最可能误导团队？'],
    ['区分相关性与因果增量', '能解释样本、显著性、成本和副作用'],
    ['只报整体增长百分比', '实验口径或对照组说不清']
  ),
  userOperationsGuideItem(
    'p7-user-insight', '用户洞察与分群', 10,
    '讲一次用户研究或行为数据推翻团队原有假设，并改变运营优先级的经历。',
    ['样本是否具有代表性？', '洞察如何落到具体方案并被验证？'],
    ['定性与定量证据互相校验', '洞察明确改变了决策且有验证结果'],
    ['把少量反馈当作普遍事实', '洞察停留在报告而未改变动作']
  ),
  userOperationsGuideItem(
    'p7-mechanism-productization', '机制建设与产品化', 12,
    '选一个你从人工运营推进到流程、工具或产品化的机制，说明为什么值得建设以及实际杠杆。',
    ['上线前后人效和效果怎样比较？', '哪些能力仍然需要人工判断？'],
    ['有复用范围、人效或稳定性数据', '能说明产品化边界与迭代机制'],
    ['把一次 SOP 文档称为平台建设', '没有使用率或产出改善证据']
  ),
  userOperationsGuideItem(
    'p7-cross-functional', '复杂项目与跨团队推动', 12,
    '讲一次产品、数据或市场团队目标不一致时，你如何推动关键运营项目落地。',
    ['真正的冲突是什么？', '你本人改变了哪项决策或资源安排？'],
    ['说明利益相关方、冲突、治理节奏和升级路径', '有可验证的落地结果'],
    ['只说加强沟通', '依赖上级拍板且本人没有方案']
  ),
  userOperationsGuideItem(
    'p7-ownership', '独立担当与结果所有权', 12,
    '选择简历中最能代表你 P7 水平的结果，逐项说明个人责任、关键动作、团队贡献和最终结果。',
    ['如果没有你，哪项结果不会发生？', '最重要的一次错误判断是什么？'],
    ['清楚区分本人、团队和上级贡献', '能承担失败并说明纠偏'],
    ['持续使用“我们”回避责任', '只有结果数字，没有个人决策链']
  ),
  userOperationsGuideItem(
    'p7-commercial', '商业化、LTV 与 ROI', 7,
    '讲一次增长目标和成本或 LTV 发生冲突时，你如何决定继续、调整或停止。',
    ['完整成本包含哪些部分？', '回收周期和机会成本如何估算？'],
    ['说明增量收入、成本、LTV 和回收周期', '有明确停止或调整标准'],
    ['只看 GMV 或新增用户', '忽略补贴、渠道或长期流失成本']
  ),
  userOperationsGuideItem(
    'p7-risk', '风险、合规与长期体验', 5,
    '讲一次增长方案触及隐私、内容、品牌或用户体验边界时，你如何处理。',
    ['哪条红线不能用业务收益交换？', '上线后怎样监控风险？'],
    ['主动识别风险并建立监控和处置', '能平衡增长与长期信任'],
    ['把合规完全交给法务', '以短期结果合理化用户伤害']
  )
];

const P8_USER_OPERATIONS_GUIDE: readonly InterviewGuideItem[] = [
  userOperationsGuideItem(
    'p8-portfolio-strategy', '跨域战略与组合取舍', 18,
    '请复盘一次你定义跨业务用户运营战略的过程：结构性问题、组合选择、资源优先级和多周期结果是什么？',
    ['你主动放弃了什么？', '环境变化后为什么这套战略仍然成立或如何调整？'],
    ['连接公司战略、用户价值和组合资源', '有跨周期、跨业务的可归因结果'],
    ['用年度计划代替战略取舍', '无法说明机会成本或停做项']
  ),
  userOperationsGuideItem(
    'p8-org-resources', '组织领导与资源配置', 15,
    '讲一次你为用户运营方向重配预算、人才或组织分工，并影响高层决策的经历。',
    ['反对者的核心依据是什么？', '资源调整后组织能力发生了什么变化？'],
    ['说明决策层级、资源规模和影响路径', '结果不仅依赖候选人个人救火'],
    ['把汇报材料等同于高层影响', '没有人才或组织能力的持续变化']
  ),
  userOperationsGuideItem(
    'p8-lifecycle-growth', '生命周期增长与留存', 12,
    '你如何为多个产品或业务建立统一又允许差异化的生命周期经营框架？',
    ['哪些口径必须统一，哪些必须本地化？', '如何避免局部转化伤害整体 LTV？'],
    ['有跨域分层、指标和治理边界', '证明长期用户价值而非单点活动结果'],
    ['只复制一个业务的打法', '无法处理业务间用户和指标冲突']
  ),
  userOperationsGuideItem(
    'p8-data-governance', '数据治理与战略实验', 12,
    '讲一次多个团队对增长归因结论不一致时，你如何建立决策口径和实验治理。',
    ['谁拥有最终口径？', '何时应停止实验并作出战略决策？'],
    ['统一因果、增量、成本和停止条件', '治理机制被多个团队持续采用'],
    ['依靠单一看板消除分歧', '无法解释数据偏差或实验外推限制']
  ),
  userOperationsGuideItem(
    'p8-platform-scale', '平台、机制与规模化', 12,
    '选一个你主导的平台或机制建设，说明它如何让多个团队持续产出而不是依赖少数专家。',
    ['平台采用率和真实杠杆如何衡量？', '哪些需求被你明确拒绝，为什么？'],
    ['有多团队复用、人效和结果指标', '能说明产品边界、治理和持续迭代'],
    ['把工具上线当作规模化完成', '平台没有采用率或业务增量']
  ),
  userOperationsGuideItem(
    'p8-cross-business', '跨业务影响与复杂治理', 12,
    '讲一次多个业务负责人目标冲突时，你如何形成共同决策并让执行真正发生。',
    ['你使用了什么治理和升级机制？', '最终谁承担了什么成本？'],
    ['识别权责、利益和决策机制', '有跨团队执行与结果闭环'],
    ['只靠关系协调', '所有冲突最终都交给最高负责人']
  ),
  userOperationsGuideItem(
    'p8-structural-insight', '用户洞察与结构性机会', 7,
    '讲一次你识别到尚未被组织重视的结构性用户机会，并推动战略或资源发生改变。',
    ['如何证明它不是短期噪声？', '哪项反证会让你放弃该机会？'],
    ['多源证据支持机会规模和持续性', '洞察影响战略与资源而非只产生报告'],
    ['追逐行业热点', '没有反证条件或机会规模估算']
  ),
  userOperationsGuideItem(
    'p8-commercial', '商业化、LTV 与 ROI', 7,
    '你如何管理一组用户运营投入的组合回报，并决定增投、维持或退出？',
    ['如何比较不同业务的回报周期？', '品牌和体验价值怎样进入决策？'],
    ['有组合 ROI、LTV、风险和机会成本', '资源动作与多周期结果一致'],
    ['只按当期收入排序', '无法处理长期价值和短期财务冲突']
  ),
  userOperationsGuideItem(
    'p8-risk', '风险、合规与长期体验', 5,
    '讲一次高增长机会伴随重大隐私、内容、品牌或体验风险时，你建立了什么治理边界。',
    ['什么情况下你会否决业务负责人？', '重大风险怎样预警和升级？'],
    ['有组织级边界、监控、责任和处置机制', '能证明长期信任进入资源决策'],
    ['只依赖审批流程', '风险发生后才被动补救']
  )
];

export const USER_OPERATIONS_P7_PROFILE: JobProfile = {
  id: 'user-operations-p7',
  title: '用户运营专家（P7）',
  department: '用户运营 / 增长与体验',
  reportsTo: '用户运营负责人',
  summary: '独立负责复杂用户运营域，把业务目标转化为分层、生命周期策略、实验和可复用机制',
  jobDescription: USER_OPERATIONS_P7_JD,
  interviewerPreparation: [
    '核验候选人的决策权、团队边界、预算、周期和可归因结果。',
    '核对增长案例的基线、实验设计、增量口径、成本、LTV 与副作用。',
    '核验一个失败或停做案例中的错误假设、沉没成本与纠偏信号。',
    '确认候选人真正沉淀过可复用机制，而不是依赖一次活动或上级资源。',
    '优先追问事实、个人动作、判断依据和证据。'
  ],
  interviewGuide: P7_USER_OPERATIONS_GUIDE
};

export const USER_OPERATIONS_P8_PROFILE: JobProfile = {
  id: 'user-operations-p8',
  title: '用户运营专家（P8）',
  department: '用户运营 / 增长与体验',
  reportsTo: '业务负责人或用户运营负责人',
  summary: '定义跨业务用户运营方向与资源优先级，通过组织、平台和机制获得规模化结果',
  jobDescription: USER_OPERATIONS_P8_JD,
  interviewerPreparation: [
    '核验战略案例的决策范围、参与层级、资源规模、机会成本和最终归因。',
    '核对跨业务增长案例的组合基线、治理机制、资源取舍及持续结果。',
    '核验战略失败或主动停做案例中反证自身判断和推动组织纠偏的能力。',
    '区分个人救火与可复制的组织、平台或人才能力。',
    '追问高层分歧、风险边界和长期副作用。'
  ],
  interviewGuide: P8_USER_OPERATIONS_GUIDE
};

export const JOB_PROFILES: readonly JobProfile[] = [
  PROPERTY_MANAGER_PROFILE,
  USER_OPERATIONS_P7_PROFILE,
  USER_OPERATIONS_P8_PROFILE
];
```

The two JD string constants contain the complete standalone responsibilities and requirements from the approved design specification; the guide arrays above are copied verbatim.

- [ ] **Step 4: Run focused and full web tests**

Run:

```bash
cd web-app
npm exec --workspace @open-cluely/web vitest run src/desktop/jobProfiles.test.ts
npm test --workspace @open-cluely/web
```

Expected: PASS; no JD picker regressions.

- [ ] **Step 5: Commit and push the profile checkpoint**

```bash
git add web-app/web/src/desktop/jobProfiles.ts web-app/web/src/desktop/jobProfiles.test.ts
git commit -m "feat: add P7 and P8 user operations profiles"
git push origin main
```

---

### Task 2: Add explicit whole-voiceprint assignment contracts

**Files:**
- Modify: `web-app/packages/contract/index.d.ts:61-80,322-327`
- Modify: `web-app/server/src/speaker-partitioner.ts:75-95`
- Modify: `web-app/web/src/lib/messages.test.ts`
- Modify: `web-app/web/src/lib/messages.ts:238-284`

**Interfaces:**
- Produces: `SpeakerAssignmentState`
- Produces: `SpeakerAssignmentRoleSource`
- Produces: `SpeakerAssignment`
- Extends: `speaker-partition.speakerAssignments`

- [ ] **Step 1: Write failing wire-parser tests**

Add a valid full assignment and invalid duplicate-ID cases:

```ts
const valid = parseServerMessage(JSON.stringify({
  type: 'speaker-partition',
  status: 'live',
  model: 'deepseek-v4-flash',
  speakerAssignments: [{
    speakerId: 7,
    role: 'candidate',
    state: 'delegated',
    roleSource: 'cohort',
    confidence: 0.93,
    evidenceVersion: 11,
    updatedAtMs: 4200,
    reasonCodes: ['two_pass_consensus']
  }],
  segments: [{
    seq: 11,
    speakerId: 7,
    role: 'candidate',
    roleSource: 'cohort',
    text: '我负责了这个项目。'
  }]
}));
expect(valid?.type === 'speaker-partition' ? valid.speakerAssignments[0].state : null)
  .toBe('delegated');

const duplicate = parseServerMessage(JSON.stringify({
  type: 'speaker-partition',
  status: 'live',
  model: 'deepseek-v4-flash',
  speakerAssignments: [
    { speakerId: 7, role: 'candidate', state: 'delegated', roleSource: 'cohort', confidence: 0.9, evidenceVersion: 2, updatedAtMs: 1, reasonCodes: [] },
    { speakerId: 7, role: 'interviewer', state: 'delegated', roleSource: 'cohort', confidence: 0.9, evidenceVersion: 2, updatedAtMs: 1, reasonCodes: [] }
  ],
  segments: []
}));
expect(duplicate).toBeNull();
```

- [ ] **Step 2: Run the parser test and verify RED**

```bash
cd web-app
npm exec --workspace @open-cluely/web vitest run src/lib/messages.test.ts
```

Expected: FAIL because `speakerAssignments` is not in the contract/parser.

- [ ] **Step 3: Add types and strict parsing**

Add to `index.d.ts` and mirror the same type in the server import surface:

```ts
export type SpeakerAssignmentState = 'observing' | 'delegated' | 'contested' | 'manual';
export type SpeakerAssignmentRoleSource = 'manual' | 'cohort' | 'unknown';

export interface SpeakerAssignment {
  speakerId: number;
  role: SpeakerRole;
  state: SpeakerAssignmentState;
  roleSource: SpeakerAssignmentRoleSource;
  confidence: number;
  evidenceVersion: number;
  updatedAtMs: number;
  reasonCodes: string[];
}
```

Extend the server message:

```ts
| {
    type: 'speaker-partition';
    status: 'live' | 'final';
    model: string;
    segments: SpeakerPartitionSegment[];
    speakerAssignments: SpeakerAssignment[];
  }
```

In `messages.ts`, parse every numeric field as finite/non-negative, accept only the four states and three assignment sources, reject duplicate speaker IDs, and reject a segment whose role conflicts with its matching assignment. For compatibility with an older server during a rolling rebuild, an absent `speakerAssignments` field parses as an empty list; a present malformed list rejects the message.

- [ ] **Step 4: Run parser and type checks**

```bash
cd web-app
npm exec --workspace @open-cluely/web vitest run src/lib/messages.test.ts
npm run typecheck --workspace @open-cluely/server
npm run build --workspace @open-cluely/web
```

Expected: PASS.

- [ ] **Step 5: Commit and push the contract checkpoint**

```bash
git add web-app/packages/contract/index.d.ts web-app/server/src/speaker-partitioner.ts web-app/web/src/lib/messages.ts web-app/web/src/lib/messages.test.ts
git commit -m "feat: add whole-voiceprint assignment contract"
git push origin main
```

---

### Task 3: Promote the cohort harness from extra-cluster display aid to all-ID role ledger

**Files:**
- Modify: `web-app/server/test/speaker-cohort.test.ts`
- Modify: `web-app/server/src/speaker-cohort.ts:63-90,437-575`

**Interfaces:**
- Extends: `ClusterCohortState.reasonCodes: string[]`
- Preserves: `SpeakerCohortHarness.evaluate(input): Promise<void>`
- Preserves: `SpeakerCohortHarness.getRole(speakerId): ClusterCohortState`

- [ ] **Step 1: Write failing all-ID, revocation, and final-retry tests**

Add tests with speaker IDs `0` and `1` proving both the current `.slice(2)` behavior and the external-anchor bootstrap deadlock are gone:

```ts
test('audits the first two native speaker IDs instead of only extra clusters', async () => {
  const seen: number[] = [];
  const turns = [
    turn(0, 0, '请说明你负责的用户增长项目、个人职责和最终结果。'),
    turn(1, 1, '我负责用户分层、召回策略和实验复盘，留存率提升了十二个百分点。'),
    turn(2, 0, '这个提升如何排除自然波动，并确认来自你的策略？'),
    turn(3, 1, '我设置对照组并连续观察四周，增量稳定后再扩大到全部用户。')
  ];
  const confirmed: ConfirmedTurnRole[] = [
    { seq: 0, role: 'interviewer', confidence: 0.98 },
    { seq: 1, role: 'candidate', confidence: 0.97 },
    { seq: 2, role: 'interviewer', confidence: 0.98 },
    { seq: 3, role: 'candidate', confidence: 0.97 }
  ];
  const harness = createSpeakerCohortHarness({
    audit: async (packet) => {
      seen.push(packet.targetSpeakerId);
      const role = packet.targetSpeakerId === 0 ? 'interviewer' : 'candidate';
      return audit(packet, role);
    }
  });
  await harness.evaluate({ turns, confirmed });
  assert.deepEqual(new Set(seen), new Set([0, 1]));
  assert.equal(harness.getRole(0).role, 'interviewer');
  assert.equal(harness.getRole(1).role, 'candidate');
});

test('revokes a whole delegated ID before allowing an opposite promotion', async () => {
  const turns = [
    ...baseTurns,
    turn(4, 9, '我负责确定召回人群、实验分组和预算，并每天跟踪新增留存。'),
    turn(5, 10, '实验结果如何验证？'),
    turn(6, 9, '我用四周留存和对照组增量验证，并排除了同期渠道活动影响。')
  ];
  const confirmed = [
    ...baseConfirmed,
    { seq: 4, role: 'candidate' as const, confidence: 0.97 },
    { seq: 5, role: 'interviewer' as const, confidence: 0.97 },
    { seq: 6, role: 'candidate' as const, confidence: 0.97 }
  ];
  const harness = createSpeakerCohortHarness({
    audit: async (packet) => audit(packet, 'candidate')
  });
  await harness.evaluate({ turns, confirmed });
  assert.equal(harness.getRole(9).state, 'delegated');
  await harness.evaluate({
    turns: [
      ...turns,
      turn(7, 9, '我想追问这个留存口径为什么选择四周？'),
      turn(8, 20, '因为业务复购周期主要集中在二十八天。'),
      turn(9, 9, '如果去掉渠道自然流量，增量结果还成立吗？')
    ],
    confirmed: [
      ...confirmed,
      { seq: 7, role: 'interviewer', confidence: 0.96 },
      { seq: 8, role: 'candidate', confidence: 0.96 },
      { seq: 9, role: 'interviewer', confidence: 0.96 }
    ]
  });
  const revoked = harness.getRole(9);
  assert.equal(revoked.state, 'contested');
  assert.equal(revoked.role, 'unknown');
  assert.deepEqual(revoked.contradictionSeqs, [7, 9]);
});
```

Also test that `final:true` retries an observing state at the same evidence revision once, while a delegated state remains stable unless two contradictions revoke it.

- [ ] **Step 2: Run the cohort test and verify RED**

```bash
cd web-app
npx tsx --test server/test/speaker-cohort.test.ts
```

Expected: FAIL because IDs 0/1 are skipped and reason/final retry state is absent.

- [ ] **Step 3: Implement all-ID evaluation and bounded reason codes**

Replace the sliced ID list:

```ts
const speakerIds = [...new Set(
  input.turns.flatMap((turn) =>
    typeof turn.speakerId === 'number' ? [turn.speakerId] : []
  )
)];
```

Move `confirmedTargetRoles` before the anchor gate and allow one of two safe evidence modes:

```ts
const confirmedTargetRoles = confirmed
  .filter((entry) => targetSeqs.has(entry.seq) && entry.confidence >= 0.8)
  .sort((left, right) => left.seq - right.seq);
const seededRole = confirmedTargetRoles[0]?.role ?? 'unknown';
const hasStableTargetSeed =
  seededRole !== 'unknown' &&
  confirmedTargetRoles.length >= MIN_COHORT_UTTERANCES &&
  confirmedTargetRoles.every((entry) => entry.role === seededRole) &&
  neighbours.length >= MIN_COHORT_UTTERANCES;
const hasBalancedExternalAnchors =
  interviewerAnchors.length >= MIN_ROLE_ANCHORS &&
  candidateAnchors.length >= MIN_ROLE_ANCHORS;
if (!hasStableTargetSeed && !hasBalancedExternalAnchors) return null;
```

This bootstrap uses two independently confirmed semantic target turns plus relational neighbours; it does not grant the target role directly. The two cohort audits still must agree at the normal confidence and fit thresholds.

Extend state construction:

```ts
function emptyCohortState(
  state: Extract<ClusterCohortStatus, 'observing' | 'contested'> = 'observing',
  evaluatedRevision = -1,
  contradictionSeqs: number[] = [],
  reasonCodes: string[] = []
): ClusterCohortState {
  return {
    state,
    role: 'unknown',
    confidence: 0,
    evidenceSeqs: [],
    contradictionSeqs: [...contradictionSeqs],
    evaluatedRevision,
    reasonCodes: [...reasonCodes]
  };
}
```

Use only bounded codes: `insufficient_evidence`, `audit_no_consensus`, `two_pass_consensus`, and `opposite_role_contradictions`. Do not expose model reasoning. Do not clear the entire state map on finalization; permit a final retry for an observing/contested ID without changing a delegated ID directly.

Update every injected `SpeakerCohortHarness.getRole` test stub to return `reasonCodes: []` (or the exact expected bounded code) so the extended state type remains explicit throughout the partitioner tests.

- [ ] **Step 4: Run focused and full server tests**

```bash
cd web-app
npx tsx --test server/test/speaker-cohort.test.ts
npm test --workspace @open-cluely/server
```

Expected: PASS.

- [ ] **Step 5: Commit and push the cohort-ledger checkpoint**

```bash
git add web-app/server/src/speaker-cohort.ts web-app/server/test/speaker-cohort.test.ts
git commit -m "feat: delegate every native voiceprint as one role"
git push origin main
```

---

### Task 4: Make whole voiceprints authoritative for partitions and Auto questions

**Files:**
- Modify: `web-app/server/test/speaker-partitioner.test.ts`
- Modify: `web-app/server/src/speaker-partitioner.ts:96-120,711-996`
- Modify: `web-app/server/test/ws-auto-question.test.ts`
- Modify: `web-app/server/src/ws.ts:1205-1250`

**Interfaces:**
- Extends: `SpeakerPartition.speakerAssignments`
- Uses: `applySpeakerRole(speakerId, role)` to stamp future ASR finals
- Preserves: native `onCandidateTurn`/`onInterviewerTurn` callbacks, but only after whole-ID delegation/manual assignment
- Preserves: text-only per-turn callback behavior

- [ ] **Step 1: Replace the obsolete per-turn-authority test with failing whole-ID invariants**

Delete the expectation named `per-turn semantic authority outranks an opposite delegated cohort`. Add:

```ts
test('one delegated native voiceprint owns every historical and future turn', async () => {
  const candidates: number[] = [];
  const interviewers: number[] = [];
  const partitions: SpeakerPartition[] = [];
  const partitioner = createSpeakerPartitioner({
    classify: async (turns) => classificationForTurns(
      turns,
      [
        { speakerId: 4, role: 'interviewer', confidence: 0.98 },
        { speakerId: 8, role: 'candidate', confidence: 0.98 }
      ],
      [{ seq: 2, role: 'interviewer', confidence: 0.99 }]
    ),
    cohortHarness: {
      async evaluate() {},
      getRole(speakerId) {
        const role = speakerId === 4 ? 'candidate' as const : 'interviewer' as const;
        return {
          state: 'delegated' as const,
          role,
          confidence: 0.95,
          evidenceSeqs: speakerId === 4 ? [0, 2] : [1, 3],
          contradictionSeqs: [],
          evaluatedRevision: 3,
          reasonCodes: ['two_pass_consensus']
        };
      },
      reset() {}
    },
    applySpeakerRole: (_id, role) => role,
    resolveTurnRole: (_id, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn.seq),
    onInterviewerTurn: (turn) => interviewers.push(turn.seq),
    onPartition: (partition) => partitions.push(partition)
  });
  partitioner.setEnabled(true);
  const turns: SpeakerTurn[] = [
    { seq: 0, source: 'mic', speakerId: 4, text: '我负责用户分层和召回实验，先建立对照组。' },
    { seq: 1, source: 'mic', speakerId: 8, text: '这个实验如何排除同期渠道活动影响？' },
    { seq: 2, source: 'mic', speakerId: 4, text: '我补充一下，我按渠道分层并连续观察四周留存。' },
    { seq: 3, source: 'mic', speakerId: 8, text: '最终增量和成本分别是多少？' }
  ];
  turns.forEach((turn) => partitioner.record(turn));
  await partitioner.finalize();
  const final = partitions.at(-1)!;
  assert.equal(new Set(final.segments.filter((s) => s.speakerId === 4).map((s) => s.role)).size, 1);
  assert.ok(final.segments.filter((s) => s.speakerId === 4).every((s) => s.role === 'candidate'));
  assert.deepEqual(candidates, [0, 2]);
  assert.deepEqual(interviewers, [1, 3]);
});

test('unknown or contested native IDs never feed Auto callbacks', async () => {
  const candidates: SpeakerTurn[] = [];
  const partitions: SpeakerPartition[] = [];
  const partitioner = createSpeakerPartitioner({
    classify: async (turns) => classificationForTurns(turns, [
      { speakerId: 6, role: 'candidate', confidence: 0.99 }
    ]),
    cohortHarness: {
      async evaluate() {},
      getRole: () => ({
        state: 'contested', role: 'unknown', confidence: 0,
        evidenceSeqs: [], contradictionSeqs: [0, 2], evaluatedRevision: 2,
        reasonCodes: ['opposite_role_contradictions']
      }),
      reset() {}
    },
    applySpeakerRole: (_id, role) => role,
    resolveTurnRole: (_id, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onPartition: (partition) => partitions.push(partition)
  });
  partitioner.setEnabled(true);
  partitioner.record({ seq: 0, source: 'mic', speakerId: 6, text: '我负责用户分层和召回实验。' });
  partitioner.record({ seq: 1, source: 'mic', speakerId: 8, text: '请说明最终结果如何验证。' });
  partitioner.record({ seq: 2, source: 'mic', speakerId: 6, text: '我用四周对照组留存验证增量。' });
  await partitioner.finalize();
  assert.deepEqual(candidates, []);
  assert.ok(partitions.at(-1)!.segments.filter((s) => s.speakerId === 6).every((s) => s.role === 'unknown'));
});

test('text-only turns retain per-turn semantic authority', async () => {
  const candidates: SpeakerTurn[] = [];
  const partitioner = createSpeakerPartitioner({
    classify: async (_turns, request) => classification(
      [],
      (request?.reviewSeqs ?? []).map((seq) => ({
        seq,
        role: seq === 0 ? 'interviewer' : 'candidate',
        confidence: 0.98
      }))
    ),
    applySpeakerRole: (_id, role) => role,
    onCandidateTurn: (turn) => candidates.push(turn),
    onPartition: () => {}
  });
  partitioner.setEnabled(true);
  partitioner.record({ seq: 0, source: 'mic', text: '请说明你负责的项目。' });
  partitioner.record({ seq: 1, source: 'mic', text: '我负责用户分层并将四周留存提升十二个百分点。' });
  await partitioner.finalize();
  assert.ok(candidates.some((turn) => turn.seq === 1));
});
```

Add a WebSocket test proving interviewer-only native turns and pending native turns never produce an Auto result, while a delegated candidate turn does.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd web-app
npx tsx --test server/test/speaker-partitioner.test.ts server/test/ws-auto-question.test.ts
```

Expected: FAIL because semantic turns currently feed Auto before cohort evaluation and assignments are not emitted.

- [ ] **Step 3: Build assignments and resolve native roles only from the whole-ID ledger**

After `cohortHarness.evaluate`, build an assignment for every native ID:

```ts
function assignmentFor(
  speakerId: number,
  manualRole: SpeakerRole,
  cohort: ClusterCohortState,
  updatedAtMs: number
): SpeakerAssignment {
  if (manualRole !== 'unknown') {
    return {
      speakerId,
      role: manualRole,
      state: 'manual',
      roleSource: 'manual',
      confidence: 1,
      evidenceVersion: cohort.evaluatedRevision,
      updatedAtMs,
      reasonCodes: ['manual_assignment']
    };
  }
  return {
    speakerId,
    role: cohort.state === 'delegated' ? cohort.role : 'unknown',
    state: cohort.state,
    roleSource: cohort.state === 'delegated' ? 'cohort' : 'unknown',
    confidence: cohort.confidence,
    evidenceVersion: cohort.evaluatedRevision,
    updatedAtMs,
    reasonCodes: [...cohort.reasonCodes]
  };
}
```

For native turns, ignore `roleByTurn` for display/Auto authority; use it only in `confirmedForCohort`. Apply each delegated/manual/unknown assignment through `deps.applySpeakerRole` so future raw finals inherit the safe role. Feed callbacks by walking turns after assignments exist and deduplicating by sequence. For text-only turns, keep the current consensus/local-repair callback path.

Before emitting, validate:

```ts
export function hasConsistentNativeRoles(
  segments: readonly SpeakerPartitionSegment[],
  assignments: readonly SpeakerAssignment[]
): boolean {
  const roles = new Map(assignments.map((a) => [a.speakerId, a.role]));
  return new Set(assignments.map((a) => a.speakerId)).size === assignments.length &&
    segments.every((segment) => roles.get(segment.speakerId) === segment.role);
}
```

Reject an invalid new partition and preserve the last valid emitted partition. Track assignment timestamps from an injected `now?: () => number` and reset the session-relative origin in `reset()`.

- [ ] **Step 4: Run focused, server, and type tests**

```bash
cd web-app
npx tsx --test server/test/speaker-partitioner.test.ts server/test/ws-auto-question.test.ts
npm test --workspace @open-cluely/server
npm run typecheck --workspace @open-cluely/server
```

Expected: PASS; no native ID has mixed roles and candidate callbacks are whole-ID gated.

- [ ] **Step 5: Commit and push the authority checkpoint**

```bash
git add web-app/server/src/speaker-partitioner.ts web-app/server/src/ws.ts web-app/server/test/speaker-partitioner.test.ts web-app/server/test/ws-auto-question.test.ts
git commit -m "fix: gate Auto questions by whole voiceprints"
git push origin main
```

---

### Task 5: Apply assignment maps atomically in the renderer

**Files:**
- Modify: `web-app/web/src/lib/speakerSegments.test.ts`
- Modify: `web-app/web/src/lib/speakerSegments.ts`
- Modify: `web-app/web/src/lib/useCopilotSocket.test.ts`
- Modify: `web-app/web/src/lib/useCopilotSocket.ts:353-360,586-666,990-1005`

**Interfaces:**
- Produces: `SpeakerAssignmentView = Map<number, SpeakerAssignment>` in the hook
- Produces: `roleFromAssignment(speakerId, serverRole, assignments, overrides)`
- Clears: assignment map on interview reset

- [ ] **Step 1: Write failing renderer state tests**

Add this helper and hook assertions:

```ts
function assignmentPartition(
  speakerId: number,
  role: 'interviewer' | 'candidate' | 'unknown',
  state: 'observing' | 'delegated' | 'contested'
) {
  return {
    type: 'speaker-partition' as const,
    status: 'live' as const,
    model: 'deepseek-v4-flash',
    speakerAssignments: [{
      speakerId,
      role,
      state,
      roleSource: state === 'delegated' ? 'cohort' as const : 'unknown' as const,
      confidence: state === 'delegated' ? 0.95 : 0,
      evidenceVersion: 2,
      updatedAtMs: 1_000,
      reasonCodes: state === 'delegated' ? ['two_pass_consensus'] : ['opposite_role_contradictions']
    }],
    segments: [{ seq: 0, speakerId, role, roleSource: state === 'delegated' ? 'cohort' as const : 'unknown' as const, text: '历史回答。' }]
  };
}

test('atomically relabels all historical turns and applies the role to future finals', async () => {
  const { result } = renderHook(() => useCopilotSocket());
  act(() => MockWebSocket.last().open());
  await waitFor(() => expect(result.current.status).toBe('open'));
  const socket = MockWebSocket.last();
  act(() => socket.emit({ type: 'transcript', source: 'mic', text: '历史回答。', isFinal: true, speakerId: 3, speaker: 'unknown' }));
  act(() => socket.emit(assignmentPartition(3, 'candidate', 'delegated')));
  expect(result.current.speakerSegments.filter((s) => s.speakerId === 3)
    .every((s) => s.role === 'candidate' && s.roleSource === 'cohort')).toBe(true);
  act(() => socket.emit({ type: 'transcript', source: 'mic', text: '补充一个结果。', isFinal: true, speakerId: 3, speaker: 'unknown' }));
  expect(result.current.speakerSegments.at(-1)?.role).toBe('candidate');
});

test('keeps a contested identity pending and clears assignments on reset', async () => {
  const { result } = renderHook(() => useCopilotSocket());
  act(() => MockWebSocket.last().open());
  await waitFor(() => expect(result.current.status).toBe('open'));
  const socket = MockWebSocket.last();
  act(() => socket.emit(assignmentPartition(3, 'unknown', 'contested')));
  expect(result.current.speakerSegments.every((s) => s.speakerId !== 3 || s.role === 'unknown')).toBe(true);
  act(() => result.current.resetSpeakerSegments());
  act(() => socket.emit({ type: 'transcript', source: 'mic', text: '新会话', isFinal: true, speakerId: 3, speaker: 'unknown' }));
  expect(result.current.speakerSegments.at(-1)?.role).toBe('unknown');
});
```

- [ ] **Step 2: Run focused web tests and verify RED**

```bash
cd web-app
npm exec --workspace @open-cluely/web vitest run src/lib/speakerSegments.test.ts src/lib/useCopilotSocket.test.ts
```

Expected: FAIL because future finals do not read an assignment map.

- [ ] **Step 3: Implement assignment-aware resolution**

Add:

```ts
export function effectiveAssignmentRole(
  speakerId: number,
  serverRole: SpeakerRole | undefined,
  assignments: ReadonlyMap<number, SpeakerAssignment>,
  overrides: ReadonlyMap<number, SpeakerRole>
): { role: SpeakerRole; roleSource: SpeakerRoleSource } {
  const manual = overrides.get(speakerId);
  if (manual) return { role: manual, roleSource: 'manual' };
  const assignment = assignments.get(speakerId);
  if (assignment) return { role: assignment.role, roleSource: assignment.roleSource };
  return { role: serverRole ?? 'unknown', roleSource: 'unknown' };
}
```

In `useCopilotSocket`, store `speakerAssignmentsRef`, replace it only after the full partition validates, apply it to every partition segment, consult it for every later native final, update it on manual assignment, and clear it in `resetSpeakerSegments`.

- [ ] **Step 4: Run focused and full web tests**

```bash
cd web-app
npm exec --workspace @open-cluely/web vitest run src/lib/speakerSegments.test.ts src/lib/useCopilotSocket.test.ts
npm test --workspace @open-cluely/web
```

Expected: PASS.

- [ ] **Step 5: Commit and push the renderer checkpoint**

```bash
git add web-app/web/src/lib/speakerSegments.ts web-app/web/src/lib/speakerSegments.test.ts web-app/web/src/lib/useCopilotSocket.ts web-app/web/src/lib/useCopilotSocket.test.ts
git commit -m "fix: keep native voiceprint roles consistent in transcript"
git push origin main
```

---

### Task 6: Lock and report the Balanced Auto gate and voiceprint invariants

**Files:**
- Modify: `web-app/server/test/environment.test.ts`
- Modify: `web-app/server/src/config.ts:68-74`
- Modify: `web-app/server/src/auto-trigger.ts:23,165-166`
- Modify: `web-app/server/test/auto-trigger.test.ts`
- Modify: `web-app/scripts/live-asr-lib.test.mjs`
- Modify: `web-app/scripts/live-asr-lib.mjs`
- Modify: `web-app/scripts/verify-live-asr.mjs`

**Interfaces:**
- Produces: `BALANCED_AUTO_GATE`
- Extends: `summarizeAsrRun(events)` with assignment histories and invariant violations
- Adds CLI options: `--job-description-file`, `--interview-guide-file`

- [ ] **Step 1: Write failing Balanced and report tests**

Assert one named preset:

```ts
assert.deepEqual(BALANCED_AUTO_GATE, {
  cooldownMs: 20_000,
  minNewChars: 120,
  debounceMs: 3_000,
  livenessWaits: 3,
  livenessChars: 280
});
```

Extend the live report fixture with two partitions and assert:

```js
assert.deepEqual(report.voiceprints['1'].roles, ['interviewer']);
assert.deepEqual(report.voiceprints['2'].roles, ['candidate']);
assert.deepEqual(report.mixedRoleSpeakerIds, []);
assert.equal(report.pendingSpeakerIds.includes(9), true);
assert.equal(report.autoQuestions[0].anchorSpeakerId, 2);
assert.deepEqual(report.invalidAutoQuestionIds, []);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd web-app
npx tsx --test server/test/environment.test.ts server/test/auto-trigger.test.ts
node --test scripts/live-asr-lib.test.mjs
```

Expected: FAIL because the named preset and assignment audit report do not exist.

- [ ] **Step 3: Export the preset and enhance the harness**

Add:

```ts
export const BALANCED_AUTO_GATE = Object.freeze({
  cooldownMs: 20_000,
  minNewChars: 120,
  debounceMs: 3_000,
  livenessWaits: 3,
  livenessChars: 280
});
```

Derive current defaults from the first three fields. Import `BALANCED_AUTO_GATE` into `auto-trigger.ts` and derive `MONITOR_LIVENESS_WAITS`/`MONITOR_LIVENESS_CHARS` from the latter two fields. Keep environment overrides server-only and keep the preset out of Settings.

In `summarizeAsrRun`, build per-ID role/state histories from `speakerAssignments`, detect any accepted mixed role, map every Auto `anchorSeq` to the final segment's speaker ID/role, and flag Auto questions whose anchor is not a delegated/manual candidate. In `verify-live-asr.mjs`, read optional UTF-8 JD/guide files and use them instead of the hard-coded property-manager context.

- [ ] **Step 4: Run focused and full tests**

```bash
cd web-app
npx tsx --test server/test/environment.test.ts server/test/auto-trigger.test.ts
node --test scripts/live-asr-lib.test.mjs
npm test
```

Expected: all suites PASS.

- [ ] **Step 5: Commit and push the acceptance-harness checkpoint**

```bash
git add web-app/server/src/config.ts web-app/server/src/auto-trigger.ts web-app/server/test/environment.test.ts web-app/server/test/auto-trigger.test.ts web-app/scripts/live-asr-lib.mjs web-app/scripts/live-asr-lib.test.mjs web-app/scripts/verify-live-asr.mjs
git commit -m "test: audit voiceprint roles in live ASR runs"
git push origin main
```

---

### Task 7: Rebuild and run the complete 1× Seed ASR 2.0 interruption test

**Files:**
- Create temporary only: `/tmp/p7p8-audio.*/interview-16k.wav`
- Create temporary only: `/tmp/p7p8-seed2-report.json`
- Modify: matching notes under `/Users/thomasli/Documents/github/Obsidian/Interview Copilot/Implementation/`

**Interfaces:**
- Consumes: `USER_OPERATIONS_P7_PROFILE`/`USER_OPERATIONS_P8_PROFILE` JD and guide context
- Consumes: the assignment-aware live ASR report
- Produces: a verified production build and a saved evidence report

- [ ] **Step 1: Run all static verification before live audio**

```bash
cd web-app
npm test
npm run build
```

Expected: all tests PASS and both client/server builds complete.

- [ ] **Step 2: Normalize the mislabeled AAC/MP4 source non-destructively**

Use the already verified temporary WAV when present; otherwise create a temporary directory, symlink the source with `.m4a`, and use macOS `afconvert` to mono 16 kHz PCM16. Verify:

```bash
file /tmp/p7p8-audio.*/interview-16k.wav
```

Expected: `RIFF ... WAVE audio, Microsoft PCM, 16 bit, mono 16000 Hz` and approximately 493 seconds.

- [ ] **Step 3: Start the rebuilt server and full real-time CLI audit**

Run the server on port 8788, then:

```bash
cd web-app
node scripts/verify-live-asr.mjs \
  --provider volc \
  --audio /tmp/p7p8-audio.VK1Rxi/interview-16k.wav \
  --url ws://127.0.0.1:8788/ws \
  --source mic \
  --speed 1 \
  --auto-generate \
  --job-description-file /tmp/p7-user-operations-jd.txt \
  --interview-guide-file /tmp/p7-user-operations-guide.txt \
  --out /tmp/p7p8-seed2-report.json
```

Expected: about 493 seconds wall playback, lifecycle `connecting → live → stopped`, no transport errors, a final partition before stopped, zero mixed-role speaker IDs, zero invalid Auto anchor roles, and no direct delegated-role flip.

- [ ] **Step 4: Replay through the visible frontend**

Open the rebuilt local app in the in-app browser, select `用户运营专家（P7）`, choose online interview audio, start the BlackHole microphone lane, and play the supplied source through the configured loopback at 1×. Observe real partial captions, finalized transcript ordering, whole-ID role labels, interruptions, Auto question placement, and scrolling. Stop capture after the source ends and verify the final partition in the visible transcript.

- [ ] **Step 5: Inspect the report instead of relying only on UI observation**

```bash
node -e "const r=require('/tmp/p7p8-seed2-report.json'); console.log(JSON.stringify({statuses:r.statuses,finalCount:r.finalCount,speakerIds:r.speakerIds,mixedRoleSpeakerIds:r.mixedRoleSpeakerIds,pendingSpeakerIds:r.pendingSpeakerIds,autoQuestionCount:r.autoQuestionCount,invalidAutoQuestionIds:r.invalidAutoQuestionIds,errors:r.errors},null,2))"
```

Release blockers: any mixed-role native ID, interviewer/pending Auto anchor, direct role flip, transcript sequence inversion, provider error, or absent final partition. Pending ambiguous IDs are acceptable and must remain excluded from Auto.

- [ ] **Step 6: Update implementation notes**

Update/create notes covering:

- P7/P8 job-profile entry points and Expert-context flow;
- whole-voiceprint assignment state, wire payload, renderer map, and Auto gating;
- Balanced gate constants and live-report invariants;
- gotchas: Doubao speaker IDs are session-local; the supplied `.mp3` is AAC/MP4; ambiguous IDs remain pending.

Every note must include Purpose, Entry points, Data flow, Config/state, and Gotchas.

- [ ] **Step 7: Push any final project correction and verify remote main**

```bash
git push origin main
git status --short --branch
```

Expected: project worktree clean and `main...origin/main` with no ahead/behind count. The Obsidian vault is a separate repository with session-end synchronization; edit its implementation notes but never stage them from the project repository.
