export function splitGraphemes(text) {
  if (globalThis.Intl?.Segmenter) {
    return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  }
  return Array.from(text);
}

function visibleText(cue, timeMs) {
  if (timeMs >= cue.endMs) return cue.text;
  if (timeMs <= cue.startMs) return '';
  const graphemes = splitGraphemes(cue.text);
  const ratio = (timeMs - cue.startMs) / Math.max(1, cue.endMs - cue.startMs);
  return graphemes.slice(0, Math.max(1, Math.floor(graphemes.length * ratio))).join('');
}

export function deriveReplayState({ timeMs, cues, questionEvent, roleConfirmedMs }) {
  const boundedTime = Math.max(0, timeMs);
  const visibleCues = cues
    .filter((cue) => cue.startMs <= boundedTime)
    .map((cue) => ({ ...cue, visibleText: visibleText(cue, boundedTime), isLive: boundedTime < cue.endMs }));
  const candidateRole = boundedTime >= roleConfirmedMs ? 'candidate' : 'pending';
  const questionVisible = boundedTime >= questionEvent.revealMs;
  const monitorState = questionVisible
    ? 'question-ready'
    : boundedTime >= questionEvent.generatingMs
      ? 'generating'
      : candidateRole === 'candidate'
        ? 'monitoring'
        : 'waiting-candidate';
  return {
    timeMs: boundedTime,
    candidateRole,
    monitorState,
    visibleCues,
    questionVisible,
    visibleQuestions: questionVisible ? [questionEvent] : []
  };
}
