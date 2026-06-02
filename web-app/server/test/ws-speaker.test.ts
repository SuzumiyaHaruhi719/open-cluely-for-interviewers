import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerRoleMap } from '../src/speaker-roles';
import { stampRole, isCandidateFinal } from '../src/ws-speaker';

test('stampRole adds resolved role + keeps speakerId', () => {
  const roles = createSpeakerRoleMap();
  const out = stampRole(roles, { source: 'mic', text: 'hi', isFinal: true, speakerId: 0 });
  assert.deepEqual(out, { source: 'mic', text: 'hi', isFinal: true, speakerId: 0, speaker: 'interviewer' });
});
test('isCandidateFinal: only final candidate segments gate to analysis', () => {
  const roles = createSpeakerRoleMap();
  roles.resolve(0);
  assert.equal(isCandidateFinal(roles, { isFinal: true, speakerId: 1 }), true);
  assert.equal(isCandidateFinal(roles, { isFinal: false, speakerId: 1 }), false);
  assert.equal(isCandidateFinal(roles, { isFinal: true, speakerId: 0 }), false);
});
