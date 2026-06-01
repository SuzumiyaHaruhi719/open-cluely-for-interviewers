// Built-in sample interviews for trying out Generate Q without a live transcript.
// Each sample carries a résumé + JD + a multi-turn transcript whose LAST turn is a
// long candidate answer (the thing the interviewer follows up on). Mixed zh/en so
// the copilot can be exercised across languages. Selected in the new-interview
// modal; seedInterviewSample() (renderer.js) injects it.
//
// Shape: { id, name, language, interviewType, resume, jd,
//          turns: [{ speaker: 'interviewer' | 'candidate', text }] }

export const INTERVIEW_SAMPLES = [
  {
    id: 'en-payments',
    name: 'EN · Senior Backend (payments)',
    language: 'en',
    interviewType: 'online',
    resume: `Senior Backend Engineer — 8 yrs. Payments & high-throughput services.
- Led the migration of a monolithic payments service to microservices at a mid-size fintech (300+ eng).
- Owned the order/settlement pipeline; introduced an async queue (Kafka) and idempotent retries.
- Reduced p99 checkout latency and on-call load; "personally drove the reliability program".
- Stack: Java/Spring, Kafka, Postgres, Redis, k8s. On-call lead for the payments domain.`,
    jd: `We're hiring a Senior Backend Engineer to own the reliability and scalability of our payments
platform (millions of transactions/day, strict consistency + auditability). You will lead architecture
for the settlement pipeline, drive on-call quality, and make hard consistency-vs-latency tradeoffs. We
value engineers who can show the judgment behind a decision, not just the outcome.`,
    turns: [
      { speaker: 'interviewer', text: 'Tell me about a recent project where you owned the technical design end-to-end.' },
      { speaker: 'candidate', text: "Sure. I led the migration of our payments service from a monolith to microservices. We had reliability issues during peak traffic." },
      { speaker: 'interviewer', text: 'What was the core problem you were solving with the redesign?' },
      { speaker: 'candidate', text: "The monolith coupled order capture and settlement in one synchronous path, so a slow downstream call would back up checkout. I redesigned the order pipeline and introduced an async queue with idempotent consumers." },
      { speaker: 'interviewer', text: 'And how did it go after the rollout?' },
      { speaker: 'candidate', text: "After the rollout, p99 latency dropped a lot and the on-call pages basically stopped. Honestly it was one of those things where once we decoupled the write path, everything got calmer — the team could sleep again. I drove most of the design myself, partnered with infra on the Kafka setup, and we shipped it over about a quarter without a major incident." }
    ]
  },
  {
    id: 'zh-growth',
    name: 'ZH · 增长产品经理',
    language: 'zh',
    interviewType: 'online',
    resume: `增长产品经理 · 6 年。负责 C 端用户增长与转化。
- 主导某电商 App 的新用户激活与留存项目，季度 DAU 显著提升。
- 搭建 A/B 实验体系，推动落地页与转化漏斗优化；"端到端负责增长策略到落地"。
- 擅长：增长模型、漏斗分析、用户分层、跨团队协作（市场/研发/数据）。`,
    jd: `我们在招一名资深增长产品经理，负责核心 C 端产品的拉新—激活—留存全链路。你需要独立设计增长实验、
在资源受限时做优先级取舍，并能说清每个决策背后的判断依据，而不仅仅是结果数字。需要与市场、研发、数据团队深度协作。`,
    turns: [
      { speaker: 'interviewer', text: '介绍一个你最近主导的增长项目，你具体负责哪一块？' },
      { speaker: 'candidate', text: '好的。我主导了我们 App 的新用户激活项目，目标是把首周留存做上去。' },
      { speaker: 'interviewer', text: '当时遇到的核心瓶颈是什么？' },
      { speaker: 'candidate', text: '新用户注册后很快流失，漏斗在“首次下单”这一步掉得很厉害。我们重做了新手引导，加了首单激励，还把推送节奏调整了一下。' },
      { speaker: 'interviewer', text: '最后效果怎么样？' },
      { speaker: 'candidate', text: '上线之后首周留存提升了不少，下单转化也明显变好。其实这个过程里我们团队真的拧成一股绳，市场、研发、数据一起 push，最后能有这样的结果挺不容易的。我个人主要负责整体策略和实验设计，具体的执行是大家一起做出来的。' }
    ]
  },
  {
    id: 'mixed-ml',
    name: 'Mixed · 算法/数据 (zh+en)',
    language: 'mixed',
    interviewType: 'online',
    resume: `机器学习工程师 · 5 年。推荐系统与排序模型。
- 负责某内容平台的 ranking model，离线 AUC 与线上 CTR 均有提升。
- 主导特征平台 (feature store) 建设；"贡献了组合主要超额收益"。
- Stack: Python, PyTorch, Spark, Flink, feature store, online serving。`,
    jd: `Hiring an ML engineer for our ranking/recommendation team. You'll own model design, the
offline→online consistency, and the feature pipeline. We care about how you reason about tradeoffs
(latency vs accuracy, complexity vs maintainability) and how you debug when offline gains don't
translate online. 中英文工作环境。`,
    turns: [
      { speaker: 'interviewer', text: '讲一个你负责的 ranking model 项目，你做了哪些关键决策？' },
      { speaker: 'candidate', text: '我负责内容平台的 ranking model 重构，主要是把原来的 GBDT 换成了 deep model，同时重建了 feature pipeline。' },
      { speaker: 'interviewer', text: 'Offline 和 online 的指标一致吗？遇到过 gap 吗？' },
      { speaker: 'candidate', text: '一开始 offline AUC 提升很明显，但 online CTR 没怎么动。后来发现是 feature 在 serving 时和训练时口径不一致，有 train-serving skew。我们排查了几周才定位到。' },
      { speaker: 'interviewer', text: '最后是怎么解决的？' },
      { speaker: 'candidate', text: "解决之后线上 CTR 就上来了。说实话这个项目我贡献了组合主要超额收益,但中间踩了不少坑,尤其是 feature 一致性那块。我现在做任何 offline 提升都会先 double check serving path,这是那次最大的教训。整体是我和另一个同事一起跑的,我主要 own 模型和特征这部分。" }
    ]
  },
  {
    id: 'en-em',
    name: 'EN · Engineering Manager (leadership)',
    language: 'en',
    interviewType: 'online',
    resume: `Engineering Manager — 10 yrs (4 as IC, 6 leading). Led teams of 6–15.
- Ran the platform team through a major re-org; "drove alignment top to bottom".
- Shipped a reliability initiative: blameless postmortems, on-call rotation overhaul.
- Comfortable with hard people calls; "I owned the tough decisions".`,
    jd: `Seeking an Engineering Manager for a 12-person platform team. You'll own delivery, team health,
and cross-org alignment, and make hard prioritization + people calls under ambiguity. We probe for the
reasoning and ownership behind your decisions — especially the ones that didn't go perfectly.`,
    turns: [
      { speaker: 'interviewer', text: 'Walk me through a time you led your team through a significant change.' },
      { speaker: 'candidate', text: "Sure — I led the platform team through a re-org where we merged two teams and changed our on-call model." },
      { speaker: 'interviewer', text: 'What made it hard?' },
      { speaker: 'candidate', text: "People were attached to the old ownership boundaries, and there was real friction about who owned what. I had to make some calls that not everyone agreed with, like collapsing two services under one team." },
      { speaker: 'interviewer', text: 'How did it land?' },
      { speaker: 'candidate', text: "Overall it was a good team outcome — we drove alignment top to bottom and delivery got more predictable. I won't pretend it was smooth; a couple of senior folks were unhappy and one eventually left. I owned the tough decisions and I'd mostly make them again, though I'd communicate the why earlier next time. It was a team effort but the hard calls were mine." }
    ]
  }
];

export function getInterviewSample(id) {
  return INTERVIEW_SAMPLES.find((s) => s.id === id) || null;
}
