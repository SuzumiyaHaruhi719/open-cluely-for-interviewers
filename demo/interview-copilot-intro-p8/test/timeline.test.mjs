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

test('P8 replay is one ordered 100.409-second candidate-first proof', () => {
  assert.equal(SOURCE_PROFILE_ID, 'user-operations-p8');
  assert.equal(SOURCE_START_SECONDS, 348.011);
  assert.equal(SOURCE_END_SECONDS, 448.420);
  assert.equal(DEMO_DURATION_MS, 100409);
  assert.ok(roleConfirmedMs > 0 && roleConfirmedMs < questionEvent.generatingMs);
  assert.equal(questionEvent.generatingMs, 47889);
  assert.equal(questionEvent.revealMs, 51620);
  assert.equal(questionEvent.latencyMs, 3731);
  assert.equal(questionEvent.tokens, 3026);
  assert.equal(questionEvent.trigger, 'auto');
  assert.equal(
    questionEvent.text,
    '你提到平台期靠“全”吸引有惯性的用户，那么当用户因为你的平台更全而开始使用时，你如何判断哪些利益点需要从“全”升级为“优”？'
  );
  assert.ok(cues.length >= 7);
  assert.ok(cues.every((cue, index) => cue.startMs <= cue.endMs && (index === 0 || cues[index - 1].startMs <= cue.startMs)));
  assert.ok(cues.some((cue) => cue.role === 'interviewer'));
  assert.ok(cues.some((cue) => cue.role === 'candidate'));
  assert.ok(cues.find((cue) => cue.id === questionEvent.anchorCueId)?.role === 'candidate');
  assert.ok(cues.every((cue) => !/物业|消防|园区/.test(cue.text)));
});
