// ============================================================================
// DashScope Anthropic-shape chat helper
// ----------------------------------------------------------------------------
// One small `chat()` over DashScope's Anthropic-shape Messages endpoint
// (`${baseUrl}/v1/messages`), reused by the resume-chat and legacy-assistant
// routes. Mirrors the desktop interviewer-runtime call pattern exactly: same
// headers (`x-api-key` + `anthropic-version`), same body shape, same
// timeout + 5xx/429 exponential-backoff retry, and the same `content[].text`
// concatenation of the response.
//
// Base URL + default model come from the desktop config re-exported by
// `@open-cluely/copilot-core` (one source of truth with the Electron app).
// ============================================================================

import { config as coreConfig } from '@open-cluely/copilot-core';
import { config } from './config';

const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1500;
const DEFAULT_MAX_TOKENS = 1024;

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatOptions {
  /** Conversation turns, oldest first. */
  readonly messages: ReadonlyArray<ChatMessage>;
  /** Optional system prompt. */
  readonly system?: string;
  /** Model id; defaults to the configured interviewer model. */
  readonly model?: string;
  /** Output token cap; defaults to 1024. */
  readonly maxTokens?: number;
  /** Optional sampling temperature. */
  readonly temperature?: number;
  /**
   * deepseek-v4 models do extended "thinking" by default, which emits thousands
   * of hidden reasoning tokens and dominates latency. Pass `false` to disable it
   * (Anthropic-shape `thinking: { type: 'disabled' }`, honored by DashScope) for
   * fast, low-latency calls like the auto-trigger monitor. Omit/`true` = default.
   */
  readonly thinking?: boolean;
  /**
   * Per-call abort timeout in ms. Overrides the default 60s. The deep v4-pro
   * summary (thinking ON + 4096 tokens) can run well past 60s, so the summary
   * call passes a generous budget here; omit it for the fast default callers.
   */
  readonly timeoutMs?: number;
}

/** The Anthropic-shape base URL (`.../apps/anthropic`) from the desktop config. */
export function getDashscopeBaseUrl(): string {
  return String(coreConfig.getDashscopeBaseUrl());
}

/**
 * Default interviewer model. Prefers the server's INTERVIEWER_MODEL override,
 * else the desktop default (deepseek-v4-flash).
 */
export function getDefaultModel(): string {
  return config.interviewerModel || String(coreConfig.getDefaultInterviewerModel());
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Anthropic-shape chat completion. Returns the concatenated text of the
 * response `content[]` blocks. Retries 5xx/429 with exponential backoff; throws
 * on non-retryable HTTP errors, exhausted retries, or timeout.
 */
export async function chat(options: ChatOptions): Promise<string> {
  const apiKey = config.dashscopeApiKey;
  if (!apiKey) {
    throw new Error('no key');
  }

  const model = options.model || getDefaultModel();
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  // Per-call timeout override (e.g. the deep summary needs >60s); default 60s.
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : REQUEST_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: options.messages.map((m) => ({ role: m.role, content: m.content }))
  };
  if (options.system) body.system = options.system;
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  // Explicit thinking:disabled skips deepseek-v4's hidden reasoning tokens —
  // the latency win that makes the trigger monitor cheap. Only sent when the
  // caller opts out; omitting the field preserves each model's default behavior.
  if (options.thinking === false) body.thinking = { type: 'disabled' };

  const url = `${getDashscopeBaseUrl()}/v1/messages`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if (resp.status >= 500 || resp.status === 429) {
          lastErr = new Error(`DashScope ${resp.status}: ${text.slice(0, 300)}`);
          if (attempt < MAX_RETRIES) {
            await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
            continue;
          }
          throw lastErr;
        }
        // Non-retryable 4xx (e.g. 400/404): fail FAST. Marked so the catch below
        // re-throws it immediately instead of looping the retry/backoff (which
        // would burn MAX_RETRIES attempts on an error that can never succeed).
        throw markNonRetryable(new Error(`DashScope ${resp.status}: ${text.slice(0, 500)}`));
      }

      const json = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
      const blocks = Array.isArray(json.content) ? json.content : [];
      return blocks
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
    } catch (err) {
      clearTimeout(timer);
      // A non-retryable HTTP error (4xx ≠ 429) must abort the loop now — retrying
      // a 400/404 only wastes time and masks the real failure behind backoff.
      if (isNonRetryable(err)) throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('DashScope request failed');
}

/** Brand for a non-retryable error so the retry catch re-throws it immediately. */
const NON_RETRYABLE = Symbol('dashscope.nonRetryable');

function markNonRetryable(err: Error): Error {
  (err as Error & { [NON_RETRYABLE]?: boolean })[NON_RETRYABLE] = true;
  return err;
}

function isNonRetryable(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { [NON_RETRYABLE]?: boolean })[NON_RETRYABLE]);
}
