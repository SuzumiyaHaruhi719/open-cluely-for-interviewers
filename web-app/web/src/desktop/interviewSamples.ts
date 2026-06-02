import type { InterviewType } from './InterviewTypeModal';

/** One turn of a sample interview transcript. */
export interface InterviewSampleTurn {
  speaker: 'interviewer' | 'candidate';
  text: string;
}

/**
 * A built-in sample interview for trying out Generate Q without a live
 * transcript. Mirrors the desktop `INTERVIEW_SAMPLES` shape: a résumé + JD + a
 * multi-turn transcript whose last candidate turn is the thing to follow up on.
 */
export interface InterviewSample {
  id: string;
  name: string;
  language: string;
  interviewType: InterviewType;
  resume: string;
  jd: string;
  turns: InterviewSampleTurn[];
}

/**
 * Two representative samples ported from the desktop `interview-samples.js`
 * (one zh backend, one en PM). The desktop ships five; the web shell carries a
 * focused subset so the picker is functional without inflating the bundle with
 * very long transcripts. Selecting one pre-fills the résumé + JD and seeds the
 * transcript as the candidate-answer buffer.
 */
export const INTERVIEW_SAMPLES: InterviewSample[] = [
  {
    id: 'rich-backend-zh',
    name: 'ZH·资深后端/分布式系统工程师面试',
    language: 'zh',
    interviewType: 'online',
    resume:
      '8年研发经验，现任某电商中台公司（日订单量500万+）后端技术负责人。曾就职于美团、字节跳动，负责核心交易链路与分布式调度系统。技术栈：Java（JDK 17）、Spring Cloud Alibaba、Apache Kafka、Redis Cluster、TiDB、Kubernetes、Prometheus。主要成果：1）主导设计并落地了基于Raft的分布式任务调度平台，将调度延迟从平均800ms降至120ms，支撑全公司300+微服务的定时与流式任务，无单点故障；2）重构了订单履约系统的状态机引擎，引入可插拔的补偿策略，将因网络抖动导致的订单卡单率从0.3%降低至0.02%。',
    jd: '我们是一个快速增长的SaaS平台团队，服务全球客户，对数据一致性与可用性要求极高。后端团队约20人，正在寻找一位资深分布式系统工程师，负责设计下一代事件驱动架构与跨区域数据同步方案。我们关注：1）对于分布式共识、最终一致性、幂等性设计的深度理解；2）在复杂链路中的问题排查与根因分析能力；3）对性能优化的热情。',
    turns: [
      {
        speaker: 'interviewer',
        text: '你好，欢迎参加面试。首先请你简单介绍一个你负责过的、涉及分布式数据一致性的关键项目，以及你当时面临的核心挑战。'
      },
      {
        speaker: 'candidate',
        text: '好的。我之前在电商中台负责订单履约系统。核心挑战是：订单从支付到出库涉及多个微服务（库存、物流、优惠），每个服务都有自己的数据库，且跨机房部署。我们最初采用TCC模式，但两阶段提交导致长事务锁住库存，大促时经常死锁。后来我主导改成了基于Saga模式的异步补偿方案——用Kafka记录每一步的本地事务事件，并引入一个独立的补偿协调器，定期检查悬挂事务。这里最大的坑是：补偿逻辑必须幂等，但物流服务的外部接口并不保证幂等，我们第一次上线时因为重复补偿导致重复发货。后来我们在补偿协调器里增加了基于订单号+步骤的全局去重表，才彻底解决。'
      }
    ]
  },
  {
    id: 'rich-pm-en',
    name: 'EN·Senior PM B2B SaaS Interview',
    language: 'en',
    interviewType: 'online',
    resume:
      'Senior Product Manager with 8+ years in B2B SaaS, currently at CloudScale Analytics (series C, 400 employees). Led product for the enterprise analytics platform (React/Node.js, AWS, Snowflake). Drove a 22% reduction in time-to-insight for finance teams by redesigning the dashboard builder and integrating pre-built templates, resulting in 18% increase in monthly active users. Previously at WareHive (logistics SaaS), owned the inventory forecasting module; improved forecast accuracy from 68% to 85% by introducing ML-driven anomaly detection, directly contributing to $2.3M ARR growth over 18 months.',
    jd: 'We are looking for a Senior Product Manager to own our integrations and data ingestion platform. You will work closely with engineering, sales, and customer success to define the roadmap for connecting our core analytics product with 3rd-party tools (ERP, CRM, HRIS). Key challenges: prioritizing across dozens of integration requests, driving adoption of new connectors, and improving data sync reliability. We look for concrete examples of metrics-led decision making, managing technical trade-offs, and owning outcomes even when the path is uncertain.',
    turns: [
      {
        speaker: 'interviewer',
        text: 'Walk me through a recent product launch you led from concept to release. How did you decide what to build, and what was the impact?'
      },
      {
        speaker: 'candidate',
        text: 'At CloudScale Analytics, I led the launch of our interactive dashboard builder. I started with discovery: I shadowed 12 enterprise customers running weekly analytics reviews and noticed they spent 30% of the session manually copying data into Excel to reformat charts. I validated that with a survey (82% found dashboard building frustrating). I then ran a two-week prototype with one design partner, iterating on drag-and-drop interactions and template categories. We launched a phased rollout—first to 50 beta customers, then full GA. The impact: time-to-insight dropped 22%, and NPS among daily dashboard users jumped from 32 to 48.'
      }
    ]
  }
];

/** Flatten a sample's turns into a single candidate-answer string for analysis. */
export function sampleTranscriptText(sample: InterviewSample): string {
  return sample.turns
    .map((turn) => `${turn.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${turn.text}`)
    .join('\n\n');
}
