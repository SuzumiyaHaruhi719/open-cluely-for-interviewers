# P7–P8 User Operations Interview and Voiceprint Role Harness

## Purpose

Add a complete built-in `用户运营专家（P7–P8）` interview profile and make native ASR speaker identity the unit of interviewer/candidate delegation. The system must remain useful under repeated interruptions without ever displaying the same native voiceprint as both roles.

## Product outcome

An interviewer can select the P7–P8 user-operations JD, start the interview, and play the supplied 8-minute interview recording through the existing audio path. Doubao Seed ASR 2.0 may emit two or more native speaker IDs. The role harness gathers evidence across the whole session, then delegates each speaker ID to `面试官`, `候选人`, or `待确认` as one atomic identity decision.

This design guarantees identity consistency, not infallible human identification:

- one native `speakerId` cannot simultaneously appear as interviewer and candidate;
- an ambiguous or contradictory voiceprint remains `待确认` and is excluded from Auto-question evidence;
- a delegated voiceprint can be revoked to `待确认`, but can never flip directly to the opposite role;
- more than one voiceprint may be delegated to the interviewer cohort or candidate cohort;
- provider over-clustering (two humans emitted as one ID) fails safe as `待确认` instead of fabricating per-turn role changes.

## Scope

### In scope

- A built-in P7–P8 user-operations-expert JD, interviewer preparation, and 100-point evidence scorecard.
- Fuzzy JD search using `P7`, `P8`, `用户运营`, `增长`, and role-related terms.
- Whole-voiceprint role state and an explicit speaker-assignment wire contract.
- Atomic historical relabeling and immediate inheritance for future turns from a delegated speaker ID.
- DeepSeek V4 Flash evidence audits that promote, revoke, or retain an assignment only after sufficient evidence.
- Panel-interview support: multiple interviewer IDs interviewing one candidate, plus safe handling of extra candidate IDs.
- Candidate-only Auto-question eligibility based on delegated/manual whole-voiceprint roles.
- Full-length, real-time acceptance testing with the supplied interruption-heavy recording.

### Out of scope

- Voice biometrics, identity enrollment, or matching a person across separate interviews.
- CAM++ or another local diarization model.
- Splitting a single provider speaker ID into different roles on different turns.
- A new prompt mode, pipeline editor, or user-facing role-tuning settings.
- Claiming 100% semantic accuracy without speaker-labeled ground truth.

## Approaches considered

### A. Keep per-turn semantic roles authoritative

Each transcript turn can independently become interviewer or candidate. This reacts quickly, but it is the source of the current failure: one stable voiceprint can visibly switch roles across adjacent answers and interruptions. Rejected.

### B. Assign by source, numeric speaker order, or first turn

For example, treat computer audio or `speakerId=0` as interviewer. This is fast but false for offline single-microphone playback, panel interviews, provider restarts, and recordings where the candidate speaks first. Rejected.

### C. Evidence-gated whole-voiceprint delegation

Per-turn semantic analysis becomes internal evidence only. Two independent Flash audits evaluate accumulated evidence for every native speaker ID. The resulting full partition is applied atomically, and ambiguous IDs remain pending. Selected because it directly enforces the requested identity invariant while supporting interruptions and multiple interviewers.

## Non-negotiable invariants

1. **Native ID is the role unit.** Every finalized turn with the same non-empty native `speakerId` resolves through the same speaker-assignment record.
2. **No mixed role per native ID.** A rendered or serialized partition containing both `interviewer` and `candidate` for one native ID is invalid and must not replace the last valid partition.
3. **Manual assignment wins.** A user-assigned whole-voiceprint role is never overwritten by automation during that interview.
4. **Unknown is safe.** Insufficient or conflicting evidence yields `unknown`/`待确认`, never a forced guess.
5. **No direct automated flip.** `interviewer → candidate` and `candidate → interviewer` are illegal transitions. Automation must first revoke the identity to `contested`, gather new evidence, and pass fresh promotion audits.
6. **Atomic full partition.** The renderer never observes a partially updated speaker map or a mixture of old and new role decisions.
7. **Future inheritance.** Once speaker `S2` is delegated, later finalized turns from `S2` immediately inherit its role while the next audit is pending.
8. **Candidate-only Auto input.** Auto-question monitoring sees only turns from `candidate` voiceprints or explicit manual candidate assignments. Pending, contested, and interviewer voiceprints cannot trigger a question.
9. **No sentence-level native override.** A semantic turn verdict cannot directly change the visible or Auto role of a native-ID turn.
10. **Text-only compatibility.** Turns without a native `speakerId` may continue using the existing per-turn semantic role path because there is no stable voiceprint to delegate.

## Built-in job profile

### Identity

- **职位：** 用户运营专家（P7–P8）
- **部门：** 用户运营 / 增长与体验
- **汇报对象：** 用户运营负责人或业务负责人
- **工作概述：** 面向大规模互联网用户与复杂业务目标，负责用户运营策略、生命周期增长、用户洞察、机制与平台建设，并通过跨团队协作持续交付可验证的用户价值和经营结果。

### Complete JD context

The following content is stored as job context for the existing Expert workflow. It is not a second prompt system.

#### 工作职责

1. 根据公司战略、业务阶段和用户价值目标，制定用户运营中长期策略、年度规划、关键指标及资源方案，并对核心结果负责；
2. 建立用户分层、画像与生命周期运营体系，覆盖获客、激活、留存、转化、复购、召回与忠诚度经营；
3. 结合定量数据、用户研究、行为路径和一线反馈识别关键机会，形成可验证的运营假设与优先级；
4. 设计并推动增长实验，建立实验口径、对照方法、归因框架和复盘机制，平衡规模、质量、成本与长期价值；
5. 负责会员、内容、社区、私域、CRM、活动或渠道等运营机制中的一项或多项，并推动高价值策略产品化、自动化和平台化；
6. 建立用户运营指标体系和经营看板，持续跟踪用户规模、活跃、留存、转化、LTV、ROI、满意度及风险指标；
7. 联动产品、研发、数据、市场、销售、客服、商业化和风控团队，推动复杂项目从目标对齐、方案设计到落地复盘；
8. 识别业务增长中的体验、内容、隐私、合规和品牌风险，建立边界、监控及处置机制；
9. 沉淀可复用的方法论、流程和人才能力，提升团队决策质量、执行效率与组织影响力；
10. P8 候选人还需证明能够定义跨业务或跨区域方向，影响高层资源配置，并通过组织、平台或生态建设获得持续的组合结果。

#### 任职要求

1. 本科及以上学历，综合能力和业绩特别突出者可适当放宽；
2. 七年以上互联网用户运营、增长、产品运营或相关经验，具有复杂业务或大规模用户运营的完整负责人经历；
3. 能将公司目标拆解为用户策略、指标体系和执行机制，并用前后基线、实验或经营数据证明结果；
4. 具有扎实的用户洞察、数据分析和实验能力，能够识别相关性、因果性、归因偏差与指标副作用；
5. 具有较强的跨部门协作、项目治理和利益相关方管理能力，能在目标冲突和信息不完整时作出判断；
6. 能够建设运营机制、平台或团队能力，而不是只依赖单次活动和个人推动；
7. 对用户体验、隐私合规、内容安全和长期品牌价值有明确边界意识；
8. P7 候选人应能独立负责复杂运营域并持续交付可验证结果；P8 候选人应能制定多域策略、影响组织资源并建立规模化能力。

### Level calibration

#### P7 evidence anchors

- 独立拥有一个复杂运营域或大型项目的目标、方案与结果；
- 能把模糊业务问题转化为用户分层、指标、实验和可执行机制；
- 在多个团队之间推动关键决策，能说明本人判断、阻力处理和量化结果；
- 至少建设过一项可复用的流程、产品能力或运营机制，而非只有活动案例。

#### P8 evidence anchors

- 定义跨业务、跨产品或跨区域的用户运营方向与资源优先级；
- 影响高层决策，并能解释组合投入、机会成本和长期结果；
- 通过组织、平台、生态或方法体系扩大他人产出，而非仅靠个人推进；
- 对多个周期或多个业务单元的结果负责，并能证明策略在环境变化后仍然有效。

### Interviewer preparation

1. 标记简历中候选人声称“负责”或“主导”的项目，准备核验其决策权、团队边界、预算、周期和可归因结果。
2. 选择至少一个增长案例，核对基线、样本、实验设计、增量口径、成本、LTV 与副作用。
3. 选择至少一个失败或停做案例，判断候选人是否能识别错误假设、沉没成本和纠偏信号。
4. 对 P8 候选人额外准备组织影响问题：资源重配、平台建设、人才机制及跨业务组合结果。
5. 面试中优先追问事实、个人动作、判断依据和证据，不把方法论术语本身视为能力证明。

### 100-point evidence scorecard

| Competency | Weight | Primary evidence target |
|---|---:|---|
| 战略与业务诊断 | 15 | 从业务目标、用户问题和约束形成取舍明确的策略 |
| 生命周期增长与留存 | 15 | 分层运营、关键路径和长期留存的可验证结果 |
| 数据、指标与实验 | 15 | 基线、实验、归因、增量、成本及指标副作用 |
| 用户洞察与分群 | 10 | 定量和定性证据如何改变优先级或产品方案 |
| 机制建设与产品化 | 10 | 将一次性动作沉淀为可复用流程、工具或平台 |
| 复杂项目与跨团队推动 | 10 | 决策权、冲突处理、治理节奏和落地结果 |
| 领导力与组织影响 | 10 | 人才、组织、资源与高层影响；P8 深度重点 |
| 商业化、LTV 与 ROI | 8 | 用户价值与经营价值之间的量化取舍 |
| 风险、合规与长期体验 | 7 | 隐私、内容、品牌和增长边界的实际处理 |
| **合计** | **100** | |

Every scorecard item supplies a primary question, focused follow-ups, evidence signals, and red flags through the existing `InterviewGuideItem` schema. The implementation must test that weights equal 100 and that guide lines serialize into Expert context.

## Voiceprint role state model

Each interview owns a map keyed by the provider-native speaker ID:

```text
observing  --promotion consensus--> delegated(interviewer|candidate)
observing  --insufficient/conflict--> observing
delegated  --material contradiction--> contested
contested  --fresh consensus-------> delegated(interviewer|candidate)
manual     ------------------------> manual (automation cannot overwrite)
```

### Assignment record

Each record contains:

- `speakerId`: provider-native stable ID for this interview;
- `role`: `interviewer | candidate | unknown`;
- `state`: `observing | delegated | contested | manual`;
- `roleSource`: `cohort | manual | unknown`;
- `confidence`: normalized audit confidence;
- `evidenceVersion`: monotonic version of the evidence snapshot used;
- `updatedAtMs`: interview-relative time;
- `reasonCodes`: bounded machine-readable audit reasons, never hidden chain-of-thought.

The state is session-scoped and is cleared on new interview/reset. It is not a cross-session biometric profile.

## Evidence harness

### Evidence collection

For every native speaker ID, gather:

- finalized turn text and timestamps;
- adjacency windows before and after the turn;
- speech-act evidence such as asking, answering, probing, scoring, acknowledging, or self-description;
- repeated interaction patterns across separate windows;
- current manual assignments and already stable cohort assignments;
- contradiction counts and the last evidence version evaluated.

Source labels, speaker number, turn order, volume, and channel are contextual metadata only. They cannot independently determine a role.

### “Enough evidence” gate

An automated promotion is eligible only when all conditions hold:

- at least two substantive turns or two independent adjacency windows for that speaker ID;
- at least 48 non-whitespace Chinese-equivalent characters across the evidence bank;
- evidence is distributed across more than one short burst when timestamps permit;
- at least one relational signal connects the speaker to another participant (for example question→answer or answer→probe);
- no unresolved high-severity contradiction exists;
- the evidence snapshot is newer than the last audited version.

Short acknowledgements such as `嗯`, `好`, `谢谢`, or interruptions containing no role evidence do not satisfy the gate alone.

### Two-pass DeepSeek V4 Flash audit

The configured `deepseek-v4-flash` model lane performs two independent structured audits over the same bounded evidence snapshot:

1. **Role-evidence audit:** evaluates speech acts and interaction direction for every observed speaker ID.
2. **Partition-consistency audit:** evaluates the proposed full cohort partition, panel-interviewer plausibility, contradictions, and continuity across interruptions.

Promotion requires both audits to agree on the role, confidence at or above `0.88`, a role-margin at or above `0.18`, and a valid full partition. These thresholds are internal constants, not Settings controls.

The model returns only a strict schema with role, confidence, evidence references, and bounded reason codes. Parse failure, timeout, disagreement, missing IDs, or an invalid partition preserves the last safe state.

### Contradiction and revocation

A single odd sentence cannot flip an identity. A delegated assignment is revoked only when new evidence contains at least two independent, material opposite-role signals and the consistency audit confirms the conflict. Revocation is atomic for the whole speaker ID:

- all historical turns for that ID become `待确认`;
- future turns remain pending;
- Auto-question monitoring excludes that ID;
- direct delegation to the opposite role is forbidden in the same audit;
- a later, newer evidence snapshot must pass the full two-audit promotion gate.

If Doubao reuses one speaker ID for two actual humans, sustained contradictions should therefore revoke the ID instead of displaying sentence-level switches.

## Wire contract and renderer behavior

Extend the existing speaker-partition payload with an authoritative assignment list:

```ts
interface SpeakerAssignment {
  speakerId: string;
  role: 'interviewer' | 'candidate' | 'unknown';
  state: 'observing' | 'delegated' | 'contested' | 'manual';
  roleSource: 'cohort' | 'manual' | 'unknown';
  confidence: number;
  evidenceVersion: number;
  updatedAtMs: number;
  reasonCodes: string[];
}

interface SpeakerPartition {
  // Existing canonical transcript segments remain present.
  speakerAssignments: SpeakerAssignment[];
}
```

The server validates that every native-ID segment agrees with its assignment before publishing. The browser then applies one partition transaction:

1. validate interview/session identity and monotonic partition revision;
2. build the new `roleBySpeakerId` map;
3. reject duplicate or internally conflicting assignments;
4. relabel all existing native-ID segments from the map;
5. replace transcript and assignment state together;
6. immediately use the map for later final segments;
7. leave text-only/no-ID turns on the compatible per-turn path.

The UI continues to show `待确认 · 说话人 N` while evidence is insufficient. It does not expose confidence sliders, audit thresholds, or a new role configuration screen.

## Auto-question interaction

Auto-question monitoring consumes a filtered canonical transcript:

- include delegated/manual candidate turns;
- include interviewer turns only as conversation context after their identity is delegated/manual, never as the answer evidence that releases generation;
- exclude observing and contested speaker IDs;
- do not release while the candidate is still speaking or while only interviewer speech has arrived;
- preserve the existing continuous monitor → expert generation architecture once enough candidate evidence exposes a meaningful evidence gap.

Manual question generation remains available regardless of automatic role confidence and uses the visible transcript plus JD context.

## Failure handling

- **Flash timeout/API error:** keep the last valid assignment map and schedule a later audit when new evidence arrives.
- **Malformed model output:** discard it; never partially apply an assignment.
- **Missing speaker IDs:** preserve existing assignments and keep new IDs observing.
- **Provider speaker-ID reset:** treat unseen IDs as new observing identities; do not infer equality from numeric reuse across ASR sessions.
- **No speaker IDs:** retain text-only semantic behavior so transcription remains useful.
- **Panel interview:** allow multiple IDs in the interviewer cohort; do not force a one-to-one partition.
- **Multiple candidates or ASR fragmentation:** allow multiple IDs in the candidate cohort when evidence supports it.
- **Partition contradiction:** reject the entire partition update and retain the last valid one.

## Acceptance plan

### Automated profile tests

- profile ID, title, department, reports-to, summary, and full JD are preserved;
- `P7`, `P8`, `用户运营`, `增长`, and ordered-character fuzzy terms find the profile;
- scorecard weights equal 100;
- every competency has questions, evidence signals, and red flags;
- serialized guide lines enter the existing Expert context without introducing another prompt system.

### Automated voiceprint tests

- a partition with mixed roles for one native speaker ID is rejected;
- a delegated assignment atomically relabels every historical turn for that ID;
- later turns from a delegated ID inherit the role immediately;
- interruption-sized turns never create a sentence-level native role flip;
- two or more interviewer IDs may coexist with one candidate ID;
- fragmented candidate IDs may share the candidate cohort;
- ambiguous new IDs remain pending and cannot trigger Auto questions;
- two material contradictions revoke the whole ID to pending;
- a delegated ID cannot flip directly to the opposite role;
- manual whole-ID assignment survives later automated audits;
- text-only turns retain compatible per-turn behavior;
- session reset clears all assignments.

### Full-length MP3 acceptance test

Source:

`/Users/thomasli/Downloads/Bilibili Immersive Interview P7 P8 (1).mp3`

The file is an AAC/MP4 container despite its `.mp3` suffix. Tests use a temporary, non-destructive conversion to mono 16 kHz PCM WAV and replay the full 8m13s recording at 1× through the real Doubao Seed ASR 2.0 path.

The report must include:

- ASR connection, first-partial latency, final-turn count, and transport errors;
- every observed native speaker ID and its assignment-state history;
- a per-ID assertion that no accepted partition contains mixed roles;
- interruption windows and whether the same ID remains identity-consistent before/after interruption;
- pending/contested intervals, promotions, revocations, and audit reason codes;
- Auto-question releases, generation latency, token/词元 usage, and the candidate evidence that released each question;
- confirmation that interviewer-only or pending speech never releases an Auto question;
- final stop-time partition and transcript ordering checks.

Acceptance does not require forcing every ASR ID into a role. A pending ambiguous identity is a correct fail-safe result. A native ID displayed in both roles, an interviewer-only Auto release, or a direct role flip is a release blocker.

## Entry points expected to change

- `web-app/web/src/desktop/jobProfiles.ts` — add the built-in P7–P8 job profile and guide.
- `web-app/web/src/desktop/jobProfiles.test.ts` — profile, fuzzy-search, and scorecard coverage.
- `web-app/server/*speaker*` and related tests — whole-voiceprint ledger, audits, partition validation, and assignment wire data.
- `web-app/web/src/*` transcript/session state and tests — atomic `roleBySpeakerId` application and future inheritance.
- `web-app/server/*auto*` and related tests — candidate-only release from delegated/manual whole-voiceprint roles.
- `web-app/scripts/verify-live-asr.mjs` or a focused companion — full-length assignment and interruption audit output.
- Obsidian `Interview Copilot/Implementation/` notes — implementation entry points, data flow, state, and gotchas.

Exact file/symbol names for speaker and Auto integration will be resolved during the implementation-plan inspection rather than guessed in this design.

## Delivery checkpoints

1. Commit and push this approved design specification.
2. Write the implementation plan with exact symbols and test-first slices.
3. Add the P7–P8 profile and its tests; commit and push.
4. Add whole-voiceprint contracts/ledger tests and implementation; commit and push.
5. Wire renderer inheritance and Auto filtering; commit and push.
6. Run automated verification, rebuild, and replay the complete MP3 at 1×.
7. Record implementation notes, commit, and push the verified `main` branch.
