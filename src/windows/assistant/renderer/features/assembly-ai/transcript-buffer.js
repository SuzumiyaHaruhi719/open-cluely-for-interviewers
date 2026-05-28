import { normalizeSource } from './source-state.js';

// Default cap so a single bubble can't grow without bound during a long
// monologue. ~600 chars ≈ a paragraph; longer than this we force-flush so
// the message lands and the next sentence starts a fresh bubble.
const DEFAULT_MAX_BUFFER_CHARS = 600;

// Keep CJK letters / numbers / Latin alphanumerics for the equality and
// substring checks. Whitespace and punctuation collapse to a single space so
// "你好，世界" and "你好世界" compare equal. Critically, the previous
// implementation used /[^a-z0-9\s]/g which stripped all CJK — that turned
// any pure-Chinese transcript into an empty string and caused mergeText to
// silently drop the second half. See:
//   if (!incomingNorm) return current;
//   if (!currentNorm) return incoming;
// Those guards meant a Chinese sentence arriving during the merge window
// was thrown away instead of being concatenated.
function normalizeTranscriptForMerge(text) {
  return String(text || '')
    .toLowerCase()
    // Strip punct + symbols outright (no replacement space) so "你好，世界"
    // and "你好世界" collapse to the same canonical form for equality.
    .replace(/[\p{P}\p{S}]+/gu, '')
    .replace(/[\s　]+/gu, ' ')
    .trim();
}

// Tokenise a string into either whitespace-separated tokens (Latin) or
// per-character tokens (CJK and other scripts without word breaks). We pick
// one mode per string based on whether splitting on whitespace yields > 1
// token; mixed strings tokenise by character which is fine for overlap
// detection because identical English boundary words still match as a
// sequence of single-char tokens.
function tokeniseForOverlap(normalized) {
  if (!normalized) return [];
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts;
  return [...normalized.replace(/\s+/g, '')];
}

function joinTokens(tokens) {
  // If any token is multi-char we assume Latin and rejoin with spaces;
  // otherwise CJK-style with no separator.
  return tokens.some((t) => t.length > 1) ? tokens.join(' ') : tokens.join('');
}

function mergeTranscriptText(existingText, incomingText) {
  const current = String(existingText || '').trim();
  const incoming = String(incomingText || '').trim();

  if (!current) return incoming;
  if (!incoming) return current;

  const currentNorm = normalizeTranscriptForMerge(current);
  const incomingNorm = normalizeTranscriptForMerge(incoming);

  // Exact match (after normalization): keep whichever is longer in raw form
  // so punctuation/casing isn't lost.
  if (currentNorm && incomingNorm && currentNorm === incomingNorm) {
    return incoming.length >= current.length ? incoming : current;
  }

  // One is a substring of the other (e.g. paraformer re-emitted a partial
  // as the next final): keep the longer.
  if (currentNorm && incomingNorm) {
    if (incomingNorm.includes(currentNorm)) return incoming;
    if (currentNorm.includes(incomingNorm)) return current;
  }

  // Tail-of-current vs head-of-incoming overlap. Works for both Latin
  // (token = word) and CJK (token = char).
  const currentTokens = tokeniseForOverlap(currentNorm);
  const incomingTokens = tokeniseForOverlap(incomingNorm);
  const maxOverlap = Math.min(24, currentTokens.length, incomingTokens.length);
  let overlap = 0;
  for (let size = maxOverlap; size > 0; size -= 1) {
    const tail = currentTokens.slice(-size).join('');
    const head = incomingTokens.slice(0, size).join('');
    if (tail && tail === head) {
      overlap = size;
      break;
    }
  }

  if (overlap > 0) {
    // We detected overlap on the normalized tokens; rebuild the result by
    // appending the remainder of the *raw* incoming string. Find the raw
    // boundary by walking the same number of non-space chars.
    const trimmedIncoming = incoming.trim();
    const incomingNonSpace = trimmedIncoming.replace(/[\p{P}\p{S}\s　]+/gu, '');
    // How many normalized chars correspond to the overlap region?
    const overlapNormalizedChars = joinTokens(incomingTokens.slice(0, overlap)).replace(/\s+/g, '').length;
    if (overlapNormalizedChars >= incomingNonSpace.length) {
      // The whole incoming string was already part of current.
      return current;
    }
    // Walk raw incoming, counting non-space chars until we've consumed
    // `overlapNormalizedChars` of them, then take everything after.
    let consumed = 0;
    let cutIndex = 0;
    for (let i = 0; i < trimmedIncoming.length; i += 1) {
      if (consumed >= overlapNormalizedChars) {
        cutIndex = i;
        break;
      }
      const ch = trimmedIncoming[i];
      if (!/[\p{P}\p{S}\s　]/u.test(ch)) consumed += 1;
      cutIndex = i + 1;
    }
    const remainder = trimmedIncoming.slice(cutIndex).trim();
    if (!remainder) return current;
    return joinWithSeparator(current, remainder);
  }

  return joinWithSeparator(current, incoming);
}

// Join two transcript fragments with a sensible separator: a space for
// Latin-on-Latin, nothing for CJK-on-CJK, a space for the mixed case to
// keep them visually separated. We sniff by checking whether the boundary
// chars on either side are CJK.
function joinWithSeparator(left, right) {
  const isPunctOrSpace = (ch) => /[\s　\p{P}\p{S}]/u.test(ch);
  const isCjkChar = (ch) => {
    if (!ch) return false;
    const code = ch.codePointAt(0);
    return (
      (code >= 0x3400 && code <= 0x9FFF) ||   // CJK Unified Ideographs (+ Ext A)
      (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility Ideographs
      (code >= 0x3040 && code <= 0x30FF) ||   // Hiragana + Katakana
      (code >= 0xAC00 && code <= 0xD7AF)      // Hangul Syllables
    );
  };

  let lhsLast = '';
  for (let i = left.length - 1; i >= 0; i -= 1) {
    if (!isPunctOrSpace(left[i])) { lhsLast = left[i]; break; }
  }
  let rhsFirst = '';
  for (let i = 0; i < right.length; i += 1) {
    if (!isPunctOrSpace(right[i])) { rhsFirst = right[i]; break; }
  }
  if (isCjkChar(lhsLast) && isCjkChar(rhsFirst)) {
    return `${left}${right}`;
  }
  return `${left} ${right}`.replace(/\s+/g, ' ').trim();
}

export function createTranscriptBufferManager({
  onFlush,
  onBuffer,
  // 9 seconds: long enough that natural conversational pauses (3-6s) keep
  // a thought in one bubble, short enough that distinct topics still start
  // a new one. Was 2400ms which split nearly every Chinese sentence pair.
  mergeWindowMs = 9000,
  maxBufferChars = DEFAULT_MAX_BUFFER_CHARS
}) {
  const buffers = {
    mic: { text: '', segments: 0, timer: null, emotion: null },
    system: { text: '', segments: 0, timer: null, emotion: null }
  };

  function clearFinalTranscriptTimer(source) {
    const resolvedSource = normalizeSource(source);
    const timer = buffers[resolvedSource].timer;
    if (timer) {
      clearTimeout(timer);
      buffers[resolvedSource].timer = null;
    }
  }

  function resetFinalTranscriptBuffer(source) {
    const resolvedSource = normalizeSource(source);
    clearFinalTranscriptTimer(resolvedSource);
    buffers[resolvedSource].text = '';
    buffers[resolvedSource].segments = 0;
    buffers[resolvedSource].emotion = null;
  }

  function flushFinalTranscript(source, reason = 'pause-timeout') {
    const resolvedSource = normalizeSource(source);
    const buffer = buffers[resolvedSource];
    const text = String(buffer.text || '').trim();
    const segments = buffer.segments;
    const emotion = buffer.emotion;

    clearFinalTranscriptTimer(resolvedSource);
    buffer.text = '';
    buffer.segments = 0;
    buffer.emotion = null;

    if (!text) return;

    onFlush({ source: resolvedSource, text, reason, segments, emotion });
  }

  function queueFinalTranscript(source, text, emotion = null) {
    const resolvedSource = normalizeSource(source);
    const buffer = buffers[resolvedSource];

    buffer.text = mergeTranscriptText(buffer.text, text);
    buffer.segments += 1;

    if (emotion && emotion.tag) {
      const prev = buffer.emotion;
      const incomingConf = typeof emotion.confidence === 'number' ? emotion.confidence : -1;
      const prevConf = prev && typeof prev.confidence === 'number' ? prev.confidence : -1;
      if (!prev || incomingConf >= prevConf) {
        buffer.emotion = emotion;
      }
    }

    if (typeof onBuffer === 'function') {
      onBuffer({
        source: resolvedSource,
        text: buffer.text,
        segments: buffer.segments
      });
    }

    clearFinalTranscriptTimer(resolvedSource);

    // Force-flush when the bubble would exceed the cap so the user sees
    // progress instead of one ever-growing message.
    if (maxBufferChars > 0 && buffer.text.length >= maxBufferChars) {
      flushFinalTranscript(resolvedSource, 'max-buffer-chars');
      return;
    }

    buffer.timer = setTimeout(() => {
      flushFinalTranscript(resolvedSource, 'pause-timeout');
    }, mergeWindowMs);
  }

  function flushAllFinalTranscripts(reason = 'flush-all') {
    flushFinalTranscript('mic', reason);
    flushFinalTranscript('system', reason);
  }

  return {
    flushAllFinalTranscripts,
    flushFinalTranscript,
    queueFinalTranscript,
    resetFinalTranscriptBuffer,
    // Exported for unit-testing the merge logic.
    _mergeTranscriptText: mergeTranscriptText,
    _normalizeTranscriptForMerge: normalizeTranscriptForMerge
  };
}
