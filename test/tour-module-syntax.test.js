const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

test('Electron tour module parses as ESM', () => {
  const source = fs.readFileSync('src/windows/assistant/tour.js', 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
});
