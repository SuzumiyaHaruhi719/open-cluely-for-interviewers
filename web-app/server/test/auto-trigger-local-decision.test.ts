import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideLocalTrigger } from '../src/auto-trigger';

test('substantive candidate evidence is admitted without a second model call', () => {
  const decision = decideLocalTrigger(
    '我先核对了消防巡检记录，然后组织夜间盲演，发现两个岗位的响应时间超标，最后调整班次并将到场时间缩短了三分钟。'
  );

  assert.equal(decision.shouldGenerate, true);
  assert.match(decision.focusHint, /证据缺口|决策|结果/);
});

test('pleasantries and filler are rejected locally', () => {
  assert.equal(decideLocalTrigger('好的，谢谢老师。').shouldGenerate, false);
  assert.equal(decideLocalTrigger('嗯嗯，这个怎么说呢。').shouldGenerate, false);
});

test('a long but cut-off candidate fragment waits for more information', () => {
  const decision = decideLocalTrigger(
    '我先核对消防巡检记录，再组织夜间盲演，发现两个岗位的响应时间超标，并记录各岗位的实际到场时间和处置步骤。接下来我会协调物业和工程团队，因为'
  );

  assert.equal(decision.shouldGenerate, false);
  assert.match(decision.reason, /未结束|更多信息/);
});

test('length padding without concrete actions or outcomes is not enough evidence', () => {
  const decision = decideLocalTrigger(
    '我认为这个事情非常重要，我们应该认真对待并积极处理。'.repeat(6)
  );

  assert.equal(decision.shouldGenerate, false);
  assert.match(decision.reason, /证据|信息/);
});

test('information-rich ASR text may be admitted without terminal punctuation', () => {
  const decision = decideLocalTrigger(
    '我负责三万平方米园区，先核对消防巡检记录，再组织夜间盲演，发现两个岗位响应超时，最终调整排班，把平均到场时间从八分钟缩短到五分钟'
  );

  assert.equal(decision.shouldGenerate, true);
});
