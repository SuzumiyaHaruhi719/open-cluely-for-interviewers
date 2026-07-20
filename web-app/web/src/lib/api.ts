import type { InterviewerMode, QuestionBankHit } from '@open-cluely/contract';

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
    throw new ApiError(response.status, `请求失败（${response.status}）`);
  }

  return (await response.json()) as T;
}

/**
 * JSON request helper for mutating verbs (POST/PATCH/DELETE). Serializes `body`
 * to JSON when present, throws `ApiError` on a non-2xx response, and returns the
 * parsed JSON payload.
 */
async function sendJson<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, getErrorMessage(error));
  }

  if (!response.ok) {
    throw new ApiError(response.status, `请求失败（${response.status}）`);
  }

  return (await response.json()) as T;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '网络请求失败';
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

/* ── Résumé extraction + chat ──────────────────────────────────────────────── */

export interface ResumeExtractResponse {
  text: string;
}

export interface ResumeChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResumeChatResponse {
  reply: string;
}

export function extractResume(
  payload: { filename: string; contentBase64: string },
  signal?: AbortSignal
): Promise<ResumeExtractResponse> {
  return sendJson<ResumeExtractResponse>('/api/resume/extract', 'POST', payload, signal);
}

export function resumeChat(
  payload: { resumeText: string; messages: ResumeChatTurn[] },
  signal?: AbortSignal
): Promise<ResumeChatResponse> {
  return sendJson<ResumeChatResponse>('/api/resume/chat', 'POST', payload, signal);
}

/* ── Assistant (legacy actions) ────────────────────────────────────────────── */

export interface AssistantReplyResponse {
  reply: string;
}

export function assistantAsk(
  payload: { prompt: string; context?: string },
  signal?: AbortSignal
): Promise<AssistantReplyResponse> {
  return sendJson<AssistantReplyResponse>('/api/assistant/ask', 'POST', payload, signal);
}

export function assistantNotes(
  payload: { transcript: string },
  signal?: AbortSignal
): Promise<AssistantReplyResponse> {
  return sendJson<AssistantReplyResponse>('/api/assistant/notes', 'POST', payload, signal);
}

export function assistantInsights(
  payload: { transcript: string },
  signal?: AbortSignal
): Promise<AssistantReplyResponse> {
  return sendJson<AssistantReplyResponse>('/api/assistant/insights', 'POST', payload, signal);
}

/** Re-exported for consumers building create-session payloads. */
export type { InterviewerMode };
