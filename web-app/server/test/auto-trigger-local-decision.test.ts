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
