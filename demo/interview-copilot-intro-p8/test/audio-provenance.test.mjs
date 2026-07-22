import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const audioUrl = new URL('../assets/p8-real-interview-84s.m4a', import.meta.url);

test('the packaged replay uses the Seed-ASR-verified 84-second source export', async () => {
  const audio = await readFile(audioUrl);
  assert.equal(
    createHash('sha256').update(audio).digest('hex'),
    '56beb4525fa62e6056e83b951efa062d98e39a1422177f72ee26b1dfb15a43e5'
  );
});
