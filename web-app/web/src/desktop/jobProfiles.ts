export interface InterviewGuideItem {
  id: string;
  competency: string;
  weight: number;
  primaryQuestion: string;
  followUps: readonly string[];
  evidenceSignals: readonly string[];
  redFlags: readonly string[];
}

export interface JobProfile {
  id: string;
  title: string;
  department: string;
  reportsTo: string;
  summary: string;
  jobDescription: string;
  interviewerPreparation: readonly string[];
  interviewGuide: readonly InterviewGuideItem[];
}

const PROPERTY_MANAGER_JD = `职位：物业经理
部门：区域运营服务
汇报对象：城市负责人

工作概述
驻扎在园区现场，负责物业运营落地的园区负责人。

工作职责
1. 负责园区物业人员的培训、考勤、纪律、奖惩等工作，参与物业保安、保洁、绿化、工程人员的招聘工作；
2. 负责园区日常巡查，覆盖各岗位工作规范、仪表仪容实施情况，以及重点部位安全、消防设备设施、监控设备、安保用具和用品的使用、维护情况；发现问题及时协调解决，保证设备完好无故障使用，并监督岗位员工做好各项记录台账；
3. 负责现场的安全及消防，包括突发事件的应急处理；
4. 负责现场秩序维护，包含车辆、人员出入，保证租户有序进出现场；
5. 负责现场的卫生、环境、绿化、消杀等工作；
6. 负责园区设备的巡检、维护保养、维修检测工作，如配电、消防等；
7. 负责对接现场客户服务的日常工作，包括租户入驻、退租手续流程办理，以及租户租金及水电费用收缴；
8. 负责应对政府部门及公司相关部门的参观和检查；
9. 负责配合制定园区各项预算及工作计划，完成办公流程发起、审批、跟催、统计等工作；
10. 完成直线经理交付的园区其他运营事项。

任职要求
1. 大专及以上学历，综合能力突出者可适当放宽；
2. 具有独立运营综合体项目或园区项目物业三年以上管理工作经验；
3. 具有良好的语言表达能力和人际沟通能力；
4. 具有较好的突发事件应对能力，抗压能力强；
5. 具备电脑端、移动端系统使用知识和技能，熟练掌握 Office、PPT 等常用办公软件；
6. 具有物业或工程相关证书者优先考虑。`;

export const PROPERTY_MANAGER_PROFILE: JobProfile = {
  id: 'property-manager',
  title: '物业经理',
  department: '区域运营服务',
  reportsTo: '城市负责人',
  summary: '驻扎在园区现场，负责物业运营落地的园区负责人',
  jobDescription: PROPERTY_MANAGER_JD,
  interviewerPreparation: [
    '确认候选人独立负责过的项目边界：面积、业态、租户数、团队规模、年度预算和汇报关系。',
    '提前标记简历中需要核验的安全事故、重大维修、客诉、收缴率和成本优化数据。',
    '以真实事件追问候选人的个人动作、判断依据、量化结果与事后复盘，避免只听团队概述。',
    '涉及消防、配电和政府检查时，核对制度、台账、演练、证照及闭环证据，不接受原则性回答。'
  ],
  interviewGuide: [
    {
      id: 'independent-operations',
      competency: '园区独立运营能力',
      weight: 15,
      primaryQuestion: '请选一个你独立负责过的园区，说明接手时的经营与服务现状、你的前三项判断，以及六个月后的结果。',
      followUps: ['你本人拥有哪几项决策权？', '最难推进的一个问题是什么，如何验证已经解决？'],
      evidenceSignals: ['清楚说明项目规模、团队、预算和服务指标', '能区分个人决策、团队执行与上级支持', '结果有前后对比数据'],
      redFlags: ['始终用“我们”回避个人责任', '无法说出项目基线或量化结果']
    },
    {
      id: 'people-leadership',
      competency: '一线团队管理与培养',
      weight: 12,
      primaryQuestion: '讲一次你处理保安、保洁、绿化或工程团队持续不达标的经历，你怎样判断原因并改变结果？',
      followUps: ['考勤、纪律和奖惩如何做到有标准且可追溯？', '招聘和培训分别做了什么调整？'],
      evidenceSignals: ['有排班、培训、检查、反馈和奖惩闭环', '兼顾制度一致性与现场稳定', '能说明人员质量指标的变化'],
      redFlags: ['把问题全部归因于员工态度', '只靠处罚或临时加人']
    },
    {
      id: 'safety-emergency',
      competency: '突发事件应对与复盘',
      weight: 15,
      primaryQuestion: '请复盘一次真实的消防、安全或公共秩序突发事件：最初十分钟你看到了什么、做了什么、为什么？',
      followUps: ['当时的信息不完整在哪里？', '事后制度、设备、演练或台账具体改了什么？'],
      evidenceSignals: ['先控人身风险并建立指挥与通报链路', '能说明现场取舍和升级节点', '复盘产生可验证的预防措施'],
      redFlags: ['只背应急预案而无真实案例', '忽略报警、疏散、留证或上报责任']
    },
    {
      id: 'facility-engineering',
      competency: '设施设备与工程管理',
      weight: 10,
      primaryQuestion: '讲一次配电、消防或关键设备发生重复故障的案例，你如何从临时抢修推进到根因消除？',
      followUps: ['如何安排巡检和预防性维护？', '你怎样核验外包单位或工程人员的维修质量？'],
      evidenceSignals: ['理解巡检、保养、维修和检测的差异', '有故障分级、工单、验收与复发监控', '能说出停机风险和成本取舍'],
      redFlags: ['只会转交工程团队', '没有验收标准或复发记录']
    },
    {
      id: 'tenant-service',
      competency: '租户服务与冲突协调',
      weight: 10,
      primaryQuestion: '讲一次租户诉求与园区规则或运营成本冲突的案例，你怎样沟通并达成可执行结果？',
      followUps: ['如何办理入驻或退租交接，避免后续争议？', '面对高压投诉时你如何保持信息一致？'],
      evidenceSignals: ['能识别合同、服务标准和现场关系三方约束', '有明确责任人、时限、记录和回访', '结果兼顾体验与规则'],
      redFlags: ['以口头承诺换取暂时平息', '没有记录、升级或回访机制']
    },
    {
      id: 'budget-execution',
      competency: '预算、计划与执行闭环',
      weight: 10,
      primaryQuestion: '请举例说明你如何制定年度物业预算和月度工作计划，并在出现偏差时采取行动。',
      followUps: ['你持续跟踪哪几项核心指标？', '讲一次成本压力下仍必须保留的投入。'],
      evidenceSignals: ['预算假设与业务量、合同和设备计划相关', '有月度偏差分析与纠偏动作', '能解释成本、风险和服务质量取舍'],
      redFlags: ['只负责报表汇总而不参与判断', '削减关键安全或维护投入']
    },
    {
      id: 'inspection-compliance',
      competency: '检查合规与台账管理',
      weight: 8,
      primaryQuestion: '政府或公司检查前发现消防台账和现场状态不一致时，你会如何处理？',
      followUps: ['哪些问题必须立即升级？', '如何证明整改真正闭环而不是补材料？'],
      evidenceSignals: ['现场事实优先于材料美化', '问题分级、责任、时限、复验和留证完整', '理解重大隐患的上报边界'],
      redFlags: ['以补签台账代替整改', '隐瞒重大风险以通过检查']
    },
    {
      id: 'site-quality',
      competency: '现场品质与秩序管理',
      weight: 8,
      primaryQuestion: '你如何组织一次覆盖安保、保洁、绿化、消杀和车辆秩序的园区巡查？',
      followUps: ['怎样定义不同岗位的合格标准？', '重复问题如何追到管理根因？'],
      evidenceSignals: ['巡查有频次、路线、抽检标准与记录', '问题可分派、跟催、复验并形成趋势', '关注租户高峰与重点部位风险'],
      redFlags: ['依赖临时走场和主观观感', '问题发现后没有责任闭环']
    },
    {
      id: 'collections',
      competency: '费用收缴与经营意识',
      weight: 7,
      primaryQuestion: '讲一次租金或水电费逾期的处理经历，你怎样兼顾收缴目标、合同约束和租户关系？',
      followUps: ['逾期如何分层和升级？', '你如何确保账单、催缴和到账记录一致？'],
      evidenceSignals: ['有账龄、金额、责任人与承诺日期', '动作符合合同和授权边界', '能说明最终回款及后续预防'],
      redFlags: ['私下承诺减免或越权处理', '只谈催促，不掌握账目证据']
    },
    {
      id: 'digital-collaboration',
      competency: '系统工具与跨部门协作',
      weight: 5,
      primaryQuestion: '举例说明你怎样用物业系统、移动端或 Office 工具提升现场协作和管理透明度。',
      followUps: ['哪些数据会定期向城市负责人汇报？', '办公流程卡住时你如何推动？'],
      evidenceSignals: ['能展示数据口径、更新责任和应用场景', '系统记录与现场台账一致', '跨部门事项有明确升级路径'],
      redFlags: ['只会基础录入，无法用数据管理', '以口头跟催替代流程留痕']
    }
  ]
};

const USER_OPERATIONS_P7_JD = `职位：用户运营专家（P7）
部门：用户运营 / 增长与体验
汇报对象：用户运营负责人

工作概述
独立负责一个复杂用户运营域或大型项目，把业务目标转化为用户分层、生命周期策略、实验和可复用机制，并持续交付可验证结果。

工作职责
1. 承接业务战略和年度目标，制定所负责运营域的用户策略、季度规划、关键指标与执行节奏，并对结果负责；
2. 建立用户分层、画像与生命周期运营方案，覆盖获客、激活、留存、转化、复购、召回或忠诚度中的关键环节；
3. 结合行为数据、用户研究、一线反馈与竞争环境识别问题，形成有优先级且可验证的运营假设；
4. 设计并推动增长实验，明确基线、样本、对照、增量口径、归因和复盘，平衡规模、质量、成本与长期价值；
5. 负责会员、内容、社区、私域、CRM、活动或渠道运营中的一项或多项，并将有效策略沉淀为流程、工具或产品能力；
6. 建立所负责领域的指标体系和经营看板，持续跟踪用户规模、活跃、留存、转化、LTV、ROI、满意度与风险指标；
7. 联动产品、研发、数据、市场、销售、客服、商业化和风控团队，推动复杂项目从目标对齐、方案设计到落地复盘；
8. 管理项目预算、资源和关键依赖，在目标冲突或信息不完整时作出取舍并及时升级风险；
9. 识别用户体验、内容、隐私、合规和品牌风险，建立执行边界、监控与处置机制；
10. 沉淀方法论并辅导团队成员，提高运营决策质量、执行效率和跨团队协作能力。

任职要求
1. 本科及以上学历，综合能力和业绩特别突出者可适当放宽；
2. 七年以上互联网用户运营、增长、产品运营或相关经验，具有独立负责一个复杂用户运营域或大规模用户项目的经历；
3. 能把模糊业务问题拆解为用户策略、指标、实验和执行机制，并用前后基线或经营数据证明结果；
4. 具有扎实的用户洞察、数据分析和实验能力，能够识别归因偏差和指标副作用；
5. 具有较强的跨部门协作、项目治理和利益相关方管理能力；
6. 至少建设过一项可复用的流程、工具、产品能力或运营机制，而非只有单次活动案例；
7. 对用户体验、隐私合规、内容安全和长期品牌价值有明确边界意识。`;

const USER_OPERATIONS_P8_JD = `职位：用户运营专家（P8）
部门：用户运营 / 增长与体验
汇报对象：业务负责人或用户运营负责人

工作概述
定义跨业务、跨产品或跨区域的用户运营方向与资源优先级，通过组织、平台和机制建设持续获得规模化用户价值与经营结果。

工作职责
1. 根据公司战略、业务阶段和竞争环境制定用户运营中长期方向、年度组合目标和关键战略取舍，并对跨域结果负责；
2. 建立跨产品或跨业务的用户分层与生命周期经营框架，统一核心口径并明确各业务的差异化策略；
3. 通过用户研究、行为数据、经营数据和外部趋势识别结构性机会，推动高层形成优先级与资源共识；
4. 建立增长实验和决策治理体系，规范基线、样本、对照、归因、增量、停止条件与跨周期复盘；
5. 推动会员、内容、社区、私域、CRM、渠道或用户数据能力的平台化建设，使策略能够被多个团队规模化复用；
6. 建立面向用户价值和经营价值的组合指标体系，平衡增长、留存、LTV、ROI、体验、品牌与风险；
7. 联动产品、研发、数据、市场、销售、客服、商业化和风控负责人，解决跨团队目标冲突并推动关键决策落地；
8. 参与或主导预算与人才资源配置，建立组织分工、管理节奏、人才梯队和关键能力标准；
9. 建立用户体验、内容、隐私、合规和品牌风险的治理边界、预警机制与重大事件处置原则；
10. 对多个周期或业务单元的组合结果负责，并通过组织、平台、生态或方法体系扩大团队整体产出。

任职要求
1. 本科及以上学历，综合能力和业绩特别突出者可适当放宽；
2. 十年以上互联网用户运营、增长、产品运营或相关经验，具有多业务、大规模用户或复杂组织的负责人经历；
3. 能定义跨业务用户战略和资源优先级，并证明策略在多个周期、区域或业务单元中的结果；
4. 具有深入的用户洞察、经营分析和实验治理能力，能够识别因果、机会成本、组合风险与长期副作用；
5. 具有影响高层决策、协调多团队负责人和处理复杂利益冲突的实际经历；
6. 建设过可规模化复用的平台、组织机制、人才体系或生态能力，并能量化其杠杆效果；
7. 对用户体验、隐私合规、内容安全、品牌和长期经营质量有系统治理能力。`;

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

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function supportsOrderedCharacterSearch(term: string): boolean {
  // Ordered-character matching is useful for compact Chinese abbreviations
  // ("物经" → "物业经理"), but makes level tokens such as P7 match arbitrary
  // later digits in a P8 JD. Keep ASCII/alphanumeric level queries exact.
  return /^\p{Script=Han}+$/u.test(term);
}

/**
 * Small-catalog fuzzy search used by the one-shot JD picker. Whitespace means
 * “all terms”, while compact Chinese abbreviations such as “物经” still match
 * “物业经理” through ordered-character matching.
 */
export function searchJobProfiles(query: string): JobProfile[] {
  const terms = query
    .trim()
    .split(/\s+/u)
    .map(normalizeSearchText)
    .filter(Boolean);
  if (terms.length === 0) return [...JOB_PROFILES];

  return JOB_PROFILES.filter((profile) => {
    const haystack = normalizeSearchText(
      [
        profile.title,
        profile.department,
        profile.reportsTo,
        profile.summary,
        profile.jobDescription
      ].join(' ')
    );
    return terms.every(
      (term) =>
        haystack.includes(term) ||
        (supportsOrderedCharacterSearch(term) && isSubsequence(term, haystack))
    );
  });
}

export function buildInterviewGuideLines(profile: JobProfile): string[] {
  return profile.interviewGuide.map(
    (item) =>
      `${item.weight}%｜${item.competency}｜主问题：${item.primaryQuestion}｜追问：${item.followUps.join('；')}｜可验证证据：${item.evidenceSignals.join('；')}｜警示信号：${item.redFlags.join('；')}`
  );
}
