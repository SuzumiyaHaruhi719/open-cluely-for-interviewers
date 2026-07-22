import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveReplayState } from '../src/replay-state.mjs';
import { cues, questionEvent, roleConfirmedMs } from '../src/timeline.mjs';

const stateAt = (timeMs) => deriveReplayState({ timeMs, cues, questionEvent, roleConfirmedMs });

test('candidate confirmation alone unlocks monitoring', () => {
  assert.equal(stateAt(roleConfirmedMs - 1).candidateRole, 'pending');
  assert.equal(stateAt(roleConfirmedMs).candidateRole, 'candidate');
  assert.equal(stateAt(roleConfirmedMs).monitorState, 'monitoring');
});

test('generation and one question occur in evidence order', () => {
  assert.equal(stateAt(questionEvent.generatingMs - 1).monitorState, 'monitoring');
  assert.equal(stateAt(questionEvent.generatingMs).monitorState, 'generating');
  assert.equal(stateAt(questionEvent.revealMs - 1).questionVisible, false);
  const revealed = stateAt(questionEvent.revealMs);
  assert.equal(revealed.questionVisible, true);
  assert.equal(revealed.visibleQuestions.length, 1);
  assert.equal(revealed.visibleQuestions[0].anchorCueId, 'p8-5');
});

test('seeking backward reconstructs state without sticky question data', () => {
  assert.equal(stateAt(80000).questionVisible, true);
  assert.equal(stateAt(30000).questionVisible, false);
});
