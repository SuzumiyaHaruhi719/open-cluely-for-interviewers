import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const audioUrl = new URL('../assets/p8-full-interview-493s.mp3', import.meta.url);

test('the packaged replay uses the complete Seed-ASR-verified source MP3', async () => {
  const audio = await readFile(audioUrl);
  assert.equal(audio.length, 3_800_290);
  assert.equal(
    createHash('sha256').update(audio).digest('hex'),
    '6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2'
  );
});
