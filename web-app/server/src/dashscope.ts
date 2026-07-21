// ============================================================================
// DashScope Anthropic-shape chat helper
// ----------------------------------------------------------------------------
// Two chat helpers over DashScope's Anthropic-shape Messages endpoint
// (`${baseUrl}/v1/messages`), reused by the resume-chat and legacy-assistant
// routes. Mirrors the desktop interviewer-runtime call pattern exactly: same
// headers (`x-api-key` + `anthropic-version`), same body shape, same
// timeout + 5xx/429 exponential-backoff retry, and the same `content[].text`
// concatenation of the response.
//
//  `chat()`       — one-shot (no streaming), returns full text.
//  `chatStream()` — SSE-streaming variant for the summary flow; calls
//                   `onDelta(text)` per content_block_delta and
//                   `onUsage({input, output})` at the end.
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
  /**
   * Retry count for retryable 5xx/429/network failures. Defaults to 2. Set to 0
   * for hard latency-SLO calls where backoff would be worse than a local fallback.
   */
  readonly maxRetries?: number;
  /** Receives provider-reported one-shot usage; absent when the provider omits it. */
  readonly onUsage?: (usage: { input: number; output: number }) => void;
}

/** The Anthropic-shape base URL (`.../apps/anthropic`) from the desktop config. */
export function getDashscopeBaseUrl(): string {
  return config.dashscopeBaseUrl || String(coreConfig.getDashscopeBaseUrl());
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
  const maxRetries =
    Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
      ? Math.min(5, Number(options.maxRetries))
      : MAX_RETRIES;

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
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
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
          if (attempt < maxRetries) {
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

      const json = (await resp.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (json.usage) {
        options.onUsage?.({
          input: Number(json.usage.input_tokens ?? 0),
          output: Number(json.usage.output_tokens ?? 0)
        });
      }
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
      if (attempt < maxRetries) {
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('DashScope request failed');
}

// ── Streaming chat ─────────────────────────────────────────────────────────

export interface ChatStreamCallbacks {
  /** Called with each incremental text delta as it arrives from the SSE stream. */
  onDelta: (text: string) => void;
  /**
   * Called once at stream end with the accumulated usage. `input` comes from
   * the `message_start` event; `output` comes from the final `message_delta`
   * event. Either may be 0 if the model omits that usage field.
   */
  onUsage: (usage: { input: number; output: number }) => void;
  /** Optional sanitized event-level diagnostics; never receives prompt/output text. */
  onEvent?: (event: ChatStreamEvent) => void;
}

export interface ChatStreamEvent {
  readonly source: 'dashscope';
  readonly stage: string;
  readonly model?: string;
  readonly status?: number;
  readonly eventType?: string;
  readonly chunkChars?: number;
  readonly accumulatedChars?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reason?: string;
  readonly error?: string;
}

/**
 * Streaming Anthropic-shape chat completion over DashScope. Sends `stream:true`
 * and parses SSE events:
 *   `message_start`      → captures `usage.input_tokens`
 *   `content_block_delta` (type=`text_delta`) → calls `onDelta(delta.text)`
 *   `message_delta`      → captures `usage.output_tokens`; calls `onUsage`
 *   `message_stop`       → stream finished
 *
 * Returns the fully accumulated text (identical to what `chat()` would return).
 * Throws on non-retryable 4xx (fail fast) or timeout. Does NOT retry (the
 * caller — the summary path — owns its own error semantics).
 */
export async function chatStream(
  options: ChatOptions,
  callbacks: ChatStreamCallbacks
): Promise<string> {
  const apiKey = config.dashscopeApiKey;
  if (!apiKey) {
    throw new Error('no key');
  }

  const model = options.model || getDefaultModel();
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : REQUEST_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: options.messages.map((m) => ({ role: m.role, content: m.content }))
  };
  if (options.system) body.system = options.system;
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (options.thinking === false) body.thinking = { type: 'disabled' };

  const url = `${getDashscopeBaseUrl()}/v1/messages`;
  const emitEvent = (stage: string, detail: Omit<ChatStreamEvent, 'source' | 'stage' | 'model'> = {}): void => {
    try {
      callbacks.onEvent?.({ source: 'dashscope', stage, model, ...detail });
    } catch {
      /* diagnostics must never break the stream */
    }
  };
  const controller = new AbortController();
  let timeoutReject: ((err: Error) => void) | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutReject = reject;
  });
  const timer = setTimeout(() => {
    emitEvent('timeout', { reason: `>${timeoutMs}ms` });
    controller.abort();
    timeoutReject?.(new Error(`DashScope stream timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  let resp: Response;
  try {
    emitEvent('request-start');
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    emitEvent('request-error', { error: err instanceof Error ? err.message : String(err ?? 'unknown') });
    throw err;
  }
  emitEvent('response', { status: resp.status });

  if (!resp.ok) {
    clearTimeout(timer);
    const text = await resp.text().catch(() => '');
    if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
      // Non-retryable 4xx: fail fast with the exact error text.
      throw markNonRetryable(new Error(`DashScope ${resp.status}: ${text.slice(0, 500)}`));
    }
    throw new Error(`DashScope ${resp.status}: ${text.slice(0, 300)}`);
  }

  // Parse the SSE stream.
  const reader = resp.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    throw new Error('DashScope streaming: no response body');
  }
  emitEvent('reader-open');

  const decoder = new TextDecoder();
  let accumulated = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let buffer = '';
  let sawMessageStop = false;

  // DashScope uses the standard SSE named-event format:
  //   event:TYPE\ndata:{...}\n\n
  // so we track the event name from `event:` lines and pair it with the
  // following `data:` line. The `type` field inside the JSON payload is a
  // duplicate (present on some events, absent on others); we prefer the
  // `event:` line name for routing.
  let pendingEventType = '';

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeoutPromise]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines ('\n\n'). Split on single
      // newlines so we can read both `event:` and `data:` lines in order.
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer.
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        // Named event line: `event:message_start` or `event:content_block_delta`
        if (line.startsWith('event:')) {
          pendingEventType = line.slice(6).trim();
          continue;
        }

        if (!line.startsWith('data:')) {
          // Blank line (event separator) or other field — reset pending event type.
          if (line === '') pendingEventType = '';
          continue;
        }

        const data = line.slice(5).trim(); // strip 'data:' (no space required by spec)
        if (data === '[DONE]') continue;

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue; // skip malformed lines
        }

        // Resolve the event type: prefer the `event:` line name (DashScope
        // standard); fall back to `type` inside the JSON body (Anthropic cloud).
        const eventType = pendingEventType || (payload.type as string | undefined) || '';
        pendingEventType = ''; // consumed
        if (eventType) {
          emitEvent('sse-event', { eventType });
        }

        if (eventType === 'message_start') {
          // Capture input token count from usage.
          const msg = payload.message as Record<string, unknown> | undefined;
          const usage = (msg?.usage ?? payload.usage) as Record<string, unknown> | undefined;
          if (typeof usage?.input_tokens === 'number') {
            inputTokens = usage.input_tokens;
            emitEvent('usage-input', { inputTokens });
          }
        } else if (eventType === 'content_block_delta') {
          const delta = (payload.delta ?? payload) as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            accumulated += delta.text;
            emitEvent('delta', { chunkChars: delta.text.length, accumulatedChars: accumulated.length });
            callbacks.onDelta(delta.text);
          }
        } else if (eventType === 'message_delta') {
          const usage = (payload.usage ?? payload) as Record<string, unknown> | undefined;
          if (typeof usage?.output_tokens === 'number') {
            outputTokens = usage.output_tokens;
            emitEvent('usage-output', { outputTokens });
          }
        } else if (eventType === 'message_stop') {
          emitEvent('message-stop', { inputTokens, outputTokens, accumulatedChars: accumulated.length });
          callbacks.onUsage({ input: inputTokens, output: outputTokens });
          sawMessageStop = true;
        }

        if (sawMessageStop) {
          await reader.cancel().catch(() => {});
          emitEvent('reader-cancel');
          emitEvent('return', { accumulatedChars: accumulated.length });
          return accumulated;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  emitEvent('stream-closed', { accumulatedChars: accumulated.length });
  return accumulated;
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
