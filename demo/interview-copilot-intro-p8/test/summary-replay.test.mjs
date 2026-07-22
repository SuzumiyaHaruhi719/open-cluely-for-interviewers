import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUMMARY_REPLAY_DURATION_MS,
  deriveSummaryReplayState,
  renderSummaryMarkdown,
  summaryFixture
} from '../src/summary-replay.mjs';

test('summary replay moves through evidence, scoring, streaming, and complete phases', () => {
  assert.equal(SUMMARY_REPLAY_DURATION_MS, 3_200);
  assert.equal(deriveSummaryReplayState({ elapsedMs: 0 }).phase, 'evidence');
  assert.equal(deriveSummaryReplayState({ elapsedMs: 900 }).phase, 'scoring');
  const streaming = deriveSummaryReplayState({ elapsedMs: 2_400 });
  assert.equal(streaming.phase, 'streaming');
  assert.ok(streaming.visibleMarkdown.length > 0);
  assert.ok(streaming.visibleMarkdown.length < summaryFixture.reportMarkdown.length);
  const complete = deriveSummaryReplayState({ elapsedMs: 3_200 });
  assert.equal(complete.phase, 'complete');
  assert.equal(complete.progress, 1);
  assert.equal(complete.visibleMarkdown, summaryFixture.reportMarkdown);
});

test('safe summary renderer supports production Markdown without executing markup', () => {
  const html = renderSummaryMarkdown('## 结论\n**不推荐录用**\n- 引用：「证据」\n<script>alert(1)</script>');
  assert.match(html, /summary-md__h2/);
  assert.match(html, /<strong>不推荐录用<\/strong>/);
  assert.match(html, /summary-md__list/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('complete captured report renders all production scoring sections', () => {
  const html = renderSummaryMarkdown(summaryFixture.reportMarkdown);
  for (const heading of summaryFixture.requiredHeadings) {
    assert.match(html, new RegExp(heading.slice(3)));
  }
  assert.match(html, /不推荐录用/);
  assert.match(html, /战略规划与资源取舍/);
  assert.match(html, /进一步考察建议/);
});

