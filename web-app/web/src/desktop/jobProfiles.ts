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

export const JOB_PROFILES: readonly JobProfile[] = [PROPERTY_MANAGER_PROFILE];

export function buildInterviewGuideLines(profile: JobProfile): string[] {
  return profile.interviewGuide.map(
    (item) =>
      `${item.weight}%｜${item.competency}｜主问题：${item.primaryQuestion}｜追问：${item.followUps.join('；')}｜可验证证据：${item.evidenceSignals.join('；')}｜警示信号：${item.redFlags.join('；')}`
  );
}
