import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRankedQuestions, type RankableResult } from '../src/ranked';

// A realistic Expert result: Block D's pool (best-first by id) + Block E's scores
// in a DIFFERENT order than the final ranking, so the sort is observable.
function expertResult(): RankableResult {
  return {
    blocks: {
      D: {
        candidates: [
          { id: 'q1', question: 'Walk me through the call you agonized over most?' },
          { id: 'q2', question: 'What did choosing async cost you elsewhere?' },
          { id: 'q3', question: 'Which tool was load-bearing here?' }
        ]
      },
      E: {
        ranked: [
          { id: 'q1', total: 24, reasoning: 'deep + owned' },
          { id: 'q2', total: 28, reasoning: 'strongest tradeoff probe' },
          { id: 'q3', total: 12, reasoning: 'fact-pin, weak' }
        ]
      }
    }
  };
}

test('toRankedQuestions joins D+E by id, sorts by score desc, maps fields', () => {
  const ranked = toRankedQuestions(expertResult());

  assert.equal(ranked.length, 3);

  // Sorted by Block E total descending: q2 (28) > q1 (24) > q3 (12).
  assert.deepEqual(
    ranked.map((r) => r.score),
    [28, 24, 12]
  );

  // Rank is 1-based in sorted order.
  assert.deepEqual(
    ranked.map((r) => r.rank),
    [1, 2, 3]
  );

  // Top entry carries q2's question text + reasoning, score, and the 30 ceiling.
  assert.deepEqual(ranked[0], {
    question: 'What did choosing async cost you elsewhere?',
    score: 28,
    maxScore: 30,
    rubricReason: 'strongest tradeoff probe',
    rank: 1
  });

  // Question text is joined from Block D by id (q1 here).
  assert.equal(ranked[1].question, 'Walk me through the call you agonized over most?');
  assert.equal(ranked[1].rubricReason, 'deep + owned');
});

test('toRankedQuestions returns [] when blocks are absent (fast mode)', () => {
  assert.deepEqual(toRankedQuestions({ blocks: null }), []);
  assert.deepEqual(toRankedQuestions({}), []);
  assert.deepEqual(toRankedQuestions(null), []);
  assert.deepEqual(toRankedQuestions(undefined), []);
});

test('toRankedQuestions returns [] when only one of D/E is present', () => {
  assert.deepEqual(toRankedQuestions({ blocks: { D: { candidates: [{ id: 'q1', question: 'a?' }] } } }), []);
  assert.deepEqual(toRankedQuestions({ blocks: { E: { ranked: [{ id: 'q1', total: 10 }] } } }), []);
});

test('toRankedQuestions drops ranked rows with no matching candidate', () => {
  const ranked = toRankedQuestions({
    blocks: {
      D: { candidates: [{ id: 'q1', question: 'kept?' }] },
      // q9 has no candidate in D — it must be dropped, not surfaced with empty text.
      E: { ranked: [{ id: 'q9', total: 30, reasoning: 'orphan' }, { id: 'q1', total: 20, reasoning: 'ok' }] }
    }
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].question, 'kept?');
  assert.equal(ranked[0].score, 20);
});

test('toRankedQuestions defaults a missing/NaN total to 0 and empty reasoning to ""', () => {
  const ranked = toRankedQuestions({
    blocks: {
      D: { candidates: [{ id: 'q1', question: 'q?' }] },
      E: { ranked: [{ id: 'q1' }] }
    }
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].score, 0);
  assert.equal(ranked[0].rubricReason, '');
  assert.equal(ranked[0].maxScore, 30);
});

test('toRankedQuestions returns [] for empty candidate/ranked arrays', () => {
  assert.deepEqual(toRankedQuestions({ blocks: { D: { candidates: [] }, E: { ranked: [] } } }), []);
});
