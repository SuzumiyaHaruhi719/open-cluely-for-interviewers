// AI runtime — single DashScope provider (Qwen + DeepSeek + Qwen-VL) routed
// through DashScope's Anthropic-shape endpoint. File name is historic.

const DashscopeAnthropicService = require('../../../services/ai/dashscope-anthropic-service');
const {
  getDashscopeBaseUrl,
  getDashscopeAiModels,
  getDefaultDashscopeAiModel,
  resolveDashscopeAiModel,
  resolveProgrammingLanguage,
  getProgrammingLanguages,
  getDefaultProgrammingLanguage
} = require('../../../config');

function createGeminiRuntime(options = {}) {
  const getDashscopeApiKey = typeof options.getDashscopeApiKey === 'function'
    ? options.getDashscopeApiKey
    : () => '';

  let dashscopeService = null;
  let activeDashscopeAiModel = getDefaultDashscopeAiModel();
  let activeProgrammingLanguage = getDefaultProgrammingLanguage();

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

  function initializeAiService() {
    return initializeDashscopeService(activeDashscopeAiModel, activeProgrammingLanguage);
  }

  async function executeWithKeyFailover(operation) {
    if (typeof operation !== 'function') {
      throw new Error('AI operation must be a function.');
    }

    if (!dashscopeService) initializeDashscopeService();
    if (!dashscopeService) {
      throw new Error('DashScope AI service not available. Configure DashScope API key in Settings.');
    }
    return await operation(dashscopeService, { attempt: 1, totalKeys: 0 });
  }

  function isAllKeysUnavailableError(error) {
    return Boolean(error && error.code === 'DASHSCOPE_KEY_UNAVAILABLE');
  }

  function setActiveDashscopeAiModel(modelName) {
    activeDashscopeAiModel = resolveDashscopeAiModel(modelName);
    return activeDashscopeAiModel;
  }

  function getActiveDashscopeAiModel() {
    return activeDashscopeAiModel;
  }

  function getService() {
    return dashscopeService;
  }

  function hasApiKeys() {
    return String(getDashscopeApiKey() || '').trim().length > 0;
  }

  function getApiKeys() {
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
    initializeAiService,
    executeWithKeyFailover,
    isAllKeysUnavailableError,
    hasApiKeys,
    getApiKeys,
    getService,
    getDashscopeAiModels,
    getDefaultDashscopeAiModel,
    getActiveDashscopeAiModel,
    setActiveDashscopeAiModel,
    getProgrammingLanguages,
    getDefaultProgrammingLanguage,
    getActiveProgrammingLanguage,
    setActiveProgrammingLanguage
  };
}

module.exports = {
  createGeminiRuntime
};
