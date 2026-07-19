import type { FollowUpOutput, OutputLanguage } from '@open-cluely/contract';
import { chat, type ChatOptions } from './dashscope';

export const AUTO_QUESTION_MODEL = 'deepseek-v4-flash';
export const AUTO_QUESTION_TIMEOUT_MS = 8_000;
export const AUTO_QUESTION_VERSION = 'auto_flash_v1';

const AUTO_QUESTION_SYSTEM = [
  'You are the fast path of a world-class interviewer copilot.',
  'Produce ONE concise follow-up that maximizes evidence gain from the candidate’s latest answer.',
  'Anchor it in something the candidate actually said; target one missing dimension: decision, alternative, verification, failure, ownership, or measurable result.',
  'Use the JD and resume only as relevance context. Never invent facts from them or ask a generic “tell me more” question.',
  'Ask one question, not a compound checklist, and never answer it for the candidate.',
  'Return STRICT JSON only:',
  '{"primary_question":"...","alternative_question":"","rationale_for_interviewer":"...","anchor_quotes":["exact answer span"],"expected_evidence_yield":"..."}'
].join(' ');

export interface AutoQuestionInput {
  candidateAnswer: string;
  focusHint?: string;
  jobDescription?: string;
  resumeText?: string;
  outputLanguage?: OutputLanguage;
}

export interface AutoQuestionResult {
  output: FollowUpOutput;
  model: string;
  elapsedMs: number;
  fellBack: boolean;
}

export interface AutoQuestionDeps {
  chat?: (options: ChatOptions) => Promise<string>;
  now?: () => number;
}

function clean(value: unknown, maxChars: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function parseObject(text: string): Record<string, unknown> | null {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const value = JSON.parse(cleaned) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const value = JSON.parse(match[0]) as unknown;
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function deriveAnchor(answer: string): string {
  const sentences = answer
    .split(/[。！？!?；;\n]/)
    .map((part) => clean(part, 48))
    .filter((part) => part.length >= 4);
  return sentences.at(-1) || clean(answer, 48) || '刚才的回答';
}

function fallbackOutput(answer: string): FollowUpOutput {
  const anchor = deriveAnchor(answer);
  return {
    primary_question: `你提到“${anchor}”，最能验证这项判断有效的具体证据是什么？`,
    alternative_question: '',
    rationale_for_interviewer: '模型超时或格式异常时，仍用候选人的原话追问可验证证据。',
    anchor_quotes: [anchor],
    expected_evidence_yield: '候选人的验证方法、真实结果与判断依据',
    iteration_version: AUTO_QUESTION_VERSION
  };
}

function firstQuestion(value: unknown): string {
  const text = clean(value, 240);
  const zh = text.indexOf('？');
  const en = text.indexOf('?');
  const end = zh < 0 ? en : en < 0 ? zh : Math.min(zh, en);
  return end >= 0 ? text.slice(0, end + 1) : text;
}

function parseOutput(text: string, answer: string): FollowUpOutput | null {
  const obj = parseObject(text);
  if (!obj) return null;
  const primary = firstQuestion(obj.primary_question);
  if (primary.length < 6) return null;
  const anchors = (Array.isArray(obj.anchor_quotes) ? obj.anchor_quotes : [])
    .map((value) => clean(value, 80))
    .filter((value) => value.length >= 2 && answer.includes(value))
    .slice(0, 3);
  return {
    primary_question: primary,
    // The live card must land one decision-ready question, not make the
    // interviewer choose between another generated list under time pressure.
    alternative_question: '',
    rationale_for_interviewer:
      clean(obj.rationale_for_interviewer, 360) || '追问候选人本轮回答中尚未验证的关键信息。',
    anchor_quotes: anchors.length ? anchors : [deriveAnchor(answer)],
    expected_evidence_yield:
      clean(obj.expected_evidence_yield, 360) || '具体决策、行为和可验证结果',
    iteration_version: AUTO_QUESTION_VERSION
  };
}

function languageInstruction(language: OutputLanguage | undefined): string {
  if (language === 'zh') return 'Write all visible fields in Simplified Chinese.';
  if (language === 'en') return 'Write all visible fields in English.';
  return 'Use the language of the candidate answer.';
}

export async function generateAutoQuestion(
  input: AutoQuestionInput,
  deps: AutoQuestionDeps = {}
): Promise<AutoQuestionResult> {
  const runChat = deps.chat ?? chat;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const answer = clean(input.candidateAnswer, 4_000);
  const prompt = [
    `[Output language]\n${languageInstruction(input.outputLanguage)}`,
    `[Monitor focus]\n${clean(input.focusHint, 500) || '(infer the highest-value gap)'}`,
    `[Job description]\n${clean(input.jobDescription, 2_500) || '(none)'}`,
    `[Resume context]\n${clean(input.resumeText, 2_000) || '(none)'}`,
    `[Latest candidate answer]\n${answer || '(empty)'}`
  ].join('\n\n');

  let output: FollowUpOutput | null = null;
  try {
    const text = await runChat({
      system: AUTO_QUESTION_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      model: AUTO_QUESTION_MODEL,
      maxTokens: 500,
      temperature: 0.2,
      thinking: false,
      timeoutMs: AUTO_QUESTION_TIMEOUT_MS,
      maxRetries: 0
    });
    output = parseOutput(text, answer);
  } catch {
    // The latency SLO is more important than retry backoff. A deterministic,
    // evidence-anchored question keeps the interviewer moving when Flash fails.
  }

  const fellBack = output === null;
  return {
    output: output ?? fallbackOutput(answer),
    model: AUTO_QUESTION_MODEL,
    elapsedMs: Math.max(0, now() - startedAt),
    fellBack
  };
}
