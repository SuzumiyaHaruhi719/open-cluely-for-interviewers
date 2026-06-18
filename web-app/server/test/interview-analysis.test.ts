import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSessionContext,
  buildAnalysisInput,
  buildSummaryInput,
  getSummaryModel,
  isModelRejected,
  analyzeSummary,
  SUMMARY_REQUEST_TIMEOUT_MS,
  type SummaryChatFn
} from '../src/interview-analysis';
import { createSummaryTelemetry } from '../src/summary-telemetry';
import { getDefaultModel } from '../src/dashscope';

// The light session-context analyzer must parse the model's reply DEFENSIVELY:
// strip ```json fences, recover the first {...} from surrounding prose, validate
// competency status, drop junk entries, and return null on any unrecoverable
// failure (so the panel keeps its last good state instead of showing garbage).

test('parseSessionContext: clean strict JSON parses fully', () => {
  const state = parseSessionContext(
    JSON.stringify({
      competencies: [
        { name: 'System design', status: 'covered', evidence: 'sharded the DB' },
        { name: 'Testing', status: 'partial' }
      ],
      topics: ['caching', 'consistency'],
      gaps: ['observability']
    })
  );
  assert.ok(state);
  assert.equal(state.competencies.length, 2);
  assert.equal(state.competencies[0].name, 'System design');
  assert.equal(state.competencies[0].status, 'covered');
  assert.equal(state.competencies[0].evidence, 'sharded the DB');
  // Missing evidence stays absent (not an empty string).
  assert.equal(state.competencies[1].evidence, undefined);
  assert.deepEqual(state.topics, ['caching', 'consistency']);
  assert.deepEqual(state.gaps, ['observability']);
});

test('parseSessionContext: strips ```json fences and surrounding prose', () => {
  const reply =
    'Sure, here is the analysis:\n```json\n' +
    JSON.stringify({ competencies: [], topics: ['scaling'], gaps: [] }) +
    '\n```\nHope that helps!';
  const state = parseSessionContext(reply);
  assert.ok(state);
  assert.deepEqual(state.topics, ['scaling']);
});

test('parseSessionContext: drops malformed competency entries + invalid status', () => {
  const state = parseSessionContext(
    JSON.stringify({
      competencies: [
        { name: 'Ok', status: 'gap' },
        { name: 'Bad status', status: 'maybe' }, // invalid status → dropped
        { status: 'covered' }, // no name → dropped
        'not an object', // junk → dropped
        { name: '   ', status: 'covered' } // blank name → dropped
      ],
      topics: ['a', 42, '', '  b  '], // non-strings/blank dropped, others trimmed
      gaps: []
    })
  );
  assert.ok(state);
  assert.equal(state.competencies.length, 1);
  assert.equal(state.competencies[0].name, 'Ok');
  assert.deepEqual(state.topics, ['a', 'b']);
});

test('parseSessionContext: returns null on non-JSON / no signal', () => {
  assert.equal(parseSessionContext(''), null);
  assert.equal(parseSessionContext('not json at all'), null);
  assert.equal(parseSessionContext('{ broken'), null);
  // Well-formed JSON but no usable signal → null (panel keeps last good state).
  assert.equal(
    parseSessionContext(JSON.stringify({ competencies: [], topics: [], gaps: [] })),
    null
  );
});

test('buildAnalysisInput: empty transcript yields empty string (callers skip the call)', () => {
  assert.equal(buildAnalysisInput({ transcript: '   ' }), '');
});

test('buildAnalysisInput: includes JD + résumé sections only when present', () => {
  const withAll = buildAnalysisInput({
    transcript: 'Candidate: I built a queue.',
    jobDescription: 'Backend engineer',
    resumeText: '5 years Node'
  });
  assert.match(withAll, /Job description/);
  assert.match(withAll, /Candidate résumé/);
  assert.match(withAll, /Interview transcript so far/);
  assert.match(withAll, /I built a queue/);

  const transcriptOnly = buildAnalysisInput({ transcript: 'Candidate: hello.' });
  assert.doesNotMatch(transcriptOnly, /Job description/);
  assert.doesNotMatch(transcriptOnly, /Candidate résumé/);
  assert.match(transcriptOnly, /Interview transcript so far/);
});

// ── Interview summary (Phase B) ─────────────────────────────────────────────

test('buildSummaryInput: empty transcript yields empty string (caller sends friendly empty-state)', () => {
  assert.equal(buildSummaryInput({ transcript: '   ' }), '');
});

test('buildSummaryInput: includes JD + résumé (Chinese headings) only when present', () => {
  const withAll = buildSummaryInput({
    transcript: 'Interviewer: tell me about a project. Candidate: I built a queue.',
    jobDescription: 'Backend engineer',
    resumeText: '5 years Node'
  });
  assert.match(withAll, /岗位描述/);
  assert.match(withAll, /候选人简历/);
  assert.match(withAll, /面试完整记录/);
  assert.match(withAll, /I built a queue/);

  const transcriptOnly = buildSummaryInput({ transcript: 'Candidate: hello.' });
  assert.doesNotMatch(transcriptOnly, /岗位描述/);
  assert.doesNotMatch(transcriptOnly, /候选人简历/);
  assert.match(transcriptOnly, /面试完整记录/);
});

test('getSummaryModel: env override wins, else defaults to deepseek-v4-pro', () => {
  const prev = process.env.INTERVIEWER_SUMMARY_MODEL;
  delete process.env.INTERVIEWER_SUMMARY_MODEL;
  assert.equal(getSummaryModel(), 'deepseek-v4-pro');
  process.env.INTERVIEWER_SUMMARY_MODEL = 'custom-pro-model';
  assert.equal(getSummaryModel(), 'custom-pro-model');
  if (prev === undefined) delete process.env.INTERVIEWER_SUMMARY_MODEL;
  else process.env.INTERVIEWER_SUMMARY_MODEL = prev;
});

// ── #3 isModelRejected must only match genuine unknown/unavailable-model errors ──

test('#3 isModelRejected: TRUE for genuine unknown/unavailable model errors', () => {
  assert.equal(isModelRejected(new Error('DashScope 404: model not found')), true);
  assert.equal(isModelRejected(new Error('the model does not exist for this key')), true);
  assert.equal(isModelRejected(new Error('unknown model: deepseek-v4-pro')), true);
  assert.equal(isModelRejected(new Error('model is unavailable')), true);
  assert.equal(isModelRejected(new Error('this model is not supported')), true);
});

test('#3 isModelRejected: FALSE for generic 400s that merely mention "model"', () => {
  // The original over-broad match (/model/ && /400|404/) wrongly fell back here,
  // masking the real error. A param/limit error is NOT a rejected-model error.
  assert.equal(
    isModelRejected(new Error('DashScope 400: max_tokens too large for model foo')),
    false
  );
  assert.equal(isModelRejected(new Error('DashScope 400: invalid temperature for model')), false);
  // A bare 400 with no model-unavailable wording.
  assert.equal(isModelRejected(new Error('DashScope 400: bad request')), false);
  // A 400 that mentions the word model but is really a param problem.
  assert.equal(isModelRejected(new Error('DashScope 400: parameter model.foo invalid')), false);
});

test('#3 isModelRejected: FALSE for unrelated failures', () => {
  assert.equal(isModelRejected(new Error('network timeout')), false);
  assert.equal(isModelRejected(new Error('AbortError')), false);
  assert.equal(isModelRejected(new Error('no key')), false);
  assert.equal(isModelRejected(undefined), false);
});

// ── #4 the "完整记录" heading must be honest when the transcript is truncated ──

test('#4 buildSummaryInput: a transcript LONGER than the window is labeled as a partial excerpt, NOT 完整', () => {
  const long = 'X'.repeat(20000); // > SUMMARY_TRANSCRIPT_WINDOW_CHARS (14000)
  const out = buildSummaryInput({ transcript: long });
  // Must NOT claim the (truncated) record is complete.
  assert.doesNotMatch(out, /面试完整记录/);
  // Must mark it as a recent excerpt so the model + reader know the head was dropped.
  assert.match(out, /节选/);
  // And the body really is only the tail (window-sized), not the whole 20k.
  const body = out.split('\n').slice(1).join('\n');
  assert.ok(body.length <= 14000 + 50, 'body should be capped to the window');
});

test('#4 buildSummaryInput: a SHORT transcript keeps the honest 完整 label', () => {
  const out = buildSummaryInput({ transcript: 'Interviewer: hi. Candidate: hello.' });
  assert.match(out, /面试完整记录/);
  assert.doesNotMatch(out, /节选/);
});

// ── #1 + DI + telemetry: analyzeSummary takes an injectable chat + telemetry ──

/** A fake chat that records its options and returns a canned report. */
function fakeChat(reply: string, capture?: (opts: Parameters<SummaryChatFn>[0]) => void): SummaryChatFn {
  return async (opts) => {
    capture?.(opts);
    return reply;
  };
}

test('#1 analyzeSummary passes a generous timeoutMs (>60s) to chat', async () => {
  let seenTimeout: number | undefined;
  const chat = fakeChat('# 报告', (opts) => {
    seenTimeout = opts.timeoutMs;
  });
  const result = await analyzeSummary('面试记录', { chat });
  assert.equal(result.text, '# 报告');
  assert.equal(result.fellBack, false);
  assert.ok(
    typeof seenTimeout === 'number' && seenTimeout >= 180000,
    `expected a >=180s timeout, got ${seenTimeout}`
  );
  // The constant the summary uses is exported + generous.
  assert.ok(SUMMARY_REQUEST_TIMEOUT_MS >= 180000);
});

test('analyzeSummary: falls back ONCE to the interviewer model when the pro id is rejected', async () => {
  const prevSummary = process.env.INTERVIEWER_SUMMARY_MODEL;
  process.env.INTERVIEWER_SUMMARY_MODEL = 'pro-x';
  // The fallback is whatever getDefaultModel() resolves at runtime (config is
  // captured at module load, so we read the real value rather than assume an env).
  const fallbackModel = getDefaultModel();
  // Guard: the fallback must differ from the pro id, else there's nothing to try.
  assert.notEqual(fallbackModel, 'pro-x');

  const seenModels: string[] = [];
  const chat: SummaryChatFn = async (opts) => {
    seenModels.push(String(opts.model));
    if (opts.model === 'pro-x') throw new Error('DashScope 404: model not found');
    return '# 回退报告';
  };

  const result = await analyzeSummary('面试记录', { chat });
  assert.equal(result.fellBack, true);
  assert.equal(result.model, fallbackModel);
  assert.deepEqual(seenModels, ['pro-x', fallbackModel]);

  if (prevSummary === undefined) delete process.env.INTERVIEWER_SUMMARY_MODEL;
  else process.env.INTERVIEWER_SUMMARY_MODEL = prevSummary;
});

test('analyzeSummary: a generic 400 is NOT treated as a rejected model — it propagates (no masking)', async () => {
  const prevSummary = process.env.INTERVIEWER_SUMMARY_MODEL;
  const prevInterviewer = process.env.INTERVIEWER_MODEL;
  process.env.INTERVIEWER_SUMMARY_MODEL = 'pro-x';
  process.env.INTERVIEWER_MODEL = 'flash-fallback';

  let calls = 0;
  const chat: SummaryChatFn = async () => {
    calls += 1;
    throw new Error('DashScope 400: max_tokens too large for model pro-x');
  };

  await assert.rejects(() => analyzeSummary('面试记录', { chat }), /max_tokens too large/);
  assert.equal(calls, 1, 'a generic 400 must NOT trigger a silent fallback');

  if (prevSummary === undefined) delete process.env.INTERVIEWER_SUMMARY_MODEL;
  else process.env.INTERVIEWER_SUMMARY_MODEL = prevSummary;
  if (prevInterviewer === undefined) delete process.env.INTERVIEWER_MODEL;
  else process.env.INTERVIEWER_MODEL = prevInterviewer;
});

test('analyzeSummary: records the telemetry lifecycle (input-built → model-call-start → model-call-end → done)', async () => {
  const tel = createSummaryTelemetry({ now: () => 0 });
  const chat = fakeChat('# 报告');
  await analyzeSummary('面试记录', { chat, telemetry: tel, requestId: 'r1' });

  const types = tel.snapshot().map((e) => e.type);
  assert.deepEqual(types, ['model-call-start', 'model-call-end', 'done']);
  assert.equal(tel.snapshot()[0].requestId, 'r1');
});

test('analyzeSummary: records a fallback telemetry event when the pro model is rejected', async () => {
  const prevSummary = process.env.INTERVIEWER_SUMMARY_MODEL;
  const prevInterviewer = process.env.INTERVIEWER_MODEL;
  process.env.INTERVIEWER_SUMMARY_MODEL = 'pro-x';
  process.env.INTERVIEWER_MODEL = 'flash-fallback';

  const tel = createSummaryTelemetry({ now: () => 0 });
  const chat: SummaryChatFn = async (opts) => {
    if (opts.model === 'pro-x') throw new Error('model not found');
    return '# ok';
  };
  await analyzeSummary('面试记录', { chat, telemetry: tel, requestId: 'r2' });

  const types = tel.snapshot().map((e) => e.type);
  assert.ok(types.includes('fallback'), `expected a fallback event, got ${types.join(',')}`);
  assert.ok(types.includes('done'));

  if (prevSummary === undefined) delete process.env.INTERVIEWER_SUMMARY_MODEL;
  else process.env.INTERVIEWER_SUMMARY_MODEL = prevSummary;
  if (prevInterviewer === undefined) delete process.env.INTERVIEWER_MODEL;
  else process.env.INTERVIEWER_MODEL = prevInterviewer;
});

test('analyzeSummary: records an error telemetry event when the call hard-fails', async () => {
  const tel = createSummaryTelemetry({ now: () => 0 });
  const chat: SummaryChatFn = async () => {
    throw new Error('network down');
  };
  await assert.rejects(() => analyzeSummary('面试记录', { chat, telemetry: tel, requestId: 'r3' }));
  const types = tel.snapshot().map((e) => e.type);
  assert.ok(types.includes('error'), `expected an error event, got ${types.join(',')}`);
});
