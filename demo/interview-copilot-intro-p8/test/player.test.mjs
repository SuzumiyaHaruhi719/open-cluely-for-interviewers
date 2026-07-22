import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playerSource = await readFile(new URL('../src/product-frame.mjs', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../src/entry.mjs', import.meta.url), 'utf8');

test('seeking is an intentional replay gesture that reveals the requested evidence', () => {
  assert.match(
    playerSource,
    /progress\.addEventListener\('input',\s*\(\)\s*=>\s*seekTo\(progress\.value\)\);/s
  );
});

test('leaving the demo pauses the embedded product while deck keys remain available', () => {
  assert.match(playerSource, /event\.data\s*===\s*'pause-product-frame'/);
  assert.match(entrySource, /sendToProduct\('pause-product-frame'\)/);
  assert.match(entrySource, /const targetIsTextEntry\s*=/);
  assert.doesNotMatch(entrySource, /const targetIsControl\s*=/);
});
