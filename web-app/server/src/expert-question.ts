import type { FollowUpOutput, OutputLanguage } from '@open-cluely/contract';
import { chat, type ChatOptions } from './dashscope';

export const EXPERT_QUESTION_MODEL = 'deepseek-v4-flash';
export const EXPERT_QUESTION_TIMEOUT_MS = 8_000;
export const EXPERT_QUESTION_VERSION = 'expert_flash_v2';

const EXPERT_QUESTION_SYSTEM = `
你是世界级的实时面试官副驾。你必须在一次低延迟调用内，找出候选人最值得追问的证据缺口，并产生一个专家级问题。

请在内部静默完成以下判断，不要输出思考过程：
1. 找出候选人本轮最关键的具体主张、行动或结果。
2. 结合职位要求，判断当前最高价值的证据缺口：个人责任边界、关键决策、备选方案与取舍、约束与风险、失败与复盘、量化结果、验证方法或学习迁移。
3. 避免重复已问问题，只选能最大化信息增益的一个缺口。
4. 问题必须锚定候选人原话，优先要求真实决策、具体行为和可验证结果，不得虚构简历或职位信息。
5. 只问一个简洁、可直接朗读的问题；不要检查清单，不要“能否展开说说”，不要帮候选人回答。

选题优先级：个人责任与关键决策 > 取舍与验证 > 失败与复盘 > 量化结果 > 背景细节。如果更高优先级的缺口存在，不得浪费问题去询问“有哪些类型”、“有哪几个分歧”等低信息背景。问题必须直接验证 rationale_for_interviewer 中声称的那个缺口：如果理由说责任边界不清，问题就必须追问候选人亲自做的决策或行动，不能只问背景。

默认所有可见字段使用纯简体中文。只有当输入明确指定英文时才使用英文。候选人原话中已出现的产品名、缩写或技术名词可原样保留，不得出现英文句子或中英混杂解释。

仅输出严格 JSON，不要 Markdown，不要额外文字：
{"should_ask":true,"primary_question":"...","rationale_for_interviewer":"...","anchor_quotes":["必须与候选人原文完全一致的片段"],"expected_evidence_yield":"..."}
`.trim();

export interface ExpertQuestionInput {
  candidateAnswer: string;
  focusHint?: string;
  jobDescription?: string;
  resumeText?: string;
  questionHistory?: readonly string[];
  outputLanguage?: OutputLanguage;
}

export interface ExpertQuestionResult {
  output: FollowUpOutput;
  model: string;
  elapsedMs: number;
  fellBack: boolean;
  shouldAsk: boolean;
}

export interface ExpertQuestionDeps {
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
    .split(/[。！？!?] *|[\n；;]/)
    .map((part) => clean(part, 52))
    .filter((part) => part.length >= 4);
  return sentences.at(-1) || clean(answer, 52) || '刚才这项经历';
}

function fallbackOutput(answer: string): FollowUpOutput {
  const anchor = deriveAnchor(answer);
  return {
    primary_question: `你提到“${anchor}”，当时哪个关键决策最能证明这是你亲自主导的？`,
    alternative_question: '',
    rationale_for_interviewer: '当模型超时或输出不合格时，仍围绕候选人原话验证个人决策和责任边界。',
    anchor_quotes: [anchor],
    expected_evidence_yield: '个人决策、取舍依据和责任边界',
    iteration_version: EXPERT_QUESTION_VERSION
  };
}

function firstQuestion(value: unknown): string {
  const text = clean(value, 240);
  const zh = text.indexOf('？');
  const en = text.indexOf('?');
  const end = zh < 0 ? en : en < 0 ? zh : Math.min(zh, en);
  return end >= 0 ? text.slice(0, end + 1) : text;
}

const GENERIC_QUESTION = /(?:能否|可以|请)?(?:详细)?(?:展开|多)?(?:说说|介绍一下)|tell\s+me\s+more|could\s+you\s+elaborate/i;

function hasUngroundedEnglish(text: string, source: string): boolean {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9+.#/_-]*/g) ?? [];
  const sourceLower = source.toLowerCase();
  return tokens.some((token) => token.length >= 2 && !sourceLower.includes(token.toLowerCase()));
}

function parseOutput(
  text: string,
  input: ExpertQuestionInput,
  answer: string
): { output: FollowUpOutput | null; shouldAsk: boolean } {
  const obj = parseObject(text);
  if (!obj) return { output: null, shouldAsk: true };
  if (obj.should_ask === false) return { output: null, shouldAsk: false };

  const primary = firstQuestion(obj.primary_question);
  const rationale = clean(obj.rationale_for_interviewer, 420);
  const expected = clean(obj.expected_evidence_yield, 360);
  const anchors = (Array.isArray(obj.anchor_quotes) ? obj.anchor_quotes : [])
    .map((value) => clean(value, 100))
    .filter((value) => value.length >= 2 && answer.includes(value))
    .slice(0, 3);

  if (
    primary.length < 8 ||
    primary.length > 180 ||
    !/[？?]$/.test(primary) ||
    GENERIC_QUESTION.test(primary) ||
    rationale.length < 10 ||
    expected.length < 6 ||
    anchors.length === 0
  ) {
    return { output: null, shouldAsk: true };
  }

  const language = input.outputLanguage || 'zh';
  if (language === 'zh') {
    const source = [answer, input.jobDescription, input.resumeText].filter(Boolean).join('\n');
    if (
      hasUngroundedEnglish(primary, source) ||
      hasUngroundedEnglish(rationale, source) ||
      hasUngroundedEnglish(expected, source)
    ) {
      return { output: null, shouldAsk: true };
    }
  }

  return {
    shouldAsk: true,
    output: {
      primary_question: primary,
      alternative_question: '',
      rationale_for_interviewer: rationale,
      anchor_quotes: anchors,
      expected_evidence_yield: expected,
      iteration_version: EXPERT_QUESTION_VERSION
    }
  };
}

function languageInstruction(language: OutputLanguage | undefined): string {
  if (language === 'en') return '所有可见字段使用英文。';
  return '所有可见字段使用纯简体中文，禁止英文句子和中英混杂解释。';
}

export async function generateExpertQuestion(
  input: ExpertQuestionInput,
  deps: ExpertQuestionDeps = {}
): Promise<ExpertQuestionResult> {
  const runChat = deps.chat ?? chat;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const answer = clean(input.candidateAnswer, 6_000);
  const history = (input.questionHistory ?? [])
    .map((question) => clean(question, 240))
    .filter(Boolean)
    .slice(-8);
  const prompt = [
    `[输出语言]\n${languageInstruction(input.outputLanguage)}`,
    `[实时监控关注点]\n${clean(input.focusHint, 700) || '请自主选择信息增益最高的证据缺口'}`,
    `[职位要求]\n${clean(input.jobDescription, 3_500) || '未提供'}`,
    `[简历背景]\n${clean(input.resumeText, 2_500) || '未提供'}`,
    `[已问问题]\n${history.length ? history.map((question, index) => `${index + 1}. ${question}`).join('\n') : '无'}`,
    `[候选人最新回答]\n${answer || '无'}`
  ].join('\n\n');

  let parsed: { output: FollowUpOutput | null; shouldAsk: boolean } | null = null;
  try {
    const text = await runChat({
      system: EXPERT_QUESTION_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      model: EXPERT_QUESTION_MODEL,
      maxTokens: 700,
      temperature: 0.15,
      thinking: false,
      timeoutMs: EXPERT_QUESTION_TIMEOUT_MS,
      maxRetries: 0
    });
    parsed = parseOutput(text, input, answer);
  } catch {
    // Never retry on the interviewer's live path. The deterministic question
    // below is evidence-anchored and keeps the interaction inside the SLO.
  }

  const shouldAsk = parsed?.shouldAsk ?? true;
  const output = parsed?.output;
  return {
    output: output ?? fallbackOutput(answer),
    model: EXPERT_QUESTION_MODEL,
    elapsedMs: Math.max(0, now() - startedAt),
    fellBack: output === null || output === undefined,
    shouldAsk
  };
}
