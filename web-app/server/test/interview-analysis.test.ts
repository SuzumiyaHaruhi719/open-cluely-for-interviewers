import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSessionContext,
  buildAnalysisInput,
  buildSummaryInput,
  getSummaryModel
} from '../src/interview-analysis';

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
