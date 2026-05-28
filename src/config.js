// AI provider configuration.
// All hosted AI (Qwen + DeepSeek + Qwen-VL multimodal) flows through Aliyun
// DashScope's Anthropic-shape endpoint with one API key.

// DashScope publishes two API surfaces over the same key. We use the
// Anthropic-shape one because that's where the latest hosted models
// (DeepSeek V4 family, Qwen 3.6 Max Preview, Qwen 3.7 Max) actually ship.
// The OpenAI-compat surface (`/compatible-mode/v1`) lags ~one generation
// as of May 2026.
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/apps/anthropic';

// Models exposed on the Anthropic-shape DashScope endpoint. First entry is
// the default. Use *-vl-* for screenshots; the rest are text-only.
const DASHSCOPE_AI_MODELS = [
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'qwen3.6-max-preview',
  'qwen3.6-plus',
  'qwen3.6-flash',
  'qwen3.7-max',
  'qwen3-vl-max-latest',
  'qwen3-vl-plus'
];
const DEFAULT_DASHSCOPE_AI_MODEL = DASHSCOPE_AI_MODELS[0];

// Model used by the interviewer copilot Stage 1 (hook detection) + Stage 2
// (follow-up generation). Flash tier is plenty for the 2-call-per-answer
// pipeline; swap to deepseek-v4-pro if you want deeper reasoning at higher
// latency.
const DEFAULT_INTERVIEWER_MODEL = 'deepseek-v4-flash';

// Programming language configuration.
// The first language in this list is treated as the default language everywhere.
const PROGRAMMING_LANGUAGES = [
  'Python',
  'Java',
  'JavaScript',
  'TypeScript',
  'C++',
  'Go',
  'Rust',
  'C#',
  'Kotlin'
];

// Keyboard shortcuts configuration.
// Edit accelerators here to customize app shortcuts in one place.
const KEYBOARD_SHORTCUTS = [
  {
    id: 'toggleTranscription',
    buttonLabel: 'Transcription',
    description: 'Toggle transcription master control',
    accelerator: 'Alt+Shift+T'
  },
  {
    id: 'takeScreenshot',
    buttonLabel: 'Screenshot',
    description: 'Capture screenshot',
    accelerator: 'Alt+Shift+S'
  },
  {
    id: 'askAi',
    buttonLabel: 'Ask AI',
    description: 'Uses only enabled transcript, enabled screenshots, and enabled chat context',
    accelerator: 'Alt+Shift+A'
  },
  {
    id: 'screenAi',
    buttonLabel: 'Screen AI',
    description: 'Analyzes only enabled screenshots selected in chat',
    accelerator: 'Alt+Shift+E'
  },
  {
    id: 'suggest',
    buttonLabel: 'Suggest',
    description: 'Uses only enabled transcript context to suggest what to say next',
    accelerator: 'Alt+Shift+G'
  },
  {
    id: 'notes',
    buttonLabel: 'Notes',
    description: 'Generates notes from only enabled context',
    accelerator: 'Alt+Shift+N'
  },
  {
    id: 'insights',
    buttonLabel: 'Insights',
    description: 'Finds key insights from only enabled context',
    accelerator: 'Alt+Shift+I'
  },
  {
    id: 'clearChat',
    buttonLabel: 'Clear Chat',
    description: 'Clears chat, screenshots, and AI history',
    accelerator: 'Alt+Shift+C'
  },
  {
    id: 'emergencyHide',
    buttonLabel: 'Hide',
    description: 'Emergency hide',
    accelerator: 'Alt+Shift+X'
  },
  {
    id: 'toggleStealth',
    buttonLabel: 'Toggle Stealth',
    description: 'Toggle stealth mode',
    accelerator: 'Alt+Shift+H'
  },
  {
    id: 'moveWindowLeft',
    buttonLabel: 'Move Window Left',
    description: 'Move window to left side',
    accelerator: 'Alt+Shift+Left'
  },
  {
    id: 'moveWindowRight',
    buttonLabel: 'Move Window Right',
    description: 'Move window to right side',
    accelerator: 'Alt+Shift+Right'
  },
  {
    id: 'moveWindowUp',
    buttonLabel: 'Move Window Up',
    description: 'Move window to top',
    accelerator: 'Alt+Shift+Up'
  },
  {
    id: 'moveWindowDown',
    buttonLabel: 'Move Window Down',
    description: 'Move window to bottom',
    accelerator: 'Alt+Shift+Down'
  },
  {
    id: 'windowSizePreset1',
    buttonLabel: 'Size Preset 1',
    description: 'Resize window to minimum size',
    accelerator: 'Alt+Shift+1'
  },
  {
    id: 'windowSizePreset2',
    buttonLabel: 'Size Preset 2',
    description: 'Resize window to +25% from minimum size',
    accelerator: 'Alt+Shift+2'
  },
  {
    id: 'windowSizePreset3',
    buttonLabel: 'Size Preset 3',
    description: 'Resize window to +50% from minimum size',
    accelerator: 'Alt+Shift+3'
  },
  {
    id: 'windowSizePreset4',
    buttonLabel: 'Size Preset 4',
    description: 'Resize window to +75% from minimum size',
    accelerator: 'Alt+Shift+4'
  }
];

function getDashscopeBaseUrl() {
  return DASHSCOPE_BASE_URL;
}

function getDashscopeAiModels() {
  return [...DASHSCOPE_AI_MODELS];
}

function getDefaultDashscopeAiModel() {
  return DEFAULT_DASHSCOPE_AI_MODEL;
}

function isConfiguredDashscopeAiModel(modelName) {
  return DASHSCOPE_AI_MODELS.includes(modelName);
}

function resolveDashscopeAiModel(modelName) {
  return isConfiguredDashscopeAiModel(modelName)
    ? modelName
    : DEFAULT_DASHSCOPE_AI_MODEL;
}

function getDefaultInterviewerModel() {
  return DEFAULT_INTERVIEWER_MODEL;
}

function getProgrammingLanguages() {
  if (!Array.isArray(PROGRAMMING_LANGUAGES) || PROGRAMMING_LANGUAGES.length === 0) {
    throw new Error('Programming languages are not configured. Add at least one language to src/config.js.');
  }
  return [...PROGRAMMING_LANGUAGES];
}

function getDefaultProgrammingLanguage() {
  return getProgrammingLanguages()[0];
}

function isConfiguredProgrammingLanguage(languageName) {
  return getProgrammingLanguages().includes(languageName);
}

function resolveProgrammingLanguage(languageName) {
  return isConfiguredProgrammingLanguage(languageName)
    ? languageName
    : getDefaultProgrammingLanguage();
}

function getKeyboardShortcuts() {
  if (!Array.isArray(KEYBOARD_SHORTCUTS) || KEYBOARD_SHORTCUTS.length === 0) {
    throw new Error('Keyboard shortcuts are not configured. Add at least one shortcut to src/config.js.');
  }
  return KEYBOARD_SHORTCUTS.map((shortcut) => ({ ...shortcut }));
}

function getKeyboardShortcutById(shortcutId) {
  const normalizedId = String(shortcutId || '').trim();
  if (!normalizedId) {
    throw new Error('Shortcut id is required.');
  }
  const shortcut = getKeyboardShortcuts().find((entry) => entry.id === normalizedId);
  if (!shortcut) {
    throw new Error(`Shortcut "${normalizedId}" is not configured in src/config.js.`);
  }
  return shortcut;
}

function getKeyboardShortcutAccelerator(shortcutId) {
  const shortcut = getKeyboardShortcutById(shortcutId);
  const accelerator = String(shortcut.accelerator || '').trim();
  if (!accelerator) {
    throw new Error(`Shortcut "${shortcutId}" is missing an accelerator in src/config.js.`);
  }
  return accelerator;
}

module.exports = {
  getDashscopeBaseUrl,
  getDashscopeAiModels,
  getDefaultDashscopeAiModel,
  isConfiguredDashscopeAiModel,
  resolveDashscopeAiModel,
  getDefaultInterviewerModel,
  getProgrammingLanguages,
  getDefaultProgrammingLanguage,
  isConfiguredProgrammingLanguage,
  resolveProgrammingLanguage,
  getKeyboardShortcuts,
  getKeyboardShortcutById,
  getKeyboardShortcutAccelerator
};
