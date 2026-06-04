import { useEffect, useState } from 'react';
import type { QuestionBankHit } from '@open-cluely/contract';
import {
  ApiError,
  fetchCompanies,
  fetchQuestions,
  searchQuestions,
  type CompanyCount
} from './api';

export type SearchMode = 'browse' | 'semantic';

export const PAGE_SIZE = 20;
const SEMANTIC_TOP_K = 30;

interface BrowseParams {
  mode: 'browse';
  company: string | null;
  difficulty: number | null;
  query: string;
  page: number;
}

interface SemanticParams {
  mode: 'semantic';
  query: string;
}

export type QuestionBankParams = BrowseParams | SemanticParams;

export interface QuestionBankData {
  items: QuestionBankHit[];
  total: number;
  loading: boolean;
  error: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Failed to load questions';
}

/** Loads the list of companies once on mount. */
export function useCompanies(): { companies: CompanyCount[]; loading: boolean; error: string | null } {
  const [companies, setCompanies] = useState<CompanyCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCompanies(controller.signal)
      .then((res) => {
        setCompanies(res.companies);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  return { companies, loading, error };
}

/**
 * Fetches question results for the given params. Re-runs whenever the params
 * change, cancelling any in-flight request. In semantic mode `total` mirrors
 * the result count since the endpoint is not paginated.
 */
export function useQuestionResults(params: QuestionBankParams): QuestionBankData {
  const [items, setItems] = useState<QuestionBankHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serialize params so the effect dependency is a stable primitive.
  const key = JSON.stringify(params);

  useEffect(() => {
    const controller = new AbortController();
    const current: QuestionBankParams = JSON.parse(key);

    if (current.mode === 'semantic' && current.query.trim().length === 0) {
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const request =
      current.mode === 'semantic'
        ? searchQuestions(current.query.trim(), SEMANTIC_TOP_K, controller.signal).then((res) => ({
            items: res.results,
            total: res.results.length
          }))
        : fetchQuestions(
            {
              company: current.company ?? undefined,
              difficulty: current.difficulty ?? undefined,
              q: current.query.trim() || undefined,
              // The UI page state is 0-based; the server API is 1-based
              // (start = (page - 1) * pageSize). Convert here, or page 1 and 2
              // both resolve to start 0 and show identical results.
              page: current.page + 1,
              pageSize: PAGE_SIZE
            },
            controller.signal
          ).then((res) => ({ items: res.items, total: res.total }));

    request
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setItems([]);
        setTotal(0);
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [key]);

  return { items, total, loading, error };
}
