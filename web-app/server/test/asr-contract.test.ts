import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASR_PROVIDERS } from '@open-cluely/contract';

test('the public ASR contract exposes Doubao while keeping only internal test fallbacks', () => {
  assert.deepEqual([...ASR_PROVIDERS], ['volc', 'paraformer', 'sim']);
  assert.equal(ASR_PROVIDERS.includes('xfyun' as never), false);
});
