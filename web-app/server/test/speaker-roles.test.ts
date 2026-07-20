import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerRoleMap } from '../src/speaker-roles';

test('first speaker seen defaults to interviewer, second to candidate', () => {
  const m = createSpeakerRoleMap();
  assert.equal(m.resolve(0), 'interviewer');
  assert.equal(m.resolve(1), 'candidate');
  assert.equal(m.resolve(0), 'interviewer');
});
test('further speakers default to candidate', () => {
  const m = createSpeakerRoleMap();
  m.resolve(0); m.resolve(1);
  assert.equal(m.resolve(2), 'candidate');
});
test('null/unknown speaker id resolves to unknown without consuming a slot', () => {
  const m = createSpeakerRoleMap();
  assert.equal(m.resolve(null), 'unknown');
  assert.equal(m.resolve(0), 'interviewer');
});
test('setRole overrides the default and sticks', () => {
  const m = createSpeakerRoleMap();
  assert.equal(m.resolve(0), 'interviewer');
  m.setRole(0, 'candidate');
  assert.equal(m.resolve(0), 'candidate');
});
test('guess mode: setRole complements the other seen speaker', () => {
  const m = createSpeakerRoleMap();
  m.resolve(0); m.resolve(1);
  m.setRole(0, 'interviewer');
  assert.equal(m.resolve(0), 'interviewer');
  assert.equal(m.resolve(1), 'candidate');
});
test('no-guess (native clusters): unassigned ids resolve to unknown, no complement on setRole', () => {
  const m = createSpeakerRoleMap();
  m.setGuess(false);
  assert.equal(m.resolve(1), 'unknown');
  assert.equal(m.resolve(2), 'unknown');
  m.setRole(2, 'candidate');
  assert.equal(m.resolve(2), 'candidate');
  // No complement in no-guess mode: id 1 stays unknown (NOT flipped to interviewer).
  assert.equal(m.resolve(1), 'unknown');
});

test('reset clears sticky speaker labels while preserving native-cluster no-guess mode', () => {
  const m = createSpeakerRoleMap();
  m.setGuess(false);
  m.setRole(2, 'candidate');
  assert.equal(m.resolve(2), 'candidate');

  m.reset();

  assert.equal(m.resolve(2), 'unknown');
  assert.equal(m.resolve(1), 'unknown');
});

test('automatic role inference never overwrites an interviewer manual correction', () => {
  const m = createSpeakerRoleMap();
  m.setGuess(false);
  m.setRole(4, 'candidate');

  assert.equal(m.setAutoRole(4, 'interviewer'), false);
  assert.equal(m.resolve(4), 'candidate');
  assert.equal(m.setAutoRole(8, 'interviewer'), true);
  assert.equal(m.resolve(8), 'interviewer');
});

test('semantic turn overrides apply automatically but never beat a manual correction', () => {
  const m = createSpeakerRoleMap();
  m.setGuess(false);
  m.setAutoRole(4, 'interviewer');

  assert.equal(m.resolveTurnRole(4, 'candidate'), 'candidate');

  m.setRole(4, 'interviewer');
  assert.equal(m.resolveTurnRole(4, 'candidate'), 'interviewer');
});
