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
    throw new ApiError(response.status, `Request failed (${response.status})`);
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

/* ── Sessions (interview history) ──────────────────────────────────────────── */

/** A session summary as returned by `GET /api/sessions`. */
export interface SessionSummary {
  id: string;
  title: string;
  interviewType: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** One persisted transcript message inside a session. */
export interface SessionMessage {
  role: string;
  text: string;
  ts: number;
}

/** A fully-hydrated session as returned by `GET /api/sessions/:id`. */
export interface SessionDetail {
  id: string;
  title: string;
  interviewType: string;
  jobDescription: string;
  resumeText: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

export interface SessionResponse {
  session: SessionDetail;
}

export interface CreateSessionBody {
  title?: string;
  interviewType?: string;
}

export interface UpdateSessionBody {
  title?: string;
  jobDescription?: string;
  resumeText?: string;
}

export interface AppendMessageResponse {
  ok: boolean;
  messageCount: number;
}

export function fetchSessions(signal?: AbortSignal): Promise<SessionsResponse> {
  return getJson<SessionsResponse>('/api/sessions', signal);
}

export function createSession(
  body: CreateSessionBody,
  signal?: AbortSignal
): Promise<SessionResponse> {
  return sendJson<SessionResponse>('/api/sessions', 'POST', body, signal);
}

export function fetchSession(id: string, signal?: AbortSignal): Promise<SessionResponse> {
  return getJson<SessionResponse>(`/api/sessions/${encodeURIComponent(id)}`, signal);
}

export function updateSession(
  id: string,
  body: UpdateSessionBody,
  signal?: AbortSignal
): Promise<SessionResponse> {
  return sendJson<SessionResponse>(
    `/api/sessions/${encodeURIComponent(id)}`,
    'PATCH',
    body,
    signal
  );
}

export function deleteSession(id: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
  return sendJson<{ ok: boolean }>(
    `/api/sessions/${encodeURIComponent(id)}`,
    'DELETE',
    undefined,
    signal
  );
}

export function appendSessionMessage(
  id: string,
  message: { role: string; text: string },
  signal?: AbortSignal
): Promise<AppendMessageResponse> {
  return sendJson<AppendMessageResponse>(
    `/api/sessions/${encodeURIComponent(id)}/messages`,
    'POST',
    message,
    signal
  );
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

/* ── Pipelines (Customize-mode node editor) ────────────────────────────────── */

/** A typed input port on a block type. */
export interface BlockInputPort {
  name: string;
  type: string;
  optional: boolean;
}

/** Thinking config for a block (disabled, or enabled with a token budget). */
export interface BlockThinking {
  type: 'disabled' | 'enabled';
  budget_tokens?: number;
}

/** Serializable block-type metadata for the palette + config panel. */
export interface BlockTypeMeta {
  id: string;
  label: string;
  schemaId: string | null;
  inputs: BlockInputPort[];
  outputType: string;
  defaultBody: string;
  defaults: {
    model: string;
    thinking: BlockThinking;
    temperature: number;
    maxTokens: number;
  };
}

/** A node in the pipeline graph. `pos` is editor-only (ignored by the engine). */
export interface PipelineNode {
  id: string;
  type: string;
  model?: string;
  thinking?: BlockThinking;
  promptBody?: string;
  temperature?: number;
  maxTokens?: number;
  pos?: { x: number; y: number };
}

/** A typed edge: source output port → target input port. */
export interface PipelineEdge {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

/** A full pipeline graph (the JSON shape the engine + library use). */
export interface Pipeline {
  id: string;
  name: string;
  builtin?: boolean;
  version?: string;
  blurb?: string;
  role?: string | null;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

/** A pipeline summary as returned by `GET /api/pipelines`. */
export interface PipelineSummary {
  id: string;
  name: string;
  builtin: boolean;
}

export interface PipelineListResponse {
  pipelines: PipelineSummary[];
}

export interface PipelineResponse {
  pipeline: Pipeline;
}

export interface BlockTypesResponse {
  blockTypes: BlockTypeMeta[];
}

export interface ValidatePipelineResponse {
  ok: boolean;
  errors: string[];
}

export interface SavePipelineResponse {
  id: string;
}

export function fetchPipelines(signal?: AbortSignal): Promise<PipelineListResponse> {
  return getJson<PipelineListResponse>('/api/pipelines', signal);
}

export function fetchPipeline(id: string, signal?: AbortSignal): Promise<PipelineResponse> {
  return getJson<PipelineResponse>(`/api/pipelines/${encodeURIComponent(id)}`, signal);
}

export function fetchBlockTypes(signal?: AbortSignal): Promise<BlockTypesResponse> {
  return getJson<BlockTypesResponse>('/api/pipelines/block-types', signal);
}

export function validatePipeline(
  pipeline: Pipeline,
  signal?: AbortSignal
): Promise<ValidatePipelineResponse> {
  return sendJson<ValidatePipelineResponse>('/api/pipelines/validate', 'POST', { pipeline }, signal);
}

export function savePipeline(
  pipeline: Pipeline,
  signal?: AbortSignal
): Promise<SavePipelineResponse> {
  return sendJson<SavePipelineResponse>('/api/pipelines', 'POST', { pipeline }, signal);
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
