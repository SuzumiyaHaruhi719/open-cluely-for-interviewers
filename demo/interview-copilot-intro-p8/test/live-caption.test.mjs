import assert from 'node:assert/strict';
import test from 'node:test';

const liveCaption = await import('../src/live-caption.mjs').catch(() => ({}));

test('matches the Copilot 20 ms grapheme reveal contract', () => {
  assert.equal(liveCaption.LIVE_CAPTION_INTERVAL_MS, 20);
  assert.equal(liveCaption.initialLiveCaptionText('候选人回答完整'), '候');
  assert.equal(liveCaption.advanceLiveCaptionText('候', '候选人回答完整'), '候选');

  let displayed = liveCaption.initialLiveCaptionText('候选人回答完整');
  while (displayed !== '候选人回答完整') {
    displayed = liveCaption.advanceLiveCaptionText(displayed, '候选人回答完整');
  }
  assert.equal(displayed, '候选人回答完整');
});

test('rolls a corrected provider hypothesis back to its shared grapheme prefix', () => {
  assert.equal(
    liveCaption.reconcileLiveCaptionText('候选人回答', '候选者说明'),
    '候选'
  );
  assert.equal(
    liveCaption.reconcileLiveCaptionText('完全不同', '新的假设'),
    '新'
  );
});
