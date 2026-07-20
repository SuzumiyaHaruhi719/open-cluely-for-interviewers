const test = require('node:test');
const assert = require('node:assert');

const { mergeEnvironmentFileContent } = require('../src/bootstrap/environment');

test('saving ordinary preferences preserves environment-owned credentials verbatim', () => {
  const before = [
    '# deployment secrets',
    'VOLC_APP_ID=app-123',
    'VOLC_ACCESS_TOKEN=token-456',
    'VOLC_RESOURCE_ID=volc.seedasr.sauc.duration',
    'DASHSCOPE_API_KEY=sk-private',
    'HIDE_FROM_SCREEN_CAPTURE=false',
    ''
  ].join('\n');

  const after = mergeEnvironmentFileContent(before, {
    HIDE_FROM_SCREEN_CAPTURE: 'true',
    START_HIDDEN: 'false'
  });

  assert.match(after, /VOLC_APP_ID=app-123/);
  assert.match(after, /VOLC_ACCESS_TOKEN=token-456/);
  assert.match(after, /VOLC_RESOURCE_ID=volc\.seedasr\.sauc\.duration/);
  assert.match(after, /DASHSCOPE_API_KEY=sk-private/);
  assert.match(after, /HIDE_FROM_SCREEN_CAPTURE=true/);
  assert.match(after, /START_HIDDEN=false/);
});
