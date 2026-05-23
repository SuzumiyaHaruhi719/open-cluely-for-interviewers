// ============================================================================
// DEEPSEEK AI SERVICE - drop-in alternate to GeminiService
// ============================================================================
// OpenAI-compatible REST. base_url=https://api.deepseek.com/v1
//   - deepseek-chat  (V3/V4-flash) for fast Stage-1 hook detection
//   - deepseek-reasoner (R1) for higher-quality Stage-2 generation
// Key is read from process.env.DEEPSEEK_API_KEY at construction time.
// No SDK dependency — uses global fetch (Node 20+).
// ============================================================================

const {
  buildHookDetectionPrompt,
  buildFollowUpQuestionPrompt,
  ITERATION_VERSION
} = require('./interviewer-prompts');

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const FAST_MODEL = 'deepseek-chat';
const REASONING_MODEL = 'deepseek-reasoner';

class DeepSeekService {
  constructor(apiKey, options = {}) {
    this.apiKey = String(apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY missing — set env var or pass apiKey to constructor');
    }
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fastModel = options.fastModel || FAST_MODEL;
    this.reasoningModel = options.reasoningModel || REASONING_MODEL;
    this.maxRetries = options.maxRetries ?? 2;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60000;
    this.iterationVersion = ITERATION_VERSION;
  }

  async _chat({ model, messages, temperature = 0.2, maxTokens = 800, responseFormat }) {
    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    };
    if (responseFormat) body.response_format = responseFormat;

    let lastErr = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const text = await resp.text();
          if (resp.status >= 500 || resp.status === 429) {
            lastErr = new Error(`DeepSeek ${resp.status}: ${text.slice(0, 300)}`);
            await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
            continue;
          }
          throw new Error(`DeepSeek ${resp.status}: ${text.slice(0, 500)}`);
        }

        const json = await resp.json();
        const message = json?.choices?.[0]?.message?.content ?? '';
        return {
          text: message,
          usage: json?.usage,
          model: json?.model
        };
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr || new Error('DeepSeek request failed');
  }

  // ---------- Stage 1 ----------
  async detectHooks(input) {
    const prompt = buildHookDetectionPrompt(input);
    const { text, usage } = await this._chat({
      model: this.fastModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.15,
      maxTokens: 600,
      responseFormat: { type: 'json_object' }
    });
    return { raw: text, usage, parsed: safeJsonParse(text) };
  }

  // ---------- Stage 2 ----------
  async generateFollowUps(input, { useReasoner = false } = {}) {
    const prompt = buildFollowUpQuestionPrompt(input);
    const { text, usage } = await this._chat({
      model: useReasoner ? this.reasoningModel : this.fastModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens: 800,
      responseFormat: useReasoner ? undefined : { type: 'json_object' }
    });
    return { raw: text, usage, parsed: safeJsonParse(text) };
  }

  // ---------- Generic role-play call (used by candidate / baseline agents) ----------
  async roleplay({ systemPrompt, userMessage, history = [], temperature = 0.7, maxTokens = 600 }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const turn of history) messages.push(turn);
    if (userMessage) messages.push({ role: 'user', content: userMessage });

    const { text, usage } = await this._chat({
      model: this.fastModel,
      messages,
      temperature,
      maxTokens
    });
    return { text, usage };
  }
}

function safeJsonParse(text) {
  if (!text) return null;
  // Strip code fences if any
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // try to extract first { ... } block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (_2) { return null; }
    }
    return null;
  }
}

module.exports = DeepSeekService;
