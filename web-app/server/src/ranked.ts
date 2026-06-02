// ============================================================================
// Ranked-pool surfacing — Block D (candidate pool) ⨝ Block E (rubric scores)
// ----------------------------------------------------------------------------
// The Expert pipeline already builds a 5-candidate pool (Block D) and scores +
// ranks it on a 6-dimension rubric (Block E). The server historically forwarded
// ONLY Block G's single rendered question and discarded the scored pool. This
// pure helper joins D.candidates ⨝ E.ranked by id, sorts by Block E's composite
// `total` descending, and maps each into a wire-ready `RankedQuestion` so the
// client can show an expandable ranked list under the prominent pick.
//
// Fast mode and any fallback that produces no blocks return [] — the client then
// falls back to the single `output` question. Pure + synchronous: unit-tested
// in test/ranked.test.ts with no network.
// ============================================================================

import type { RankedQuestion } from '@open-cluely/contract';

// The Expert rubric is 6 dimensions × 5 points = 30. Block E's `total` is the
// integer sum of those six dims (range 6–30), so this is the score ceiling.
const RUBRIC_MAX_SCORE = 30;

/** A Block D candidate (subset of fields this helper reads). */
interface BlockDCandidate {
  id?: string;
  question?: string;
}

/** A Block E ranked entry (subset of fields this helper reads). */
interface BlockERanked {
  id?: string;
  total?: number;
  reasoning?: string;
}

/** The shape of `result.blocks` this helper inspects (D + E only). */
export interface RankableBlocks {
  D?: { candidates?: BlockDCandidate[] } | null;
  E?: { ranked?: BlockERanked[] } | null;
}

/** A result-like object carrying optional `blocks`. */
export interface RankableResult {
  blocks?: RankableBlocks | null;
}

/**
 * Join the candidate pool (D) with the rubric scores (E) by id, sort by score
 * descending, and project to `RankedQuestion[]`. Returns [] when either block is
 * absent or carries no usable rows (Fast mode / fallback). Never throws.
 */
export function toRankedQuestions(result: RankableResult | null | undefined): RankedQuestion[] {
  const candidates = result?.blocks?.D?.candidates;
  const ranked = result?.blocks?.E?.ranked;
  if (!Array.isArray(candidates) || !Array.isArray(ranked)) return [];
  if (candidates.length === 0 || ranked.length === 0) return [];

  // Index the pool by id so each ranked entry can pull its question text.
  const questionById = new Map<string, string>();
  for (const c of candidates) {
    if (c && typeof c.id === 'string') {
      questionById.set(c.id, typeof c.question === 'string' ? c.question : '');
    }
  }

  // Keep only ranked rows that join to a real candidate, normalize the score,
  // then sort by score descending. A stable sort + 1-based rank gives the
  // client a deterministic order.
  const joined = ranked
    .filter((r): r is BlockERanked & { id: string } => !!r && typeof r.id === 'string' && questionById.has(r.id))
    .map((r) => ({
      question: questionById.get(r.id) ?? '',
      score: Number.isFinite(r.total) ? Number(r.total) : 0,
      reasoning: typeof r.reasoning === 'string' ? r.reasoning : ''
    }))
    .sort((a, b) => b.score - a.score);

  return joined.map((row, i) => ({
    question: row.question,
    score: row.score,
    maxScore: RUBRIC_MAX_SCORE,
    rubricReason: row.reasoning,
    rank: i + 1
  }));
}
