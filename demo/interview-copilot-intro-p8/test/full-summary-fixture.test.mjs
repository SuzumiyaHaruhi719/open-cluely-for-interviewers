import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('../fixtures/p8-full-summary.json', import.meta.url);

test('captured summary proves the production P8 DeepSeek input and model run', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));

  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.captureType, 'production-summary-replay');
  assert.equal(fixture.profileId, 'user-operations-p8');
  assert.equal(fixture.model, 'deepseek-v4-pro');
  assert.equal(fixture.fellBack, false);
  assert.equal(fixture.transcriptFinalCount, 48);
  assert.equal(fixture.audioDurationMs, 493_517);
  assert.equal(fixture.sourceAudioSha256, '6b770cdc29082de0ba5318be5c1130a6da7dca6fcdedab7fb3f7994e1e2f6dd2');
  assert.ok(fixture.transcriptCharacters > 3_000);
  assert.ok(fixture.summaryInputCharacters > fixture.transcriptCharacters);
  assert.ok(fixture.elapsedMs > 0);
  assert.ok(fixture.usage.input > 0);
  assert.ok(fixture.usage.output > 0);
  for (const key of ['promptSha256', 'transcriptSha256', 'jobDescriptionSha256', 'summaryInputSha256']) {
    assert.match(fixture[key], /^[a-f0-9]{64}$/);
  }
  assert.equal(fixture.summaryInputHeading, '# 面试完整记录');
  assert.doesNotMatch(JSON.stringify(fixture), /api[_-]?key|access[_-]?token|secret/i);
});

test('captured report follows every authoritative scoring section in order', async () => {
  const { reportMarkdown } = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const headings = [
    '## 综合结论与录用建议',
    '## 能力维度评分',
    '## 亮点',
    '## 风险与顾虑',
    '## 进一步考察建议'
  ];
  let cursor = -1;
  for (const heading of headings) {
    const next = reportMarkdown.indexOf(heading);
    assert.ok(next > cursor, `${heading} is present in production order`);
    cursor = next;
  }
  assert.match(reportMarkdown, /\*\*(?:强烈推荐录用|推荐录用|待定（需补充考察）|不推荐录用)\*\*/);
  assert.match(reportMarkdown, /引用[：:]/);
  assert.ok(reportMarkdown.length > 1_000);
});
