import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playerSource = await readFile(new URL('../src/player.mjs', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../src/entry.mjs', import.meta.url), 'utf8');

test('seeking is an intentional replay gesture that reveals the requested evidence', () => {
  assert.match(
    playerSource,
    /progress\.addEventListener\('input',\s*\(\)\s*=>\s*\{\s*markStarted\(\);\s*seekTo\(progress\.value\);\s*\}\);/s
  );
});

test('completed replay returns Arrow keys to the slide deck', () => {
  assert.match(playerSource, /onEnded\s*=\s*\(\)\s*=>\s*\{\}/);
  assert.match(playerSource, /audio\.addEventListener\('ended',[\s\S]*?notifyEnded\(\);\s*\}\);/);
  assert.match(entrySource, /onEnded:\s*\(\)\s*=>\s*\{[^}]*replayOwnsKeys\s*=\s*false;[^}]*activeElement[^}]*blur\(\);/s);
  assert.match(entrySource, /const targetIsTextEntry\s*=/);
  assert.doesNotMatch(entrySource, /const targetIsControl\s*=/);
});
