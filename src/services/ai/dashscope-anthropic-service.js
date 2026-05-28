// ============================================================================
// DASHSCOPE ANTHROPIC-SHAPE AI SERVICE
// ----------------------------------------------------------------------------
// DashScope (Aliyun BaiLian) exposes the latest hosted models (DeepSeek V4,
// Qwen 3.6 Max Preview, Qwen 3.7 Max) ONLY through its Anthropic-compatible
// endpoint at `/apps/anthropic/v1/messages`. The OpenAI-compatible endpoint
// (`/compatible-mode/v1`) lags by a model generation. To use the V4 stack we
// have to speak the Anthropic Messages API.
//
// Public surface matches OpenAiCompatibleService so the AI runtime can swap
// either backend without callers caring. Key protocol differences handled
// here:
//   - Endpoint:  POST /v1/messages
//   - Headers:   x-api-key + anthropic-version  (NOT Authorization: Bearer)
//   - Request:   { model, system, messages, max_tokens }
//                where messages[].content is string | content-block[]
//   - Response:  { content: [{type:'text', text}], usage:{...} }
//   - Streaming: SSE with `content_block_delta` carrying {delta:{type,text}}
//   - Vision:    {type:'image', source:{type:'base64', media_type, data}}
// ============================================================================

const {
  resolveProgrammingLanguage
} = require('../../config');
const {
  buildAnswerQuestionPrompt,
  buildAskAiSessionPrompt,
  buildFollowUpEmailPrompt,
  buildInsightsPrompt,
  buildMeetingNotesPrompt,
  buildScreenshotAnalysisPrompt,
  buildSuggestResponsePrompt
} = require('./prompts');

const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const DEFAULT_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = '2023-06-01';

// Same vision detection as the OpenAI-compat service — model names containing
// `vl|vlm|vision|omni` get image content blocks; others get text fallback
// with a note.
function modelSupportsVision(modelName) {
  return /(^|[-_/])(vl|vlm|vision|omni)(-|_|\d|$)/i.test(String(modelName || ''));
}

class DashscopeAnthropicService {
  constructor({ providerName, baseUrl, apiKey, modelName, programmingLanguage, requestTimeoutMs, maxTokens } = {}) {
    this.providerName = String(providerName || 'DashScope').trim();
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.apiKey = String(apiKey || '').trim();
    this.modelName = String(modelName || '').trim();
    this.programmingLanguage = resolveProgrammingLanguage(programmingLanguage);
    this.requestTimeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS;

    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minRequestInterval = 200;
    this.maxRetries = 2;
    this.isProcessing = false;

    this.conversationHistory = [];
    this.maxHistoryLength = 20;

    console.log(`${this.providerName}Service (anthropic) initialized: ${this.modelName} @ ${this.baseUrl}`);
  }

  supportsVision() {
    return modelSupportsVision(this.modelName);
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    const nextBaseUrl = String(options.baseUrl ?? this.baseUrl).replace(/\/+$/, '');
    const nextApiKey = String(options.apiKey ?? this.apiKey).trim();
    const nextModelName = String(options.modelName ?? this.modelName).trim();
    const nextProgrammingLanguage = resolveProgrammingLanguage(
      options.programmingLanguage ?? this.programmingLanguage
    );

    const apiKeyChanged = nextApiKey !== this.apiKey;
    const modelChanged = nextModelName !== this.modelName;
    const programmingLanguageChanged = nextProgrammingLanguage !== previousProgrammingLanguage;

    this.baseUrl = nextBaseUrl;
    this.apiKey = nextApiKey;
    this.modelName = nextModelName;
    this.programmingLanguage = nextProgrammingLanguage;

    return { apiKeyChanged, modelChanged, programmingLanguageChanged };
  }

  isQuotaExhaustedError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('quota') || message.includes('insufficient_quota') || message.includes('rate_limit');
  }

  isAuthenticationError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('401') || message.includes('unauthorized') || message.includes('invalid api key');
  }

  isRetryableError(error) {
    const message = String(error?.message || '');
    return (
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('fetch failed') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    );
  }

  async waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise((r) => setTimeout(r, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  _extractTextFromParts(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
      return data
        .filter((p) => typeof p === 'string' || p?.text)
        .map((p) => (typeof p === 'string' ? p : p.text))
        .join('\n');
    }
    return String(data || '');
  }

  // Convert {inlineData:{data,mimeType}} parts into Anthropic image blocks.
  _toAnthropicImageBlocks(imageParts) {
    if (!Array.isArray(imageParts)) return [];
    const out = [];
    for (const part of imageParts) {
      const data = part?.inlineData?.data;
      const mediaType = part?.inlineData?.mimeType || 'image/png';
      if (typeof data === 'string' && data.length > 0) {
        out.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data }
        });
      }
    }
    return out;
  }

  _buildRequestBody(prompt, imageParts = null) {
    const system = 'You are a helpful AI assistant.';
    let userContent;

    if (this.supportsVision() && Array.isArray(imageParts) && imageParts.length > 0) {
      const imageBlocks = this._toAnthropicImageBlocks(imageParts);
      if (imageBlocks.length > 0) {
        userContent = [
          ...imageBlocks,
          { type: 'text', text: String(prompt || '') }
        ];
      }
    }
    if (userContent === undefined) {
      userContent = String(prompt || '');
    }

    return {
      model: this.modelName,
      system,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: this.maxTokens
    };
  }

  _endpoint() {
    return `${this.baseUrl}/v1/messages`;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': this.apiKey
    };
  }

  async _fetchWithTimeout(body, { stream = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(this._endpoint(), {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(stream ? { ...body, stream: true } : body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async _chat(prompt, imageParts = null) {
    if (!this.apiKey) {
      throw new Error(`${this.providerName} API key not configured. Add it in Settings.`);
    }
    const body = this._buildRequestBody(prompt, imageParts);
    const resp = await this._fetchWithTimeout(body);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${this.providerName} API ${resp.status}: ${text.slice(0, 400)}`);
    }
    const json = await resp.json();
    // Anthropic returns content as an array of blocks; concatenate text blocks.
    const blocks = Array.isArray(json?.content) ? json.content : [];
    return blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }

  async _streamChat(prompt, request, imageParts = null) {
    if (!this.apiKey) {
      throw new Error(`${this.providerName} API key not configured. Add it in Settings.`);
    }
    const body = this._buildRequestBody(prompt, imageParts);
    const resp = await this._fetchWithTimeout(body, { stream: true });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${this.providerName} API ${resp.status}: ${text.slice(0, 400)}`);
    }

    let fullText = '';
    let chunkIndex = 0;
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of resp.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload);
          // Anthropic SSE: { type: 'content_block_delta', delta: { type:'text_delta', text:'...' } }
          if (parsed?.type === 'content_block_delta') {
            const deltaText = parsed?.delta?.text || '';
            if (deltaText) {
              fullText += deltaText;
              chunkIndex += 1;
              if (!request._firstChunkSent) request._firstChunkSent = true;
              request.onChunk({ text: deltaText, index: chunkIndex });
            }
          }
          // message_stop closes the stream; nothing else to do, server ends body.
        } catch (_) { /* skip malformed SSE lines */ }
      }
    }
    return fullText;
  }

  async _executeRequest(request, retryCount = 0) {
    try {
      const prompt = typeof request.data === 'string'
        ? request.data
        : this._extractTextFromParts(request.data);
      const imageParts = Array.isArray(request.imageParts) ? request.imageParts : null;

      if (typeof request.onChunk === 'function') {
        return await this._streamChat(prompt, request, imageParts);
      }
      return await this._chat(prompt, imageParts);
    } catch (error) {
      if (request._firstChunkSent) throw error;
      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const backoff = Math.pow(2, retryCount) * 1000;
        await new Promise((r) => setTimeout(r, backoff));
        return this._executeRequest(request, retryCount + 1);
      }
      throw error;
    }
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) return;
    this.isProcessing = true;
    while (this.requestQueue.length > 0) {
      const req = this.requestQueue.shift();
      try {
        await this.waitForRateLimit();
        const result = await this._executeRequest(req);
        req.resolve(result);
      } catch (error) {
        req.reject(error);
      }
    }
    this.isProcessing = false;
  }

  async generateText(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        type: 'text',
        data: prompt,
        imageParts: Array.isArray(options.imageParts) ? options.imageParts : null,
        resolve,
        reject,
        onChunk: typeof options.onChunk === 'function' ? options.onChunk : null
      });
      this.processQueue();
    });
  }

  async generateMultimodal(parts, options = {}) {
    const partsArray = Array.isArray(parts) ? parts : [parts];
    const imageParts = partsArray.filter((p) => p?.inlineData?.data);
    const textFragments = partsArray
      .filter((p) => typeof p === 'string' || typeof p?.text === 'string')
      .map((p) => (typeof p === 'string' ? p : p.text));
    const promptText = textFragments.join('\n');

    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        type: 'multimodal',
        data: promptText,
        imageParts: imageParts.length > 0 ? imageParts : null,
        resolve,
        reject,
        onChunk: typeof options.onChunk === 'function' ? options.onChunk : null
      });
      this.processQueue();
    });
  }

  addToHistory(role, content) {
    this.conversationHistory.push({ role, content });
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getContextString() {
    return this.conversationHistory
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join('\n\n');
  }

  async analyzeScreenshots(imageParts, additionalContext = '', options = {}) {
    const contextString = typeof options.contextStringOverride === 'string'
      ? options.contextStringOverride
      : this.getContextString();
    const prompt = buildScreenshotAnalysisPrompt({
      contextString,
      additionalContext,
      programmingLanguage: this.programmingLanguage
    });
    const usableImages = Array.isArray(imageParts) ? imageParts.filter((p) => p?.inlineData?.data) : [];
    const canSendImages = this.supportsVision() && usableImages.length > 0;
    const finalPrompt = canSendImages
      ? prompt
      : `${prompt}\n\n[Note: ${usableImages.length} screenshot(s) were captured but the active ${this.providerName} model "${this.modelName}" is not vision-capable. Respond based on the text context only — switch to a *-vl-* / *-vision-* / *-omni-* model to use image analysis.]`;
    const result = await this.generateText(finalPrompt, {
      onChunk: options.onChunk,
      imageParts: canSendImages ? usableImages : null
    });
    this.addToHistory('assistant', `Screenshot analysis: ${result}`);
    return result;
  }

  async analyzeScreenshot(imageBase64, additionalContext = '') {
    return this.analyzeScreenshots(
      [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }],
      additionalContext
    );
  }

  async askAiWithSessionContext(options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    const prompt = buildAskAiSessionPrompt({
      contextString,
      transcriptContext: options.transcriptContext || '',
      sessionSummary: options.sessionSummary || '',
      screenshotCount: options.screenshotCount || 0,
      mode: options.mode || 'best-next-answer'
    });
    const result = await this.generateText(prompt, { onChunk: options.onChunk });
    this.addToHistory('assistant', `Ask AI: ${result}`);
    return result;
  }

  async askAiWithSessionContextAndScreenshots(imageParts, options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    const usableImages = Array.isArray(imageParts) ? imageParts.filter((p) => p?.inlineData?.data) : [];
    const prompt = buildAskAiSessionPrompt({
      contextString,
      transcriptContext: options.transcriptContext || '',
      sessionSummary: options.sessionSummary || '',
      screenshotCount: options.screenshotCount || usableImages.length,
      mode: options.mode || 'best-next-answer'
    });
    const canSendImages = this.supportsVision() && usableImages.length > 0;
    const finalPrompt = canSendImages
      ? prompt
      : `${prompt}\n\n[Note: ${usableImages.length} screenshot(s) were captured but the active ${this.providerName} model "${this.modelName}" is not vision-capable. Switch to a *-vl-* / *-vision-* / *-omni-* model to use image analysis.]`;
    const result = await this.generateText(finalPrompt, {
      onChunk: options.onChunk,
      imageParts: canSendImages ? usableImages : null
    });
    this.addToHistory('assistant', `Ask AI: ${result}`);
    return result;
  }

  async suggestResponse(context, options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    const prompt = buildSuggestResponsePrompt({ contextString, context });
    return this.generateText(prompt, { onChunk: options.onChunk });
  }

  async generateMeetingNotes(options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    if (!contextString.trim()) return 'No conversation history to summarize.';
    const prompt = buildMeetingNotesPrompt({ contextString });
    return this.generateText(prompt, { onChunk: options.onChunk });
  }

  async generateFollowUpEmail(options = {}) {
    if (this.conversationHistory.length === 0) return 'No conversation history to create email from.';
    const contextString = this.getContextString();
    const prompt = buildFollowUpEmailPrompt({ contextString });
    return this.generateText(prompt, { onChunk: options.onChunk });
  }

  async answerQuestion(question, options = {}) {
    const contextString = this.getContextString();
    const prompt = buildAnswerQuestionPrompt({
      contextString,
      question,
      programmingLanguage: this.programmingLanguage
    });
    const result = await this.generateText(prompt, { onChunk: options.onChunk });
    this.addToHistory('user', question);
    this.addToHistory('assistant', result);
    return result;
  }

  async getConversationInsights(options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    if (!contextString.trim()) return 'Not enough conversation data for insights.';
    const prompt = buildInsightsPrompt({ contextString });
    return this.generateText(prompt, { onChunk: options.onChunk });
  }
}

module.exports = DashscopeAnthropicService;
