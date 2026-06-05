import test from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../src/ws';

// Regression for "Add a note to the context". The interviewer's manual note must
// reach the SERVER so the autonomous trigger's accumulated candidate answer includes
// it — NOT only the client analyze buffer, which auto-generation never reads (that
// was the long-standing "add note does nothing" bug). `dispatch` routes a
// `context-note` message to `injectNote`, which ws.ts wires to `feedCandidateAnswer`
// (append to the running answer → trigger.onCandidateFinal).
test('dispatch routes a context-note to injectNote with the note text', async () => {
  const injected: string[] = [];
  await dispatch(
    {} as never, // ws — unused by the context-note branch
    {} as never, // session
    {} as never, // relay
    {} as never, // trigger
    {} as never, // roles
    (note: string) => injected.push(note),
    () => {}, // resetAccumulated — unused by the context-note branch
    () => {}, // setContextGrounding — unused by the context-note branch
    { type: 'context-note', note: 'candidate was unsure about DB sharding' } as never
  );
  assert.deepEqual(injected, ['candidate was unsure about DB sharding']);
});

test('dispatch does not inject a note for an unrelated message', async () => {
  let called = false;
  await dispatch(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { setRole: () => {} } as never, // roles — used by set-speaker-role
    () => {
      called = true;
    },
    () => {}, // resetAccumulated — unused by the set-speaker-role branch
    () => {}, // setContextGrounding — unused by the set-speaker-role branch
    { type: 'set-speaker-role', speakerId: 0, role: 'candidate' } as never
  );
  assert.equal(called, false);
});
