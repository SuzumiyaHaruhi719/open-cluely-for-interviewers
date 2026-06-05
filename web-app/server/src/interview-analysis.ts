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
import { chat, getDefaultModel } from './dashscope';

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
// during) the interview. Unlike the live context call this KEEPS thinking on
// (the reasoning depth is the point) and asks for a Chinese Markdown report with
// a fixed section structure. The summary reads the FULL transcript window (both
// lanes — the AI's asked follow-ups are already accumulated in the transcript),
// so it is built with a larger transcript cap than the live panel.

const SUMMARY_TRANSCRIPT_WINDOW_CHARS = 14000;
// The report is long-form prose; give it room. Pro thinking + a multi-section
// report needs a generous ceiling so the conclusion is never truncated.
const SUMMARY_MAX_TOKENS = 4096;

/**
 * The evaluation prompt (Chinese). Asks for a Markdown report with the fixed
 * sections the spec mandates. Kept here so both analysis prompts live in one
 * module. The interviewer's own follow-ups are part of the transcript, so the
 * model can also judge 追问覆盖度 (follow-up coverage) from what was actually asked.
 */
const SUMMARY_SYSTEM = [
  '你是一位资深技术面试官与评估专家。请基于下面提供的完整面试记录（包含面试官与候选人双方的发言，',
  '以及可选的岗位描述 JD 与候选人简历），对候选人做一次全面、客观、有证据支撑的面试评估。',
  '只依据记录中的实际内容下结论，不要臆造记录里没有的事实；当证据不足时，明确指出"证据不足"。',
  '',
  '请用【中文】输出一份 Markdown 评估报告，使用二级标题（## ），严格包含且仅包含以下小节，顺序固定：',
  '## 候选人概况',
  '  用 2-4 句概述候选人的背景、应聘岗位匹配度与整体印象。',
  '## 各能力维度',
  '  针对岗位相关的关键能力维度（如：专业深度、系统设计、编码能力、问题解决、沟通表达等；优先依据 JD）',
  '  逐项评估。每个维度给出 1-5 分的评分，并附上来自面试记录的具体证据（可引用候选人原话或转述）。',
  '  用要点列表呈现，例如：`- 系统设计：4/5 — 证据：……`。',
  '## 亮点',
  '  列出候选人表现突出之处（要点列表）。',
  '## 风险·不足',
  '  列出明显的薄弱点、疑虑或风险信号（要点列表）。',
  '## 追问覆盖度',
  '  评估面试过程中追问是否充分：哪些关键点被深入追问、哪些重要方向尚未被探究、是否存在未澄清的疑点。',
  '## 录用建议',
  '  给出明确倾向（如：强烈推荐 / 推荐 / 待定 / 不推荐）并说明理由，理由需与上文证据一致。',
  '',
  '保持专业、简洁、可执行。直接输出 Markdown 报告本体，不要添加额外的前言或结语。'
].join('\n');

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
  // interviews); for very long ones the most-recent exchange matters most.
  sections.push(`# 面试完整记录\n${transcript.slice(-SUMMARY_TRANSCRIPT_WINDOW_CHARS)}`);

  return sections.join('\n\n');
}

/** A built-in retry-on-bad-model heuristic: did DashScope reject the model id? */
function isModelRejected(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  // DashScope returns 400/404 with messages mentioning the model when an id is
  // unknown/unavailable for the key. Match broadly so the fallback is reliable.
  return /model/.test(msg) && /(not found|not exist|unknown|invalid|unavailable|unsupported|400|404)/.test(msg);
}

/**
 * Run the PRO-model interview-summary call over the built input. Returns the full
 * Markdown report plus the model id actually used. Throws on hard failure (no
 * key, network/timeout, or both pro AND fallback rejected) — the caller maps that
 * to a `summary-error`. If the configured pro model id is REJECTED by DashScope
 * (unknown/unavailable for the key), this falls back ONCE to the configured
 * interviewer model (INTERVIEWER_MODEL / deepseek-v4-flash) and notes it.
 *
 * NOTE: `chat()` is one-shot (no streaming), so the whole report comes back at
 * once — the client shows a spinner and renders it on `summary-done`.
 */
export async function analyzeSummary(input: string): Promise<SummaryResult> {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    // Defensive: callers already guard empty transcripts, but never call the
    // model with nothing.
    throw new Error('empty summary input');
  }

  const proModel = getSummaryModel();
  const messages = [{ role: 'user' as const, content: trimmed }];

  try {
    const text = await chat({
      system: SUMMARY_SYSTEM,
      messages,
      model: proModel,
      maxTokens: SUMMARY_MAX_TOKENS
      // thinking left at default ON — the pro reasoning depth is the whole point.
    });
    return { text, model: proModel, fellBack: false };
  } catch (err) {
    if (!isModelRejected(err)) throw err;
    // The pro id was rejected by DashScope — fall back to the configured
    // interviewer model so the user still gets a (less-deep) report.
    const fallbackModel = getDefaultModel();
    if (fallbackModel === proModel) throw err; // nothing else to try
    const text = await chat({
      system: SUMMARY_SYSTEM,
      messages,
      model: fallbackModel,
      maxTokens: SUMMARY_MAX_TOKENS
    });
    return { text, model: fallbackModel, fellBack: true };
  }
}
