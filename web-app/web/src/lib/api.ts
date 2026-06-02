import type { QuestionBankHit } from '@open-cluely/contract';

/**
 * Typed fetch wrappers for the question-bank HTTP endpoints. All requests are
 * same-origin relative URLs; the Vite dev proxy forwards `/api` to the local
 * server, and in production the client is served from the same origin.
 */

export interface HealthResponse {
  ok: boolean;
  version: string;
  questionBankReady: boolean;
  hasKey: boolean;
}

export interface CompanyCount {
  name: string;
  count: number;
}

export interface CompaniesResponse {
  companies: CompanyCount[];
}

export interface QuestionsResponse {
  total: number;
  page: number;
  pageSize: number;
  items: QuestionBankHit[];
}

export interface SearchResponse {
  results: QuestionBankHit[];
}

export interface QuestionQuery {
  company?: string;
  difficulty?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Thrown when an API request completes with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, getErrorMessage(error));
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Network request failed';
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') {
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson<HealthResponse>('/api/health', signal);
}

export function fetchCompanies(signal?: AbortSignal): Promise<CompaniesResponse> {
  return getJson<CompaniesResponse>('/api/question-bank/companies', signal);
}

export function fetchQuestions(
  query: QuestionQuery,
  signal?: AbortSignal
): Promise<QuestionsResponse> {
  const url = `/api/question-bank/questions${buildQuery({
    company: query.company,
    difficulty: query.difficulty,
    q: query.q,
    page: query.page,
    pageSize: query.pageSize
  })}`;
  return getJson<QuestionsResponse>(url, signal);
}

export function searchQuestions(
  q: string,
  topK: number,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const url = `/api/question-bank/search${buildQuery({ q, topK })}`;
  return getJson<SearchResponse>(url, signal);
}
