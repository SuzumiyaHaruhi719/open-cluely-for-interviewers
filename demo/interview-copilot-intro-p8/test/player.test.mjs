import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playerSource = await readFile(new URL('../src/player.mjs', import.meta.url), 'utf8');

test('seeking is an intentional replay gesture that reveals the requested evidence', () => {
  assert.match(
    playerSource,
    /progress\.addEventListener\('input',\s*\(\)\s*=>\s*\{\s*markStarted\(\);\s*seekTo\(progress\.value\);\s*\}\);/s
  );
});
