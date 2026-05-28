// ============================================================================
// AI runtime
// ----------------------------------------------------------------------------
// Single front-door over the two active AI provider backends:
//   - dashscope: hosted Qwen + DeepSeek via DashScope's OpenAI-compatible
//     endpoint. One key, model selectable in Settings.
//   - ollama:    optional local fallback.
//
// File name is historic (was gemini-runtime when Gemini was the default).
// ============================================================================

const OllamaService = require('../../../services/ai/ollama-service');
const DashscopeAnthropicService = require('../../../services/ai/dashscope-anthropic-service');
const {
  resolveAiProvider,
  getAiProviders,
  getDefaultAiProvider,
  getDashscopeBaseUrl,
  getDashscopeAiModels,
  getDefaultDashscopeAiModel,
  resolveDashscopeAiModel,
  getDefaultOllamaBaseUrl,
  getDefaultOllamaModel,
  resolveProgrammingLanguage,
  getProgrammingLanguages,
  getDefaultProgrammingLanguage
} = require('../../../config');

function createGeminiRuntime(options = {}) {
  // Lets the runtime read the DashScope key from app-state on every call.
  const getDashscopeApiKey = typeof options.getDashscopeApiKey === 'function'
    ? options.getDashscopeApiKey
    : () => '';

  let dashscopeService = null;
  let ollamaService = null;
  let activeAiProvider = getDefaultAiProvider();
  let activeDashscopeAiModel = getDefaultDashscopeAiModel();
  let activeProgrammingLanguage = getDefaultProgrammingLanguage();
  let activeOllamaBaseUrl = getDefaultOllamaBaseUrl();
  let activeOllamaModel = getDefaultOllamaModel();

  function initializeDashscopeService(
    modelName = activeDashscopeAiModel,
    programmingLanguage = activeProgrammingLanguage
  ) {
    activeDashscopeAiModel = resolveDashscopeAiModel(modelName);
    activeProgrammingLanguage = resolveProgrammingLanguage(programmingLanguage);
    const apiKey = String(getDashscopeApiKey() || '').trim();

    try {
      if (dashscopeService) {
        dashscopeService.updateConfiguration({
          baseUrl: getDashscopeBaseUrl(),
          apiKey,
          modelName: activeDashscopeAiModel,
          programmingLanguage: activeProgrammingLanguage
        });
      } else {
        dashscopeService = new DashscopeAnthropicService({
          providerName: 'DashScope',
          baseUrl: getDashscopeBaseUrl(),
          apiKey,
          modelName: activeDashscopeAiModel,
          programmingLanguage: activeProgrammingLanguage
        });
      }
      console.log(`DashScope AI service initialized: ${activeDashscopeAiModel}`);
      return dashscopeService;
    } catch (error) {
      dashscopeService = null;
      console.error('Failed to initialize DashScope AI service:', error);
      return null;
    }
  }

  function initializeOllamaService(
    baseUrl = activeOllamaBaseUrl,
    modelName = activeOllamaModel,
    programmingLanguage = activeProgrammingLanguage
  ) {
    activeOllamaBaseUrl = String(baseUrl || getDefaultOllamaBaseUrl()).replace(/\/+$/, '');
    activeOllamaModel = String(modelName || getDefaultOllamaModel()).trim();
    activeProgrammingLanguage = resolveProgrammingLanguage(programmingLanguage);

    try {
      if (ollamaService) {
        ollamaService.updateConfiguration({
          baseUrl: activeOllamaBaseUrl,
          modelName: activeOllamaModel,
          programmingLanguage: activeProgrammingLanguage
        });
      } else {
        ollamaService = new OllamaService({
          baseUrl: activeOllamaBaseUrl,
          modelName: activeOllamaModel,
          programmingLanguage: activeProgrammingLanguage
        });
      }
      console.log(`Ollama AI service initialized: ${activeOllamaModel} @ ${activeOllamaBaseUrl}`);
      return ollamaService;
    } catch (error) {
      ollamaService = null;
      console.error('Failed to initialize Ollama AI service:', error);
      return null;
    }
  }

  function initializeAiService() {
    if (activeAiProvider === 'ollama') {
      return initializeOllamaService(activeOllamaBaseUrl, activeOllamaModel, activeProgrammingLanguage);
    }
    return initializeDashscopeService(activeDashscopeAiModel, activeProgrammingLanguage);
  }

  async function executeWithKeyFailover(operation) {
    if (typeof operation !== 'function') {
      throw new Error('AI failover operation must be a function.');
    }

    if (activeAiProvider === 'ollama') {
      if (!ollamaService) initializeOllamaService();
      if (!ollamaService) {
        throw new Error('Ollama service not available. Check that Ollama is running.');
      }
      return await operation(ollamaService, { attempt: 1, totalKeys: 0 });
    }

    if (!dashscopeService) initializeDashscopeService();
    if (!dashscopeService) {
      throw new Error('DashScope AI service not available. Configure DashScope API key in Settings.');
    }
    return await operation(dashscopeService, { attempt: 1, totalKeys: 0 });
  }

  function isAllKeysUnavailableError(error) {
    // Single-key providers — kept for callers that still check this.
    return Boolean(error && (error.code === 'DASHSCOPE_KEY_UNAVAILABLE'));
  }

  function setActiveAiProvider(providerName) {
    activeAiProvider = resolveAiProvider(providerName);
    return activeAiProvider;
  }

  function getActiveAiProvider() {
    return activeAiProvider;
  }

  function setActiveDashscopeAiModel(modelName) {
    activeDashscopeAiModel = resolveDashscopeAiModel(modelName);
    return activeDashscopeAiModel;
  }

  function getActiveDashscopeAiModel() {
    return activeDashscopeAiModel;
  }

  function setActiveOllamaBaseUrl(baseUrl) {
    activeOllamaBaseUrl = String(baseUrl || getDefaultOllamaBaseUrl()).replace(/\/+$/, '');
    return activeOllamaBaseUrl;
  }

  function getActiveOllamaBaseUrl() {
    return activeOllamaBaseUrl;
  }

  function setActiveOllamaModel(modelName) {
    activeOllamaModel = String(modelName || getDefaultOllamaModel()).trim();
    return activeOllamaModel;
  }

  function getActiveOllamaModel() {
    return activeOllamaModel;
  }

  function getService() {
    if (activeAiProvider === 'ollama') return ollamaService;
    return dashscopeService;
  }

  // Back-compat shim: assistant/ipc.js still gates AI actions on this. After
  // the dashscope unification "has any API key" is equivalent to "current
  // provider can run inference" — dashscope needs a key, ollama doesn't.
  function hasApiKeys() {
    if (activeAiProvider === 'ollama') return true;
    return String(getDashscopeApiKey() || '').trim().length > 0;
  }

  function getApiKeys() {
    if (activeAiProvider === 'ollama') return [];
    const key = String(getDashscopeApiKey() || '').trim();
    return key ? [key] : [];
  }

  function getActiveProgrammingLanguage() {
    return activeProgrammingLanguage;
  }

  function setActiveProgrammingLanguage(language) {
    activeProgrammingLanguage = resolveProgrammingLanguage(language);
    return activeProgrammingLanguage;
  }

  return {
    initializeDashscopeService,
    initializeOllamaService,
    initializeAiService,
    executeWithKeyFailover,
    isAllKeysUnavailableError,
    hasApiKeys,
    getApiKeys,
    getService,
    getAiProviders,
    getDefaultAiProvider,
    getActiveAiProvider,
    setActiveAiProvider,
    getDashscopeAiModels,
    getDefaultDashscopeAiModel,
    getActiveDashscopeAiModel,
    setActiveDashscopeAiModel,
    getDefaultOllamaBaseUrl,
    getDefaultOllamaModel,
    getActiveOllamaBaseUrl,
    setActiveOllamaBaseUrl,
    getActiveOllamaModel,
    setActiveOllamaModel,
    getProgrammingLanguages,
    getDefaultProgrammingLanguage,
    getActiveProgrammingLanguage,
    setActiveProgrammingLanguage
  };
}

module.exports = {
  createGeminiRuntime
};
