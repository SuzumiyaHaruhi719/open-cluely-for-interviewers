import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  COMPLETE_DURATION_MS,
  COMPLETE_TRANSCRIPT_PROVIDER,
  contextWindow,
  completeCues,
  questionEvent,
  roleConfirmedMs,
  speakerAssignments
} from '../src/full-timeline.mjs';
import { deriveReplayState, splitGraphemes } from '../src/replay-state.mjs';

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

test('an in-flight candidate answer reveals every grapheme instead of freezing on its first character', () => {
  const cue = completeCues.find((item) => item.seq === 4);
  assert.ok(cue, 'candidate self-introduction cue exists');
  const graphemes = splitGraphemes(cue.text);

  assert.ok(cue.endMs - cue.startMs >= 5_000, 'the spoken turn has a usable live-caption window');
  assert.equal(cue.reveal.length, graphemes.length);
  assert.deepEqual(cue.reveal.map(([, count]) => count), graphemes.map((_, index) => index + 1));
  assert.ok(cue.reveal.every(([atMs], index) => index === 0 || atMs >= cue.reveal[index - 1][0]));

  const sample = cue.reveal[Math.floor(cue.reveal.length / 3)];
  const state = deriveReplayState({
    timeMs: sample[0],
    cues: completeCues,
    questionEvent,
    roleConfirmedMs,
    contextWindow,
    demoDurationMs: COMPLETE_DURATION_MS
  });
  const visibleCue = state.visibleCues.find((item) => item.id === cue.id);
  assert.equal(splitGraphemes(visibleCue.visibleText).length, sample[1]);
  assert.ok(sample[1] > 1 && sample[1] < graphemes.length);
  assert.equal(visibleCue.isLive, true);
});

test('complete replay audio is byte-identical to the supplied MP3', async () => {
  const audio = await readFile(audioUrl);
  assert.equal(audio.length, 3_800_290);
  assert.equal(
    createHash('sha256').update(audio).digest('hex'),
    '6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2'
  );
});
