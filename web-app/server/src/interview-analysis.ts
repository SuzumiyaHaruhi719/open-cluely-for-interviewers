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
import { chat } from './dashscope';

/** The light model used for the incremental session-context call. */
const DEFAULT_CONTEXT_MODEL = 'deepseek-v4-flash';

/** Resolve the session-context model: env override, else the light default. */
export function getContextModel(): string {
  return String(process.env.INTERVIEWER_CONTEXT_MODEL ?? '').trim() || DEFAULT_CONTEXT_MODEL;
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
