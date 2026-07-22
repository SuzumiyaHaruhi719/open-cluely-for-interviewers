import { LIVE_CAPTION_INTERVAL_MS } from './live-caption.mjs';

const BURST_SIZES = Object.freeze([3, 2, 4, 3, 5, 2, 3, 4, 2, 5]);
const GAP_VARIATION = Object.freeze([0.82, 1.16, 0.9, 1.28, 0.76, 1.08, 0.94, 1.22, 0.86, 1.12]);
const CLAUSE_PUNCTUATION = new Set(['，', '、', '：', '；', ',', ':', ';']);
const SENTENCE_PUNCTUATION = new Set(['。', '！', '？', '!', '?']);

const splitGraphemes = (text) => {
  if (globalThis.Intl?.Segmenter) {
    return Array.from(
      new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(String(text ?? '')),
      (part) => part.segment
    );
  }
  return Array.from(String(text ?? ''));
};

const isPunctuation = (grapheme) => (
  CLAUSE_PUNCTUATION.has(grapheme) || SENTENCE_PUNCTUATION.has(grapheme)
);

const pauseWeightAfter = (grapheme) => {
  if (SENTENCE_PUNCTUATION.has(grapheme)) return 3.6;
  if (CLAUSE_PUNCTUATION.has(grapheme)) return 2.1;
  return 0;
};

const chooseBurstSize = (graphemes, cursor, desiredSize) => {
  const remaining = graphemes.length - cursor;
  if (remaining <= 5) return remaining;

  const punctuationSizes = [];
  for (let size = 2; size <= 5; size += 1) {
    if (remaining - size === 1) continue;
    if (isPunctuation(graphemes[cursor + size - 1])) punctuationSizes.push(size);
  }
  if (punctuationSizes.length > 0) {
    return punctuationSizes.sort((left, right) => (
      Math.abs(left - desiredSize) - Math.abs(right - desiredSize) || left - right
    ))[0];
  }

  let size = Math.min(5, Math.max(2, desiredSize));
  if (remaining - size === 1) size -= 1;
  return size;
};

/**
 * Model provider partials, not a typewriter. Seed ASR normally sends short,
 * uneven hypotheses; the UI then smooths each target one grapheme per 20 ms.
 */
export function buildProviderLikeReveal(text, startMs, endMs) {
  const graphemes = splitGraphemes(text);
  if (graphemes.length === 0) return Object.freeze([]);
  if (graphemes.length === 1) return Object.freeze([Object.freeze([startMs, 1])]);

  const offset = (graphemes.length + (graphemes[0]?.codePointAt(0) ?? 0)) % BURST_SIZES.length;
  const targets = [];
  let cursor = 0;
  let burstIndex = 0;
  while (cursor < graphemes.length) {
    const desiredSize = BURST_SIZES[(offset + burstIndex) % BURST_SIZES.length];
    const burstSize = chooseBurstSize(graphemes, cursor, desiredSize);
    cursor += burstSize;
    targets.push(cursor);
    burstIndex += 1;
  }

  const previousFinalCount = targets.length === 1 ? 0 : targets.at(-2);
  const finalBurstSize = targets.at(-1) - previousFinalCount;
  const finalDrainMs = (finalBurstSize + 1) * LIVE_CAPTION_INTERVAL_MS;
  const revealEndMs = Math.max(startMs, endMs - finalDrainMs);
  const intervalWeights = targets.slice(1).map((count, index) => {
    const previousCount = targets[index];
    const burstSize = count - previousCount;
    const variation = GAP_VARIATION[(offset + index) % GAP_VARIATION.length];
    return (burstSize * variation) + pauseWeightAfter(graphemes[previousCount - 1]);
  });
  const totalWeight = intervalWeights.reduce((sum, weight) => sum + weight, 0);
  const durationMs = Math.max(0, revealEndMs - startMs);
  let accumulatedWeight = 0;

  return Object.freeze(targets.map((count, index) => {
    if (index === 0) return Object.freeze([startMs, count]);
    accumulatedWeight += intervalWeights[index - 1];
    const atMs = index === targets.length - 1
      ? revealEndMs
      : startMs + Math.round((durationMs * accumulatedWeight) / totalWeight);
    return Object.freeze([atMs, count]);
  }));
}
