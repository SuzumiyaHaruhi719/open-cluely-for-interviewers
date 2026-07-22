import evidence from '../fixtures/p8-full-seed-asr.json' with { type: 'json' };

export const SOURCE_PROFILE_ID = 'user-operations-p8';
export const COMPLETE_DURATION_MS = evidence.audioDurationMs;
export const COMPLETE_TRANSCRIPT_PROVIDER = evidence.provider;
export const COMPLETE_AUDIO_SHA256 = evidence.audioSha256;
export const speakerAssignments = Object.freeze(evidence.speakerAssignments.map(Object.freeze));

const graphemeCount = (text) => {
  if (globalThis.Intl?.Segmenter) {
    return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].length;
  }
  return Array.from(text).length;
};

const buildGraphemeReveal = (text, startMs, endMs) => {
  const count = graphemeCount(text);
  if (count === 0) return Object.freeze([]);
  const durationMs = Math.max(0, endMs - startMs);
  const denominator = Math.max(1, count - 1);
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze([
    index === count - 1 ? endMs : startMs + Math.floor((durationMs * index) / denominator),
    index + 1
  ])));
};

const redistributeSpeakerTurnWindows = (cues) => {
  const redistributed = [];
  for (let cursor = 0; cursor < cues.length;) {
    let turnEnd = cursor + 1;
    while (turnEnd < cues.length && cues[turnEnd].speakerId === cues[cursor].speakerId) turnEnd += 1;
    const turn = cues.slice(cursor, turnEnd);
    const startMs = turn[0].startMs;
    const endMs = turn.at(-1).endMs;
    const availableMs = Math.max(turn.length, endMs - startMs);
    const totalWeight = turn.reduce((sum, cue) => sum + Math.max(1, graphemeCount(cue.text)), 0);
    let turnCursorMs = startMs;
    let accumulatedWeight = 0;

    turn.forEach((cue, index) => {
      accumulatedWeight += Math.max(1, graphemeCount(cue.text));
      const cueEndMs = index === turn.length - 1
        ? endMs
        : startMs + Math.max(index + 1, Math.round((availableMs * accumulatedWeight) / totalWeight));
      redistributed.push({ ...cue, startMs: turnCursorMs, endMs: cueEndMs });
      turnCursorMs = cueEndMs;
    });

    cursor = turnEnd;
  }
  return redistributed;
};

/**
 * Seed ASR can finalize several ordered utterances in one provider batch. Divide
 * the time since the preceding batch between those utterances by grapheme count
 * so the replay preserves their order and shows live growth instead of dumping
 * an entire batch into the transcript at once. Provider final timestamps remain
 * available as `providerFinalMs` for audit/provenance.
 */
export function allocateCueWindows(finals) {
  const roughCues = [];
  let previousBatchMs = 0;
  for (let cursor = 0; cursor < finals.length;) {
    const providerFinalMs = finals[cursor].atMs;
    let batchEnd = cursor + 1;
    while (batchEnd < finals.length && finals[batchEnd].atMs === providerFinalMs) batchEnd += 1;
    const batch = finals.slice(cursor, batchEnd);
    const availableMs = Math.max(batch.length, providerFinalMs - previousBatchMs);
    const totalWeight = batch.reduce((sum, item) => sum + Math.max(1, graphemeCount(item.text)), 0);
    let batchCursorMs = previousBatchMs;
    let accumulatedWeight = 0;

    batch.forEach((item, index) => {
      const weight = Math.max(1, graphemeCount(item.text));
      accumulatedWeight += weight;
      const endMs = index === batch.length - 1
        ? providerFinalMs
        : previousBatchMs + Math.max(index + 1, Math.round((availableMs * accumulatedWeight) / totalWeight));
      const startMs = Math.min(endMs, batchCursorMs);
      roughCues.push({
        id: `p8-full-${item.seq}`,
        seq: item.seq,
        startMs,
        endMs,
        providerFinalMs,
        role: item.role,
        speakerId: item.speakerId,
        text: item.text
      });
      batchCursorMs = endMs;
    });

    previousBatchMs = providerFinalMs;
    cursor = batchEnd;
  }
  return Object.freeze(redistributeSpeakerTurnWindows(roughCues).map((cue) => Object.freeze({
    ...cue,
    reveal: buildGraphemeReveal(cue.text, cue.startMs, cue.endMs)
  })));
}

export const completeCues = allocateCueWindows(evidence.finals);
export const roleConfirmedMs = completeCues.find((cue) => cue.role === 'candidate')?.endMs ?? 0;
export const contextWindow = Object.freeze({ startMs: 280_000, endMs: 285_000 });

const featuredQuestion = evidence.autoQuestions.find((question) => question.tokensUsed?.total === 3026)
  ?? evidence.autoQuestions.at(-1);
export const questionEvent = Object.freeze({
  generatingMs: featuredQuestion.atMs - featuredQuestion.elapsedMs,
  revealMs: featuredQuestion.atMs,
  anchorCueId: `p8-full-${featuredQuestion.anchorSeq}`,
  latencyMs: featuredQuestion.elapsedMs,
  tokens: featuredQuestion.tokensUsed.total,
  trigger: 'auto',
  text: featuredQuestion.question,
  anchorQuotes: ['平台期靠“全”吸引有惯性的用户'],
  rationale: '候选人解释了平台从“全”到“优”的方向，但还没有给出升级优先级、可归因增量和停止条件；这些证据决定策略是否达到 P8 的组合治理要求。',
  expectedEvidence: '用户分层与基线、升级阈值、对照或增量口径、资源取舍、跨周期结果，以及未达标时的停止条件。',
  iterationVersion: 'expert_flash_v2'
});

export const allQuestionEvents = Object.freeze(evidence.autoQuestions.map((question) => Object.freeze({
  generatingMs: question.atMs - question.elapsedMs,
  revealMs: question.atMs,
  anchorCueId: `p8-full-${question.anchorSeq}`,
  anchorSeq: question.anchorSeq,
  latencyMs: question.elapsedMs,
  tokens: question.tokensUsed.total,
  trigger: 'auto',
  text: question.question
})));
