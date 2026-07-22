export const SOURCE_PROFILE_ID = 'user-operations-p8';
export const SOURCE_START_SECONDS = 348.011;
export const SOURCE_END_SECONDS = 448.420;
export const DEMO_DURATION_MS = 100409;
export const roleConfirmedMs = 8500;

export const cues = [
  { id: 'p8-1', startMs: 0, endMs: 350, role: 'candidate', speakerId: 1, text: '嗯。' },
  { id: 'p8-2', startMs: 350, endMs: 2500, role: 'interviewer', speakerId: 0, text: '一开始的时候怎么去做呢？' },
  { id: 'p8-3', startMs: 2500, endMs: 19744, role: 'candidate', speakerId: 1, text: '那其实还是两个阶段，第一个阶段就是我们的平台期，我们的平台期其实' },
  { id: 'p8-4', startMs: 19744, endMs: 39669, role: 'candidate', speakerId: 1, text: '引入的都是一些成熟的银行已经谈好的利益点，而他们如果长期在使用这个利益点，也就证明他们在市场上是有一定竞争力的。也许有一些用户，他们可以通过各种渠道知道，星巴克其实在某一个平台要比招商银行、广发银行每周三、每周五的优惠利益点更大，但是更多' },
  { id: 'p8-5', startMs: 39669, endMs: 59950, role: 'candidate', speakerId: 1, text: '的海量用户其实是不知道，他们长期在使用银行的 App 去购买一些卡券。那么我们的核心目标用户群体是这些比较有惯性的人，那么我做的其实最开始不是说我要有多大的利益点去吸引我的用户，而是说我是有多全的利益点去吸引我的用户。那么用户来了之后，甚至有可能因为我的平台展示了' },
  { id: 'p8-6', startMs: 59950, endMs: 79616, role: 'candidate', speakerId: 1, text: '各个银行基于餐饮行业的利益点，他反而去办了一张该银行的卡。但第二个阶段是我要有很牛的优惠点的竞争力的时候，我为什么敢做？如果我什么品牌都做，我就很难有市场竞争力。但如果我主推一个品牌，我去帮他做市场的渗透的话，那我们其实是一个' },
  { id: 'p8-7', startMs: 79616, endMs: 100409, role: 'candidate', speakerId: 1, text: '强强联合的状态，那么我就要一个全平台、全网最低价，他就会愿意给我，因为我所有其他的竞品我都不合作，而且基于之前我跟银行的合作，我有大量的这种对你这个品类非常热爱的目标用户群体。你说你想不想要你竞争对手的用户吧？你要是想，你就给我一个最低价。' }
];

export const questionEvent = {
  generatingMs: 47889,
  revealMs: 51620,
  anchorCueId: 'p8-5',
  latencyMs: 3731,
  tokens: 3026,
  trigger: 'auto',
  text: '你提到平台期靠“全”吸引有惯性的用户，那么当用户因为你的平台更全而开始使用时，你如何判断哪些利益点需要从“全”升级为“优”？'
};
