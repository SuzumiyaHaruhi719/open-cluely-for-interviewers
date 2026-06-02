import { Router } from 'express';
import { z } from 'zod';
import { filterQuestions, getRetriever, listCompanies } from '../question-bank';

const MAX_PAGE_SIZE = 100;
const MIN_PAGE_SIZE = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 50;

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

// A coerced positive integer that clamps into [lo, hi] (rather than rejecting
// out-of-range input), falling back to `fallback` when the value is absent or
// not a finite number.
function clampedInt(lo: number, hi: number, fallback: number) {
  return z
    .preprocess(
      (v) => (v === undefined || v === '' ? fallback : v),
      z.coerce.number().int().catch(fallback)
    )
    .transform((n) => clamp(n, lo, hi));
}

// GET /questions query params. Numbers are coerced from strings; page/pageSize
// are clamped (pageSize to 1..100). difficulty restricted to the bank's 0/1/2/3 scale.
const questionsQuerySchema = z.object({
  company: z.string().trim().min(1).optional(),
  difficulty: z.coerce.number().int().min(0).max(3).optional(),
  q: z.string().optional(),
  page: clampedInt(1, Number.MAX_SAFE_INTEGER, 1),
  pageSize: clampedInt(MIN_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q is required'),
  topK: clampedInt(1, MAX_TOP_K, DEFAULT_TOP_K)
});

export function createQuestionBankRouter(): Router {
  const router = Router();

  // Companies with question counts, sorted desc.
  router.get('/companies', (_req, res, next) => {
    try {
      res.json({ companies: listCompanies() });
    } catch (err) {
      next(err);
    }
  });

  // Non-semantic browse: filter + paginate the bank directly (no API key needed).
  router.get('/questions', (req, res, next) => {
    try {
      const parsed = questionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid query' });
        return;
      }
      const { company, difficulty, q, page, pageSize } = parsed.data;
      res.json(filterQuestions({ company, difficulty, q, page, pageSize }));
    } catch (err) {
      next(err);
    }
  });

  // Semantic search. Empty q -> 400. No key / not ready -> { results: [] } (never 500).
  router.get('/search', async (req, res, next) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'q is required' });
        return;
      }
      const { q, topK } = parsed.data;
      const results = await getRetriever().retrieve({ queryText: q, topK });
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
