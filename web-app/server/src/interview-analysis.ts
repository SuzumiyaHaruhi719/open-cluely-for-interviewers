// ============================================================================
// Shared interview-analysis infra (Phase C session-context + later summary).
// ----------------------------------------------------------------------------
// Two responsibilities, both built on the Anthropic-shape `chat()` helper:
//
//   1. buildAnalysisInput() — assemble a compact analysis input from the
//      accumulated transcript (candidate + interviewer finals) plus the optional
//      JD / résumé. Capped so latency/cost stay flat regardless of interview
//      length (only the recent tail of the transcript informs the live panel).
//
//   2. analyzeSessionContext(input) — one LIGHT-model call that returns the live
//      `SessionContextState` (competency chips + drilled topics + open gaps) as
//      STRICT JSON. Parsed DEFENSIVELY: ANY failure (no key, timeout, bad JSON,
//      empty body) resolves to `null` — this NEVER throws into the socket.
//
// The summary path (Phase B) will add a streamed v4-pro report here, reusing
// buildAnalysisInput(). Keep both prompts in this module (one source of truth).
// ============================================================================

import type { SessionContextState, CompetencyStatus, SessionCompetency } from '@open-cluely/contract';
import { chat, chatStream, getDefaultModel, type ChatOptions, type ChatStreamEvent } from './dashscope';
import type { SummaryTelemetry } from './summary-telemetry';

/** The light model used for the incremental session-context call. */
const DEFAULT_CONTEXT_MODEL = 'deepseek-v4-flash';

/** The PRO model used for the full interview-summary report (deepest reasoning). */
const DEFAULT_SUMMARY_MODEL = 'deepseek-v4-pro';

/** Resolve the session-context model: env override, else the light default. */
export function getContextModel(): string {
  return String(process.env.INTERVIEWER_CONTEXT_MODEL ?? '').trim() || DEFAULT_CONTEXT_MODEL;
}

/** Resolve the summary model: env override (INTERVIEWER_SUMMARY_MODEL), else v4-pro. */
export function getSummaryModel(): string {
  return String(process.env.INTERVIEWER_SUMMARY_MODEL ?? '').trim() || DEFAULT_SUMMARY_MODEL;
}

// Keep the transcript window we hand the model bounded — the live panel only
// needs the recent shape of the conversation, and a flat window keeps the light
// call cheap no matter how long the interview runs.
const TRANSCRIPT_WINDOW_CHARS = 6000;
const JD_WINDOW_CHARS = 2000;
const RESUME_WINDOW_CHARS = 2000;

const CONTEXT_MAX_TOKENS = 700;
const CONTEXT_TEMPERATURE = 0;

/** Raw inputs the analysis prompt is assembled from. */
export interface AnalysisInputParts {
  /** The running interview transcript (candidate + interviewer finals), oldest first. */
  readonly transcript: string;
  /** Optional job description for grounding. */
  readonly jobDescription?: string;
  /** Optional candidate résumé for grounding. */
  readonly resumeText?: string;
}

/**
 * Build the analysis input string from the accumulated transcript plus optional
 * JD/résumé. Each section is trimmed + capped to its window (recent tail of the
 * transcript; head of the JD/résumé). Empty sections are omitted. Returns '' when
 * there is no transcript to analyze (callers skip the model call on empty).
 */
export function buildAnalysisInput(parts: AnalysisInputParts): string {
  const transcript = String(parts.transcript ?? '').trim();
  if (!transcript) return '';

  const sections: string[] = [];

  const jd = String(parts.jobDescription ?? '').trim();
  if (jd) {
    sections.push(`# Job description\n${jd.slice(0, JD_WINDOW_CHARS)}`);
  }

  const resume = String(parts.resumeText ?? '').trim();
  if (resume) {
    sections.push(`# Candidate résumé\n${resume.slice(0, RESUME_WINDOW_CHARS)}`);
  }

  // Keep the RECENT tail of the transcript (the live panel reflects where the
  // interview is now), not the head.
  sections.push(`# Interview transcript so far\n${transcript.slice(-TRANSCRIPT_WINDOW_CHARS)}`);

  return sections.join('\n\n');
}

// The light analyzer's prompt. STRICT JSON ONLY — we parse defensively and treat
// ANY deviation as a failed analysis (null), so the panel simply keeps its last
// good state rather than ever showing garbage.
const CONTEXT_SYSTEM = [
  'You are an interview-analysis assistant. Read the interview transcript (and the',
  'job description / résumé when present) and summarize the LIVE state of the',
  'interview for the interviewer: which competencies have been probed, which topics',
  'have already been drilled into, and which gaps remain to explore.',
  'For each competency, set status to "covered" (well demonstrated), "partial"',
  '(touched but not fully established), or "gap" (claimed/relevant but not yet probed).',
  'Prefer competencies grounded in the JD when one is given. Keep names short.',
  'You may write topics/gaps/evidence in the transcript\'s own language.',
  'Respond with STRICT JSON ONLY, no prose, no markdown fences:',
  '{"competencies":[{"name":string,"status":"covered"|"partial"|"gap","evidence"?:string}],',
  '"topics":string[],"gaps":string[]}'
].join(' ');

function clampStatus(value: unknown): CompetencyStatus | null {
  return value === 'covered' || value === 'partial' || value === 'gap' ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const s = entry.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function toCompetencies(value: unknown): SessionCompetency[] {
  if (!Array.isArray(value)) return [];
  const out: SessionCompetency[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const status = clampStatus(rec.status);
    if (!name || !status) continue;
    const competency: SessionCompetency = { name, status };
    if (typeof rec.evidence === 'string' && rec.evidence.trim()) {
      competency.evidence = rec.evidence.trim();
    }
    out.push(competency);
  }
  return out;
}

/**
 * Parse the model's strict-JSON reply into a `SessionContextState`. Strips ```json
 * fences and falls back to the first {...} object (mirrors the auto-trigger's safe
 * parse). Returns null on any failure or when the result carries no usable signal
 * (no competencies AND no topics AND no gaps) — the caller then keeps the last
 * good state instead of clearing the panel.
 */
export function parseSessionContext(text: string): SessionContextState | null {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const state: SessionContextState = {
    competencies: toCompetencies(rec.competencies),
    topics: toStringArray(rec.topics),
    gaps: toStringArray(rec.gaps)
  };
  if (state.competencies.length === 0 && state.topics.length === 0 && state.gaps.length === 0) {
    return null;
  }
  return state;
}

/**
 * Run one LIGHT-model session-context analysis over the built input. NEVER throws:
 * any failure (no key, HTTP error, timeout, empty/malformed reply) resolves to
 * null. Thinking is disabled to keep the incremental call fast + cheap.
 */
export async function analyzeSessionContext(input: string): Promise<SessionContextState | null> {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;
  try {
    const text = await chat({
      system: CONTEXT_SYSTEM,
      messages: [{ role: 'user', content: trimmed }],
      model: getContextModel(),
      maxTokens: CONTEXT_MAX_TOKENS,
      temperature: CONTEXT_TEMPERATURE,
      thinking: false
    });
    return parseSessionContext(text);
  } catch {
    return null;
  }
}

// ── Interview summary (Phase B — DeepSeek v4 pro) ───────────────────────────
// A full, deepest-reasoning evaluation report the interviewer reads after (or
// during) the interview. It disables model-side hidden thinking for latency and
// asks for a Chinese Markdown report with a fixed section structure. The summary
// reads the FULL transcript window (both
// lanes — the AI's asked follow-ups are already accumulated in the transcript),
// so it is built with a larger transcript cap than the live panel.

const SUMMARY_TRANSCRIPT_WINDOW_CHARS = 14000;
// The report is long-form prose. Pro keeps room for a deep multi-section report;
// Flash is selected for speed, so it gets a shorter concise-report ceiling.
const SUMMARY_PRO_MAX_TOKENS = 4096;
const SUMMARY_FLASH_MAX_TOKENS = 1600;
export function getSummaryMaxTokens(model: string | undefined): number {
  return String(model ?? '').includes('flash') ? SUMMARY_FLASH_MAX_TOKENS : SUMMARY_PRO_MAX_TOKENS;
}
/**
 * The summary call's abort budget. With thinking DISABLED (see the call sites),
 * even a full 4096-token report should stream inside this. The ceiling is a
 * guard against a genuinely stuck pro call and leaves room for a fast-model
 * fallback before the browser's last-resort timeout fires.
 */
export const SUMMARY_REQUEST_TIMEOUT_MS = 90000;

/**
 * The default evaluation prompt (Chinese). Polished for sharpness, evidence
 * grounding, and decisive hire recommendations. Kept here as the authoritative
 * source; both `analyzeSummary` and `analyzeSummaryStream` use it by default,
 * and it can be overridden per-session via `summarySystemPrompt` (Feature 3).
 *
 * Requirements:
 *  - Chinese output, Markdown with fixed `##` sections, strict ordering.
 *  - Every judgment MUST cite the candidate's own words or a concrete observation.
 *  - Must NOT hallucinate facts beyond the transcript + JD + résumé.
 *  - Concise and decisive: an actual hire/reject recommendation is required.
 */
export const SUMMARY_SYSTEM = `你是一位资深技术面试官与评估专家，受雇于招聘委员会做书面评估。\
你的结论将直接影响录用决策，因此务必做到：客观、有据可查、立场鲜明。

**输入材料**（按优先级）：完整面试记录（含面试官追问与候选人回答） + 可选 JD + 可选简历。

**行为规则**
1. 每一项判断必须附上来自记录的直接引用（候选人原话或面试官的具体观察），格式：「引用：……」。
2. 严禁凭空推断记录中未出现的事实；证据不足时，明确写"证据不足"。
3. 评分基准（1–5 分）：5=远超预期，4=达到预期，3=部分达到，2=低于预期，1=严重不足。
4. 录用建议必须明确，不允许模糊措辞（禁用"视具体情况而定"等表述）。

请用**中文**输出一份 Markdown 评估报告，严格按照以下顺序输出且仅包含以下小节（使用二级标题 ## ）：

## 综合结论与录用建议
给出明确倾向，从以下四项中选一并加粗：**强烈推荐录用** / **推荐录用** / **待定（需补充考察）** / **不推荐录用**。\
用 2–3 句说明核心理由，理由必须与下文证据一致，不得前后矛盾。

## 能力维度评分
针对岗位核心能力维度（优先以 JD 为准；无 JD 时选：专业深度、系统设计、问题解决、编码能力、沟通表达）逐项列出。\
每项格式：
- **维度名**：N/5 — 引用：「…（候选人原话或观察）」 → 小结（1 句）

## 亮点
用要点列表列出候选人 2–4 个突出表现，每条必须有引用支撑。

## 风险与顾虑
用要点列表列出 1–4 个值得关注的弱点、疑虑或红旗信号，每条注明「证据：…」或「证据不足，需追查」。

## 进一步考察建议
若结论为「待定」或「推荐录用」，列出 2–3 个下一轮应重点验证的方向及建议考察问题。\
若结论为「强烈推荐」或「不推荐」，此节写"无需进一步考察"。

---
直接输出 Markdown 报告本体，不要添加任何前言、致谢或结语。`;

/** The result of a summary run: the report text + the model id that produced it. */
export interface SummaryResult {
  /** The full Markdown evaluation report. */
  readonly text: string;
  /** The model id actually used (the configured pro id, or the fallback id). */
  readonly model: string;
  /** True when the pro model was rejected and we fell back to the interviewer model. */
  readonly fellBack: boolean;
}

/**
 * Build the summary input — same shape as the live-context input but with a much
 * larger transcript window (the report judges the WHOLE interview, both lanes,
 * including the AI follow-ups already in the transcript). Returns '' when there
 * is no transcript (the caller then sends a friendly "nothing to summarize").
 */
export function buildSummaryInput(parts: AnalysisInputParts): string {
  const transcript = String(parts.transcript ?? '').trim();
  if (!transcript) return '';

  const sections: string[] = [];

  const jd = String(parts.jobDescription ?? '').trim();
  if (jd) sections.push(`# 岗位描述 (JD)\n${jd.slice(0, JD_WINDOW_CHARS)}`);

  const resume = String(parts.resumeText ?? '').trim();
  if (resume) sections.push(`# 候选人简历\n${resume.slice(0, RESUME_WINDOW_CHARS)}`);

  // The summary keeps the recent tail too (the long window already covers most
  // interviews); for very long ones the most-recent exchange matters most. When
  // the transcript actually OVERFLOWS the window the head is dropped, so the
  // heading must say so honestly — labelling a truncated tail as 完整 ("complete")
  // would mislead the model (and the reader) into judging the whole interview.
  const truncated = transcript.length > SUMMARY_TRANSCRIPT_WINDOW_CHARS;
  const tail = transcript.slice(-SUMMARY_TRANSCRIPT_WINDOW_CHARS);
  const heading = truncated ? '# 面试记录（节选：最近部分）' : '# 面试完整记录';
  sections.push(`${heading}\n${tail}`);

  return sections.join('\n\n');
}

/**
 * Did DashScope reject the model id itself (unknown/unavailable for the key) —
 * the only case where falling back to a cheaper model is appropriate?
 *
 * MUST be narrow: a previous over-broad match (`/model/` AND a generic `400|404`)
 * also fired on UNRELATED 400s that merely contained the word "model" (e.g.
 * "max_tokens too large for model X"), silently downgrading to the cheaper model
 * and MASKING the real param error. So we require the message to pair the word
 * "model" with genuine not-found / does-not-exist / unknown / unavailable /
 * unsupported wording — NOT a bare status code, and NOT max_tokens/param errors.
 */
export function isModelRejected(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (!/\bmodel\b/.test(msg)) return false;
  // Param/limit errors often mention a model but are NOT a rejected-model error.
  if (/max_tokens|max tokens|temperature|parameter|param\b/.test(msg)) return false;
  return /(not found|not exist|does ?n'?t exist|unknown|unavailable|unsupported|not supported|no such model)/.test(
    msg
  );
}

/** The chat signature analyzeSummary depends on — injectable for offline tests. */
export type SummaryChatFn = (options: ChatOptions) => Promise<string>;
/** The streaming chat signature analyzeSummaryStream depends on — injectable for offline tests. */
export type SummaryChatStreamFn = typeof chatStream;

/** Optional dependencies for analyzeSummary (defaults wire production + no-op telemetry). */
export interface AnalyzeSummaryDeps {
  /** The chat helper; defaults to the real DashScope `chat`. Injected in tests. */
  readonly chat?: SummaryChatFn;
  /** Optional lifecycle recorder so the (slow, opaque) summary flow is observable. */
  readonly telemetry?: SummaryTelemetry;
  /** Correlation id stamped on the telemetry events. */
  readonly requestId?: string;
}

/**
 * Run the PRO-model interview-summary call over the built input. Returns the full
 * Markdown report plus the model id actually used. Throws on hard failure (no
 * key, network/timeout, or both pro AND fallback rejected) — the caller maps that
 * to a `summary-error`. If the configured pro model id is REJECTED by DashScope
 * (unknown/unavailable for the key), this falls back ONCE to the configured
 * interviewer model (INTERVIEWER_MODEL / deepseek-v4-flash) and notes it.
 *
 * Passes a generous per-call timeout (SUMMARY_REQUEST_TIMEOUT_MS) so the deep
 * v4-pro reasoning is not aborted by the default 60s budget.
 *
 * NOTE: `chat()` is one-shot (no streaming), so the whole report comes back at
 * once — the client shows a spinner and renders it on `summary-done`.
 */
export async function analyzeSummary(
  input: string,
  deps: AnalyzeSummaryDeps = {}
): Promise<SummaryResult> {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    // Defensive: callers already guard empty transcripts, but never call the
    // model with nothing.
    throw new Error('empty summary input');
  }

  const runChat = deps.chat ?? chat;
  const tel = deps.telemetry;
  const rid = deps.requestId;

  const proModel = getSummaryModel();
  const messages = [{ role: 'user' as const, content: trimmed }];

  try {
    tel?.record('model-call-start', { requestId: rid, model: proModel });
    const text = await runChat({
      system: SUMMARY_SYSTEM,
      messages,
      model: proModel,
      maxTokens: getSummaryMaxTokens(proModel),
      timeoutMs: SUMMARY_REQUEST_TIMEOUT_MS,
      // Disable deepseek-v4's default extended thinking: its hidden reasoning
      // tokens dominate latency (minutes, up to the abort) without materially
      // improving this structured, evidence-cited report. Keep the summary fast.
      thinking: false
    });
    tel?.record('model-call-end', { requestId: rid, model: proModel });
    tel?.record('done', { requestId: rid, model: proModel });
    return { text, model: proModel, fellBack: false };
  } catch (err) {
    if (!isModelRejected(err)) {
      // A real failure (network/timeout/param error) — surface it, do NOT mask it
      // behind a silent fallback.
      tel?.record('error', { requestId: rid, model: proModel, error: errMessage(err) });
      throw err;
    }
    // The pro id was rejected by DashScope — fall back to the configured
    // interviewer model so the user still gets a (less-deep) report.
    const fallbackModel = getDefaultModel();
    if (fallbackModel === proModel) {
      tel?.record('error', { requestId: rid, model: proModel, error: errMessage(err) });
      throw err; // nothing else to try
    }
    tel?.record('fallback', {
      requestId: rid,
      model: fallbackModel,
      reason: 'pro model rejected'
    });
    try {
      tel?.record('model-call-start', { requestId: rid, model: fallbackModel });
      const text = await runChat({
        system: SUMMARY_SYSTEM,
        messages,
        model: fallbackModel,
        maxTokens: getSummaryMaxTokens(fallbackModel),
        timeoutMs: SUMMARY_REQUEST_TIMEOUT_MS
      });
      tel?.record('model-call-end', { requestId: rid, model: fallbackModel });
      tel?.record('done', { requestId: rid, model: fallbackModel });
      return { text, model: fallbackModel, fellBack: true };
    } catch (fallbackErr) {
      tel?.record('error', { requestId: rid, model: fallbackModel, error: errMessage(fallbackErr) });
      throw fallbackErr;
    }
  }
}

/** Short, safe error-message extraction for telemetry. */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? 'unknown error');
}

function isTimeoutLike(err: unknown): boolean {
  const msg = errMessage(err).toLowerCase();
  return /timeout|timed out|abort/.test(msg);
}

// ── Streaming summary (Feature 1) ────────────────────────────────────────────

export interface StreamCallbacks {
  /** Called with each incremental text chunk as it arrives. */
  onDelta: (text: string) => void;
  /** Called once at the end of the stream with the final token counts. */
  onUsage: (usage: { input: number; output: number }) => void;
}

export interface AnalyzeSummaryStreamDeps {
  /** Optional lifecycle recorder. */
  readonly telemetry?: SummaryTelemetry;
  /** Correlation id stamped on telemetry events. */
  readonly requestId?: string;
  /**
   * Per-session custom system prompt (Feature 3). When provided AND non-empty,
   * this replaces the default `SUMMARY_SYSTEM` prompt. Callers must already have
   * validated that the mode is 'custom'; an empty string here still falls back to
   * the default (NEVER call the model with an empty system prompt).
   */
  readonly summarySystemPrompt?: string;
  /** The streaming chat helper; defaults to the real DashScope `chatStream`. Injected in tests. */
  readonly chatStream?: SummaryChatStreamFn;
}

/**
 * Resolve the system prompt to use for a summary call (Feature 3).
 * Returns the custom prompt when it is non-empty, else the default `SUMMARY_SYSTEM`.
 * This is the single source of truth for prompt selection — both `analyzeSummary`
 * and `analyzeSummaryStream` go through here.
 */
export function resolveSummarySystemPrompt(customPrompt: string | undefined): string {
  const trimmed = String(customPrompt ?? '').trim();
  return trimmed || SUMMARY_SYSTEM;
}

/**
 * Like `analyzeSummary` but STREAMS the report via SSE. Calls `onDelta(text)`
 * for each chunk and `onUsage({input, output})` at the end. Includes the same
 * model-rejected fallback: if the configured summary model is rejected by
 * DashScope the fallback model is attempted (also streaming). Throws on hard
 * failures — the caller maps that to `summary-error`.
 */
export async function analyzeSummaryStream(
  input: string,
  callbacks: StreamCallbacks,
  { model: overrideModel, ...deps }: AnalyzeSummaryStreamDeps & { model?: string } = {}
): Promise<SummaryResult> {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    throw new Error('empty summary input');
  }

  const tel = deps.telemetry;
  const rid = deps.requestId;
  const proModel = overrideModel || getSummaryModel();
  const messages = [{ role: 'user' as const, content: trimmed }];
  const systemPrompt = resolveSummarySystemPrompt(deps.summarySystemPrompt);
  const runChatStream = deps.chatStream ?? chatStream;

  const recordDashscopeEvent = (event: ChatStreamEvent): void => {
    tel?.record('stream-event', {
      requestId: rid,
      source: 'dashscope',
      stage: event.stage,
      model: event.model,
      status: event.status,
      eventType: event.eventType,
      chunkChars: event.chunkChars,
      accumulatedChars: event.accumulatedChars,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      reason: event.reason,
      error: event.error
    });
  };

  let lastAttemptDeltaChars = 0;
  const runStream = async (model: string): Promise<string> => {
    lastAttemptDeltaChars = 0;
    return runChatStream(
      {
        system: systemPrompt,
        messages,
        model,
        maxTokens: getSummaryMaxTokens(model),
        timeoutMs: SUMMARY_REQUEST_TIMEOUT_MS,
        // deepseek-v4 does extended "thinking" by default — thousands of hidden
        // reasoning tokens that DOMINATE latency and pushed even flash past 3 min
        // (up to the abort) for a single report. The structured prompt below is
        // explicit enough to yield a strong report without it, so disable thinking:
        // flash now returns in seconds, not minutes.
        thinking: false
      },
      {
        onDelta: (text) => {
          lastAttemptDeltaChars += text.length;
          callbacks.onDelta(text);
        },
        onUsage: callbacks.onUsage,
        onEvent: recordDashscopeEvent
      }
    );
  };

  try {
    tel?.record('model-call-start', { requestId: rid, model: proModel });
    const text = await runStream(proModel);
    tel?.record('model-call-end', { requestId: rid, model: proModel });
    tel?.record('done', { requestId: rid, model: proModel });
    return { text, model: proModel, fellBack: false };
  } catch (err) {
    const fallbackReason = isModelRejected(err)
      ? 'pro model rejected'
      : isTimeoutLike(err) && lastAttemptDeltaChars === 0
        ? 'pro model timed out before first text'
        : '';
    if (!fallbackReason) {
      tel?.record('error', { requestId: rid, model: proModel, error: errMessage(err) });
      throw err;
    }
    const fallbackModel = getDefaultModel();
    if (fallbackModel === proModel) {
      tel?.record('error', { requestId: rid, model: proModel, error: errMessage(err) });
      throw err;
    }
    tel?.record('fallback', { requestId: rid, model: fallbackModel, reason: fallbackReason });
    try {
      tel?.record('model-call-start', { requestId: rid, model: fallbackModel });
      const text = await runStream(fallbackModel);
      tel?.record('model-call-end', { requestId: rid, model: fallbackModel });
      tel?.record('done', { requestId: rid, model: fallbackModel });
      return { text, model: fallbackModel, fellBack: true };
    } catch (fallbackErr) {
      tel?.record('error', { requestId: rid, model: fallbackModel, error: errMessage(fallbackErr) });
      throw fallbackErr;
    }
  }
}
