export const LIVE_CAPTION_INTERVAL_MS = 20;

export function splitLiveCaptionGraphemes(text) {
  const Segmenter = globalThis.Intl?.Segmenter;
  if (Segmenter) {
    return Array.from(
      new Segmenter('zh', { granularity: 'grapheme' }).segment(String(text ?? '')),
      (part) => part.segment
    );
  }
  return Array.from(String(text ?? ''));
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

export function initialLiveCaptionText(text) {
  return splitLiveCaptionGraphemes(text).slice(0, 1).join('');
}

/** Mirror TranscriptStream.ProgressiveLiveText when a provider hypothesis changes. */
export function reconcileLiveCaptionText(displayed, targetText) {
  const target = splitLiveCaptionGraphemes(targetText);
  const shown = splitLiveCaptionGraphemes(displayed);
  const shared = commonPrefixLength(shown, target);
  if (shared === shown.length) return String(displayed ?? '');
  return target.slice(0, Math.max(1, shared)).join('');
}

/** Mirror TranscriptStream.ProgressiveLiveText's 20 ms one-grapheme tick. */
export function advanceLiveCaptionText(displayed, targetText) {
  const target = splitLiveCaptionGraphemes(targetText);
  const shown = splitLiveCaptionGraphemes(displayed);
  const shared = commonPrefixLength(shown, target);
  if (shared < shown.length) {
    return target.slice(0, Math.max(1, shared)).join('');
  }
  if (shown.length >= target.length) return String(displayed ?? '');
  return target.slice(0, shown.length + 1).join('');
}
