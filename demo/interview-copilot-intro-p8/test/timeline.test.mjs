import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_DURATION_MS,
  SOURCE_PROFILE_ID,
  SOURCE_START_SECONDS,
  SOURCE_END_SECONDS,
  roleConfirmedMs,
  cues,
  questionEvent
} from '../src/timeline.mjs';

test('P8 replay is one ordered 84-second candidate-first proof from the exact demo audio', () => {
  assert.equal(SOURCE_PROFILE_ID, 'user-operations-p8');
  assert.equal(SOURCE_START_SECONDS, 392.2);
  assert.equal(SOURCE_END_SECONDS, 476.2);
  assert.equal(DEMO_DURATION_MS, 84000);
  assert.ok(roleConfirmedMs > 0 && roleConfirmedMs < questionEvent.generatingMs);
  assert.equal(questionEvent.generatingMs, 30000);
  assert.equal(questionEvent.revealMs, 33731);
  assert.equal(questionEvent.latencyMs, 3731);
  assert.equal(questionEvent.tokens, 3026);
  assert.equal(questionEvent.trigger, 'auto');
  assert.equal(
    questionEvent.text,
    '你提到为了拿到全网最低价，会停止与其他竞品合作。这个排他策略如何验证带来的是增量，而不是平台对单一品牌的依赖？'
  );
  assert.deepEqual(questionEvent.anchorQuotes, [
    '为了拿到全网最低价，会停止与其他竞品合作'
  ]);
  assert.match(questionEvent.rationale, /没有说明如何识别真实增量/);
  assert.match(questionEvent.rationale, /P8 级风险意识/);
  assert.match(questionEvent.expectedEvidence, /量化基线与增量指标/);
  assert.match(questionEvent.expectedEvidence, /退出机制/);
  assert.ok(cues.length >= 5);
  assert.ok(cues.every((cue, index) => cue.startMs <= cue.endMs && (index === 0 || cues[index - 1].startMs <= cue.startMs)));
  assert.ok(cues.every((cue) => Array.isArray(cue.reveal) && cue.reveal.length >= 2));
  assert.ok(cues.every((cue) => cue.reveal.every(([atMs, count], index) => (
    Number.isInteger(atMs) && Number.isInteger(count) &&
    atMs >= cue.startMs && atMs <= cue.endMs && count >= 0 &&
    (index === 0 || (cue.reveal[index - 1][0] <= atMs && cue.reveal[index - 1][1] <= count))
  ))));
  assert.ok(cues.some((cue) => cue.role === 'interviewer'));
  assert.ok(cues.some((cue) => cue.role === 'candidate'));
  assert.ok(cues.find((cue) => cue.id === questionEvent.anchorCueId)?.role === 'candidate');
  assert.ok(cues.every((cue) => !/物业|消防|园区/.test(cue.text)));
  const transcript = cues.map((cue) => cue.text).join('');
  assert.match(transcript, /第二个阶段是我要有很牛的优惠点/);
  assert.match(transcript, /那为什么银行愿意跟我们玩呢/);
  assert.match(transcript, /水至清则无鱼/);
  assert.match(transcript, /最终我是获益的/);
  assert.doesNotMatch(transcript, /一开始的时候怎么去做|银行已经谈好的利益点/);
});
