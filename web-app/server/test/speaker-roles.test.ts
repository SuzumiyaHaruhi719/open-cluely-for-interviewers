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
