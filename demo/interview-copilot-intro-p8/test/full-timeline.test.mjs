import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  COMPLETE_DURATION_MS,
  COMPLETE_TRANSCRIPT_PROVIDER,
  completeCues,
  speakerAssignments
} from '../src/full-timeline.mjs';

const fixtureUrl = new URL('../fixtures/p8-full-seed-asr.json', import.meta.url);
const audioUrl = new URL('../assets/p8-full-interview-493s.mp3', import.meta.url);

test('complete replay packages the exact 493-second Seed ASR evidence', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));

  assert.equal(fixture.audioDurationMs, 493_517);
  assert.equal(fixture.provider, 'doubao-seed-asr-2.0');
  assert.equal(fixture.finals.length, 48);
  assert.deepEqual(fixture.speakerAssignments, [
    { speakerId: 0, role: 'interviewer', confidence: 0.93 },
    { speakerId: 1, role: 'candidate', confidence: 0.95 },
    { speakerId: 2, role: 'unknown', confidence: 0 }
  ]);
});

test('complete timeline exposes every final in chronological order with voiceprint roles', () => {
  assert.equal(COMPLETE_DURATION_MS, 493_517);
  assert.equal(COMPLETE_TRANSCRIPT_PROVIDER, 'doubao-seed-asr-2.0');
  assert.equal(completeCues.length, 48);
  assert.deepEqual(speakerAssignments.map(({ speakerId, role }) => ({ speakerId, role })), [
    { speakerId: 0, role: 'interviewer' },
    { speakerId: 1, role: 'candidate' },
    { speakerId: 2, role: 'unknown' }
  ]);
  assert.ok(completeCues.every((cue, index) => index === 0 || cue.endMs >= completeCues[index - 1].endMs));
  assert.ok(completeCues.every((cue) => cue.role === speakerAssignments.find((assignment) => assignment.speakerId === cue.speakerId)?.role));
  assert.match(completeCues.find((cue) => cue.role === 'candidate')?.text ?? '', /面试官你好/);
});

test('complete replay audio is byte-identical to the supplied MP3', async () => {
  const audio = await readFile(audioUrl);
  assert.equal(audio.length, 3_800_290);
  assert.equal(
    createHash('sha256').update(audio).digest('hex'),
    '6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2'
  );
});

