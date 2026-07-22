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
  assert.equal(revealed.visibleQuestions[0].anchorCueId, 'p8-candidate-2');
});

test('seeking backward reconstructs state without sticky question data', () => {
  assert.equal(stateAt(80000).questionVisible, true);
  assert.equal(stateAt(30000).questionVisible, false);
});

test('a caption row appears only after its first grapheme is audible', () => {
  assert.equal(stateAt(0).visibleCues.length, 0);
  const firstRevealMs = cues[0].reveal.find(([, count]) => count > 0)[0];
  assert.equal(stateAt(firstRevealMs - 1).visibleCues.length, 0);
  assert.equal(stateAt(firstRevealMs).visibleCues[0].id, cues[0].id);
  assert.ok(stateAt(firstRevealMs).visibleCues[0].visibleText.length > 0);
});

test('caption growth follows provider reveal checkpoints instead of linear interpolation', () => {
  const timedCue = {
    id: 'timed', startMs: 100, endMs: 1000, role: 'candidate', speakerId: 0,
    text: '甲乙丙丁戊', reveal: [[100, 1], [500, 2], [900, 5]]
  };
  const state = deriveReplayState({
    timeMs: 800,
    cues: [timedCue],
    questionEvent: { generatingMs: 2000, revealMs: 3000 },
    roleConfirmedMs: 0
  });
  assert.equal(state.visibleCues[0].visibleText, '甲乙');
});
