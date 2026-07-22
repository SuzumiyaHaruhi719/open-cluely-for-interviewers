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
import {
  LIVE_CAPTION_INTERVAL_MS,
  advanceLiveCaptionText
} from '../src/live-caption.mjs';
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

test('an in-flight candidate answer advances through bounded targets instead of freezing or dumping', () => {
  const cue = completeCues.find((item) => item.seq === 4);
  assert.ok(cue, 'candidate self-introduction cue exists');
  const graphemes = splitGraphemes(cue.text);

  assert.ok(cue.endMs - cue.startMs >= 5_000, 'the spoken turn has a usable live-caption window');
  assert.ok(cue.reveal.length >= Math.ceil(graphemes.length / 5));
  assert.ok(cue.reveal.every(([atMs, count], index) => (
    index === 0 || (atMs >= cue.reveal[index - 1][0] && count > cue.reveal[index - 1][1])
  )));
  assert.ok(cue.reveal.every(([, count], index) => index === 0 || count - cue.reveal[index - 1][1] <= 5));
  assert.equal(cue.reveal.at(-1)[1], graphemes.length);

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

test('every multi-grapheme provider target advances in 2–5-character batches', () => {
  for (const cue of completeCues) {
    const graphemeCount = splitGraphemes(cue.text).length;
    const counts = cue.reveal.map(([, count]) => count);
    const bursts = counts.map((count, index) => count - (index === 0 ? 0 : counts[index - 1]));
    if (graphemeCount === 1) {
      assert.deepEqual(bursts, [1], `cue ${cue.seq} is the one-grapheme exception`);
      continue;
    }
    assert.ok(
      bursts.every((size) => size >= 2 && size <= 5),
      `cue ${cue.seq} batches ${bursts.join(', ')} stay within the provider contract`
    );
  }
});

test('the final provider target drains through the 20ms smoother before cue finalization', () => {
  for (const cue of completeCues) {
    const graphemes = splitGraphemes(cue.text);
    if (graphemes.length === 1) continue;
    const finalIndex = cue.reveal.length - 1;
    const [finalTargetMs, finalCount] = cue.reveal[finalIndex];
    const previousCount = finalIndex === 0 ? 0 : cue.reveal[finalIndex - 1][1];
    const finalBurst = finalCount - previousCount;
    const requiredDrainMs = (finalBurst + 1) * LIVE_CAPTION_INTERVAL_MS;

    assert.ok(
      finalTargetMs <= cue.endMs - requiredDrainMs,
      `cue ${cue.seq} exposes its final target before the finalization boundary`
    );

    const target = graphemes.slice(0, finalCount).join('');
    let displayed = graphemes.slice(0, previousCount).join('');
    for (let step = 0; step < finalBurst; step += 1) {
      displayed = advanceLiveCaptionText(displayed, target);
    }
    assert.equal(displayed, cue.text, `cue ${cue.seq} can finish smoothing before finalization`);
  }
});

test('caption targets follow provider-like bursts and punctuation pauses instead of a metronome', () => {
  const cue = completeCues.find((item) => item.seq === 4);
  assert.ok(cue, 'candidate self-introduction cue exists');
  const graphemes = splitGraphemes(cue.text);
  const gaps = cue.reveal.slice(1).map(([atMs], index) => atMs - cue.reveal[index][0]);
  const bursts = cue.reveal.slice(1).map(([, count], index) => count - cue.reveal[index][1]);
  const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const deviation = Math.sqrt(
    gaps.reduce((sum, gap) => sum + ((gap - meanGap) ** 2), 0) / gaps.length
  );

  assert.ok(cue.reveal.length < graphemes.length * 0.65, 'provider targets arrive in chunks');
  assert.ok(bursts.some((size) => size >= 3), 'at least one target contains a short speech burst');
  assert.ok(deviation / meanGap > 0.2, 'target gaps have human-like cadence variation');

  const commaCount = graphemes.indexOf('，') + 1;
  const commaCheckpoint = cue.reveal.findIndex(([, count]) => count === commaCount);
  assert.ok(commaCheckpoint >= 0 && commaCheckpoint < cue.reveal.length - 1);
  const punctuationPause = cue.reveal[commaCheckpoint + 1][0] - cue.reveal[commaCheckpoint][0];
  const medianGap = [...gaps].sort((left, right) => left - right)[Math.floor(gaps.length / 2)];
  assert.ok(punctuationPause >= medianGap * 1.3, 'comma creates a visible listening pause');
  assert.equal(cue.reveal.at(-1)[1], graphemes.length);
  assert.ok(cue.reveal.at(-1)[0] < cue.endMs);
});

test('complete replay audio is byte-identical to the supplied MP3', async () => {
  const audio = await readFile(audioUrl);
  assert.equal(audio.length, 3_800_290);
  assert.equal(
    createHash('sha256').update(audio).digest('hex'),
    '6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2'
  );
});
