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
 * Transcripts are deliberately long (≥2000 chars of conversation) so the seeded
 * chat reads like a real, in-progress interview.
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

const BUILTIN_SAMPLES: InterviewSample[] = [
  {
    id: 'rich-backend-zh',
    name: 'ZH·资深后端/分布式系统工程师面试',
    language: 'zh',
    interviewType: 'online',
    resume:
      '8年研发经验，现任某电商中台公司（日订单量500万+）后端技术负责人。曾就职于美团、字节跳动，负责核心交易链路与分布式调度系统。技术栈：Java（JDK 17）、Spring Cloud Alibaba、Apache Kafka、Redis Cluster、TiDB、Kubernetes、Prometheus。主要成果：1）主导设计并落地了基于 Raft 的分布式任务调度平台，将调度延迟从平均 800ms 降至 120ms，支撑全公司 300+ 微服务的定时与流式任务，无单点故障；2）重构了订单履约系统的状态机引擎，引入可插拔的补偿策略，将因网络抖动导致的订单卡单率从 0.3% 降低至 0.02%。',
    jd: '我们是一个快速增长的 SaaS 平台团队，服务全球客户，对数据一致性与可用性要求极高。后端团队约 20 人，正在寻找一位资深分布式系统工程师，负责设计下一代事件驱动架构与跨区域数据同步方案。我们关注：1）对分布式共识、最终一致性、幂等性设计的深度理解；2）在复杂链路中的问题排查与根因分析能力；3）对性能优化的热情与对线上稳定性的敬畏。',
    turns: [
      {
        speaker: 'interviewer',
        text: '你好，欢迎参加面试。我们先从一个你最有把握的项目聊起——请挑一个你主导过的、涉及分布式数据一致性的关键项目，讲讲它的背景、你当时面临的核心挑战，以及你做了哪些关键决策。'
      },
      {
        speaker: 'candidate',
        text: '好的。我在电商中台负责订单履约系统。背景是：一笔订单从支付成功到最终出库，要依次经过库存扣减、优惠核销、物流下单三个独立的微服务，每个服务都有自己的数据库，而且为了容灾是跨机房部署的。最初我们用的是 TCC 事务模式，但两阶段提交在大促期间会长时间锁住库存记录，经常出现跨服务的死锁，订单大面积卡住。我主导把它重构成了基于 Saga 的异步补偿方案：每一步只提交自己的本地事务，并往 Kafka 写一条领域事件，由一个独立的补偿协调器消费这些事件、推进状态机，并定期扫描悬挂的事务做补偿。'
      },
      {
        speaker: 'interviewer',
        text: 'Saga 听起来解决了锁的问题，但补偿本身是有风险的。你们在落地补偿逻辑时踩过最深的坑是什么？又是怎么根治的？'
      },
      {
        speaker: 'candidate',
        text: '最深的坑是幂等性。我们的补偿逻辑必须可以安全地重试，但物流服务的外部接口并不保证幂等——第一次上线时，因为补偿协调器在网络超时后重试，导致同一个订单被重复下了两次物流单，真的发出去了两件货。复盘后我们做了两件事：第一，在补偿协调器里建了一张全局去重表，键是「订单号 + 业务步骤 + 补偿序号」，每次执行补偿前先抢占这把逻辑锁；第二，要求所有下游接口要么自己支持幂等键，要么由我们在网关层用唯一请求 ID 兜底。上线后重复履约的问题就彻底消失了。'
      },
      {
        speaker: 'interviewer',
        text: '明白。那我换个角度——你刚提到补偿协调器会「定期扫描悬挂事务」。这个扫描在高峰期会不会本身成为瓶颈或者风险点？你怎么保证它既及时又不会拖垮数据库？'
      },
      {
        speaker: 'candidate',
        text: '会，这块我们确实调了很久。一开始是单实例每 5 秒全表扫一遍 status != FINAL 的订单，大促时这张表有几千万行，扫描直接把从库拖慢了。后来改成了三层：第一层用 Kafka 事件驱动，正常情况下状态推进完全靠事件，根本不需要扫；第二层是一个只覆盖「最近 N 分钟、且处于中间态」的窄索引，兜底扫描只走这个索引，量很小；第三层才是低频的全量对账，放在凌晨低峰跑、并且限流。扫描实例之间用 Redis 抢分片锁，保证同一批订单不会被多个实例重复处理。改完之后兜底扫描对主链路几乎没有压力了。'
      },
      {
        speaker: 'interviewer',
        text: '我想顺着可观测性多问一句。你们这套订单履约 + 补偿协调器上线后，线上出过哪一次让你印象最深的故障？当时是怎么定位到根因的？'
      },
      {
        speaker: 'candidate',
        text: '印象最深的是一次「幽灵卡单」。监控显示订单成功率正常，但客服收到一批用户投诉说订单卡在「出库中」好几个小时。诡异的是我们的状态机里这些订单明明已经是 FINAL 了。我先拉了链路追踪，发现这些订单的领域事件在 Kafka 里其实都正常消费了，状态也推进到位了——问题出在一个读写分离的细节：履约状态写主库后，C 端查询走的是从库，而那段时间有一个大批量对账任务把从库的复制延迟拉到了分钟级，用户看到的是过期的从库快照。根因不在我们的事务逻辑，而在「写后读」的一致性窗口。我们的临时止血是把订单详情页这种强时效查询路由回主库，长期方案是给关键状态变更加了一个版本号，前端拿到版本号后如果发现从库落后就触发一次主库回源。这件事让我后来设计任何读写分离都会先问一句：这个读路径能不能容忍复制延迟。'
      },
      {
        speaker: 'interviewer',
        text: '你简历里提到主导了一个基于 Raft 的分布式任务调度平台，把调度延迟从平均 800ms 降到了 120ms。这个量级的下降主要来自哪里？是算法层面还是工程层面的优化？'
      },
      {
        speaker: 'candidate',
        text: '两方面都有，但更多是工程层面的。算法上，老平台是「抢占式数据库轮询」——每个调度节点定期扫一张任务表抢锁，锁竞争和轮询间隔本身就贡献了几百毫秒的固有延迟。换成 Raft 之后，任务的归属由 leader 直接决定并通过日志复制下发，省掉了抢锁这一层。但真正把延迟从三四百毫秒压到 120ms 的，是几个工程细节：第一，我们把「任务到期」从轮询改成了基于时间轮（hashed timing wheel）的事件触发，到点直接回调，不再依赖扫描周期；第二，Raft 的日志我们做了批量提交和 pipeline，把单条任务下发的多次 fsync 合并；第三，也是最容易被忽略的，我们发现早期 P99 毛刺其实来自 Java 的 GC，于是把调度热路径上的对象池化、换成了 ZGC，才让尾延迟稳定下来。所以我会说：架构选型决定了延迟的下限，但能不能真的摸到那个下限，靠的是把每一层的毛刺都量化、逐个敲掉。'
      },
      {
        speaker: 'interviewer',
        text: '最后一个问题：如果让你从零设计我们这边的跨区域数据同步，你预计最先会担心哪个失败场景？为什么？'
      },
      {
        speaker: 'candidate',
        text: '我最先担心的是「脑裂下的双写冲突」——两个区域在网络分区期间各自接受了对同一份数据的写入，分区恢复后怎么合并。我倾向于先按数据分类，而不是用一套一致性模型套所有数据：能接受最终一致的（比如用户偏好、浏览足迹），用带版本向量或 LWW 的异步复制，冲突走可预测的合并策略，并且把冲突率本身做成监控指标；强一致的关键数据（账户余额、库存这种），我宁可在分区期间牺牲可用性、只允许主区域写，其它区域降级为只读。我不会一上来就追求全局强一致，那个代价在跨区域几十毫秒的延迟下通常不可接受，而且会把一个本可以局部降级的故障放大成全局不可用。另外我会特别重视「分区恢复后的收敛可观测性」——必须能一眼看出哪些 key 还没收敛、收敛滞后多久，否则脑裂恢复就是一个黑盒，出了问题根本没法解释给业务方听。'
      }
    ]
  },
  {
    id: 'rich-pm-en',
    name: 'EN·Senior PM · B2B SaaS Interview',
    language: 'en',
    interviewType: 'online',
    resume:
      'Senior Product Manager with 8+ years in B2B SaaS, currently at CloudScale Analytics (Series C, 400 employees). Owns the enterprise analytics platform (React/Node.js, AWS, Snowflake). Drove a 22% reduction in time-to-insight for finance teams by redesigning the dashboard builder and shipping pre-built templates, lifting monthly active users 18%. Previously at WareHive (logistics SaaS), owned the inventory forecasting module; improved forecast accuracy from 68% to 85% via ML-driven anomaly detection, contributing ~$2.3M ARR over 18 months. Strong on discovery, metrics, and cross-functional delivery with eng + design + sales.',
    jd: 'We are hiring a Senior PM to own our integrations and data-ingestion platform. You will partner with engineering, sales, and customer success to define the roadmap for connecting our analytics product to 3rd-party tools (ERP, CRM, HRIS). Key challenges: prioritizing across dozens of integration requests, driving adoption of new connectors, and improving data-sync reliability. We want concrete, metrics-led decision-making, comfort with technical trade-offs, and ownership of outcomes when the path is ambiguous.',
    turns: [
      {
        speaker: 'interviewer',
        text: "Thanks for joining. Let's start broad: walk me through a product you led end-to-end recently — how you decided what to build, what you shipped, and the impact."
      },
      {
        speaker: 'candidate',
        text: "Sure. At CloudScale I led our interactive dashboard builder. Discovery came first: I shadowed 12 enterprise customers during their weekly analytics reviews and saw they spent roughly 30% of each session manually exporting data into Excel just to reformat charts. I validated the pain with a 200-person survey — 82% rated dashboard building as 'frustrating' or worse. I scoped an MVP around drag-and-drop plus a small set of pre-built templates, ran a two-week prototype with one design partner, then a phased rollout: 50 beta accounts, then GA. Time-to-insight dropped 22% and NPS among daily dashboard users went from 32 to 48."
      },
      {
        speaker: 'interviewer',
        text: 'Good outcomes. But every roadmap is a series of trade-offs. What did you explicitly choose NOT to build for that MVP, and why — and did any of those cuts come back to bite you?'
      },
      {
        speaker: 'candidate',
        text: "We cut three things deliberately: custom SQL inside the builder, real-time collaborative editing, and a mobile layout. The reasoning was that our research showed the core pain was speed-of-assembly for analysts on desktop, not collaboration or raw SQL power-use. Two of those cuts were fine. The one that bit us was mobile — within a month, sales flagged that several exec sponsors reviewed dashboards on their phones and the desktop-only layout looked broken to exactly the buyers who renew contracts. I'd misjudged who the 'viewer' persona was versus the 'builder' persona. We shipped a read-only responsive view in the next cycle, but I should have caught that the buyer and the builder weren't the same user."
      },
      {
        speaker: 'interviewer',
        text: "That's a candid answer. Now map it to this role — integrations. You'll get dozens of connector requests from sales. How would you prioritize which integrations to build first, concretely?"
      },
      {
        speaker: 'candidate',
        text: "I'd avoid a pure loudest-customer queue. I'd score requests on three axes: revenue-at-stake (ARR of deals blocked or at-risk, pulled from the CRM, not anecdotes), reach (how many existing customers also use that tool — I'd instrument which 3rd-party systems show up in our auth logs and support tickets), and build-cost (does the target have a clean API, or is it screen-scraping and ongoing maintenance). I'd weight reach and reliability heavily because integrations are a long-tail maintenance burden — a flaky connector to a popular ERP generates support load forever. I'd also reserve a slice of capacity for one strategic bet per quarter that sales can champion, so the framework doesn't feel like a black box to them."
      },
      {
        speaker: 'interviewer',
        text: "Say you ship a new connector. Shipping it is easy; driving adoption is the hard part. How would you make sure customers actually turn it on and keep using it, and how would you measure that?"
      },
      {
        speaker: 'candidate',
        text: "I treat a connector launch as a funnel, not a release. Three metrics: discovery (how many eligible accounts even saw it — I'd surface it contextually, e.g. the moment we detect that 3rd-party tool in their stack, not buried in a settings page), activation (connected a source and completed a first successful sync), and sustained use (still syncing 30 days later — integrations rot quietly when a token expires or an upstream schema changes). The biggest adoption killer I've seen isn't awareness, it's a painful first run: OAuth scopes that scare IT, or a field mapping the user doesn't understand. So I'd make time-to-first-successful-sync the headline metric, instrument every drop-off step in the setup wizard, and run the first ten activations white-glove so I can watch exactly where real users stall. For sustained use I'd add proactive health nudges — if a connector hasn't synced in N days or its auth is about to expire, tell the admin before the data goes stale, instead of letting them discover it in a board report. And I'd tie it back to revenue: which connectors correlate with retention and expansion, so the roadmap argument isn't 'customers asked' but 'this connector measurably keeps accounts healthy.'"
      },
      {
        speaker: 'interviewer',
        text: 'Last one: data-sync reliability is in the JD. If a connector starts silently dropping records, how would you even know, and how would you decide it is your team’s problem versus the vendor’s?'
      },
      {
        speaker: 'candidate',
        text: "First, I'd make silent failure impossible to stay silent: per-connector freshness and row-count reconciliation against the source, with alerting when deltas exceed a threshold, plus a customer-visible 'last synced / records synced' status so trust is observable. To localize fault, I'd trace each sync with a correlation id across our ingestion stages and tag where the count diverges — if records leave the vendor API but die in our transform, it's ours; if the vendor's API returns partial pages or rate-limits us, that's a vendor or contract issue I'd escalate with evidence. The PM job there is less about who's at fault and more about owning the customer's outcome while the data tells us where to push."
      }
    ]
  }
];

// Auto-include every generated template under ./samples/*.ts. Each such module
// exports one `InterviewSample` const; Vite's import.meta.glob (eager) pulls them
// in at build time, so dropping a new sample-N.ts into ./samples makes it appear
// in the New-interview picker with NO manual wiring. Built-ins first, then the
// generated ones sorted by file path for a stable order.
const generatedModules = import.meta.glob('./samples/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
const GENERATED_SAMPLES: InterviewSample[] = Object.keys(generatedModules)
  .sort()
  .flatMap((path) =>
    Object.values(generatedModules[path]).filter(
      (v): v is InterviewSample =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as { id?: unknown }).id === 'string' &&
        Array.isArray((v as { turns?: unknown }).turns)
    )
  );

/** All New-interview templates: built-ins + any generated ./samples/*.ts. */
export const INTERVIEW_SAMPLES: InterviewSample[] = [...BUILTIN_SAMPLES, ...GENERATED_SAMPLES];

/** Flatten a sample's turns into a single candidate-answer string for analysis. */
export function sampleTranscriptText(sample: InterviewSample): string {
  return sample.turns
    .map((turn) => `${turn.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${turn.text}`)
    .join('\n\n');
}
