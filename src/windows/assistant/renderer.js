/// <reference path="./renderer-globals.d.ts" />

import { createMessageStore } from './renderer/features/ai-context/message-store.js';
import { buildFilteredAiContextBundle as buildAiContextBundle } from './renderer/features/ai-context/context-bundle.js';
import { updateMessageAiToggleUi as syncMessageAiToggleUi } from './renderer/features/ai-context/toggle-ui.js';
import { createChatUiManager } from './renderer/features/chat/chat-ui-manager.js';
import { createWindowAdjustmentManager } from './renderer/features/layout/window-adjustments.js';
import { setupEventListeners as setupEventListenersModule } from './renderer/features/listeners/event-listeners.js';
import { setupIpcListeners as setupIpcListenersModule } from './renderer/features/listeners/ipc-listeners.js';
import { createShortcutManager } from './renderer/features/settings/shortcut-manager.js';
import {
    createSettingsPanelManager,
    getSelectedMicDeviceId as readSelectedMicDeviceId,
    getSelectedSystemSourceValue as readSelectedSystemSourceValue,
    parseSystemSourceSelection
} from './renderer/features/settings/settings-panel-manager.js';
import { createTranscriptionManager } from './renderer/features/transcription/transcription-manager.js';

import {
    createTranscriptionSourceState,
    normalizeSource as normalizeAssemblySource,
    sourceLabel as resolveSourceLabel
} from './renderer/features/assembly-ai/source-state.js';
import { createAudioPipeline } from './renderer/features/assembly-ai/audio-pipeline.js';
import { createTranscriptBufferManager } from './renderer/features/assembly-ai/transcript-buffer.js';
// Renderer with AssemblyAI Streaming Transcription - Real-time & Accurate!
// Uses AssemblyAI WebSocket API for live speech-to-text

let screenshotsCount = 0;
let isAnalyzing = false;
let stealthHideTimeout = null;
const THEME_STORAGE_KEY = 'assistant-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
// Dark is the default because the light theme leaves several panels
// (settings, monitor) with white text on a 92%-white glass background.
// The full contrast pass lives under `body.theme-dark` in styles.css.
let activeTheme = THEME_DARK;
const AI_CONTEXT_CHAR_BUDGET = 12000;
const messageStore = createMessageStore();
let chatMessagesArray = messageStore.getMessages();
const transcriptionSourceState = createTranscriptionSourceState();

// Source selection state (default: host/system on, mic off)
const selectedSources = transcriptionSourceState.selectedSources;

const audioPipeline = createAudioPipeline({
    sendAudioChunk: (source, audioBuffer) => {
        window.electronAPI.sendAudioChunk(source, audioBuffer);
    },
    addMonitorLog: (...args) => addMonitorLog(...args)
});

const INTERVIEWER_QUESTION_HISTORY_LIMIT = 20;
const interviewerQuestionHistory = [];
let interviewerAnalysisInFlight = false;
// Holds the latest answer that arrived while an analysis was already running.
// We collapse to only the newest so bursty finals don't queue up unbounded.
let interviewerPendingAnswer = null;
let interviewerSkipKeyWarned = false;

function pushInterviewerQuestion(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    interviewerQuestionHistory.push(trimmed);
    if (interviewerQuestionHistory.length > INTERVIEWER_QUESTION_HISTORY_LIMIT) {
        interviewerQuestionHistory.splice(0, interviewerQuestionHistory.length - INTERVIEWER_QUESTION_HISTORY_LIMIT);
    }
}

function renderInterviewerCoachMessage(stage2Parsed, stage1Parsed) {
    const questions = Array.isArray(stage2Parsed?.questions) ? stage2Parsed.questions : [];
    if (questions.length === 0) return;

    const lines = [];
    questions
        .slice()
        .sort((a, b) => (a.priority || 99) - (b.priority || 99))
        .forEach((q) => {
            const priority = q.priority ? `P${q.priority}` : '·';
            const questionText = String(q.question || '').trim();
            const rationale = String(q.rationale || '').trim();
            if (!questionText) return;
            lines.push(`**${priority}** ${questionText}`);
            if (rationale) {
                lines.push(`*${rationale}*`);
            }
        });

    const score = stage1Parsed?.score;
    const direction = stage1Parsed?.recommended_direction;
    const headerBits = [];
    if (typeof score === 'number') headerBits.push(`score ${score}`);
    if (direction) headerBits.push(direction);
    const header = headerBits.length ? `_(${headerBits.join(' · ')})_` : '';

    const body = (header ? `${header}\n\n` : '') + lines.join('\n');
    addChatMessage('interviewer-coach', body);
}

async function triggerInterviewerAnalysis(candidateAnswer, emotion = null) {
    if (!window.electronAPI?.interviewerAnalyzeAnswer) return;

    // Coalesce: if a request is already in flight, replace the pending answer
    // with the latest one and let the in-flight one finish. We process the
    // pending answer after the current one resolves.
    if (interviewerAnalysisInFlight) {
        interviewerPendingAnswer = { candidateAnswer, emotion };
        return;
    }

    interviewerAnalysisInFlight = true;
    try {
        const response = await window.electronAPI.interviewerAnalyzeAnswer({
            candidateAnswer,
            emotion,
            questionHistory: interviewerQuestionHistory.slice()
        });
        if (!response || response.success === false) {
            if (response?.error) {
                addMonitorLog('warn', 'interviewer', response.error, 'system');
            }
            return;
        }
        if (response.skipped) {
            // Don't spam the monitor for every short / unconfigured final.
            // Warn once when the DeepSeek key is missing so the user knows
            // why the coach is silent; subsequent skips stay quiet.
            if (response.reason === 'no-dashscope-key' && !interviewerSkipKeyWarned) {
                interviewerSkipKeyWarned = true;
                addMonitorLog('warn', 'interviewer', 'AI key (DashScope) not configured — interviewer coach disabled. Add it in Settings.', 'system');
            }
            return;
        }
        // Reset the once-warned latch if a successful analysis happened
        // (means the user added the key and the system recovered).
        interviewerSkipKeyWarned = false;

        if (response.shouldShowFollowUps && response.stage2?.parsed) {
            renderInterviewerCoachMessage(response.stage2.parsed, response.stage1?.parsed);
        } else {
            addMonitorLog('info', 'interviewer', `Stage1 score ${response.stage1?.parsed?.score ?? '?'} — no follow-up emitted`, 'system');
        }
    } catch (err) {
        addMonitorLog('error', 'interviewer', err?.message || 'analysis failed', 'system');
    } finally {
        interviewerAnalysisInFlight = false;
        // Drain the pending answer (if any final arrived while busy).
        if (interviewerPendingAnswer) {
            const next = interviewerPendingAnswer;
            interviewerPendingAnswer = null;
            // Backward-compat: older code paths may stash a bare string here.
            if (typeof next === 'string') {
                triggerInterviewerAnalysis(next, null);
            } else {
                triggerInterviewerAnalysis(next.candidateAnswer, next.emotion);
            }
        }
    }
}

const transcriptBufferManager = createTranscriptBufferManager({
    // 9s window keeps natural conversational pauses (3-6s) inside a single
    // bubble. Bubbles still force-flush at maxBufferChars so a long answer
    // doesn't grow without bound.
    mergeWindowMs: 9000,
    onBuffer: ({ source, text, segments }) => {
        addMonitorLog('info', 'final-buffer', 'Buffered transcript segment', source, {
            segments,
            chars: text.length
        });
        // Live update the persistent bubble for this source so it grows as
        // each sentence's final lands — instead of disappearing at
        // sentence_end and reappearing only when the 9s window flushes.
        transcriptionManager.setActiveAccumText(source, text);
    },
    onFlush: ({ source, text, reason, segments, emotion }) => {
        // Bubble already shows `text` from the preceding onBuffer call (or
        // the partial render). Just release the reference so the next
        // partial/final starts a fresh bubble; do NOT addChatMessage —
        // that would double the message.
        transcriptionManager.setActiveAccumText(source, text);
        transcriptionManager.commitActiveLive(source);

        if (source === 'system') {
            triggerInterviewerAnalysis(text, emotion);
        } else {
            pushInterviewerQuestion(text);
        }

        addMonitorLog('info', 'final-flush', 'Merged transcript committed', source, {
            reason,
            segments,
            chars: text.length
        });
        showFeedback('Captured', 'success');
    }
});


// DOM elements
const statusText = document.getElementById('status-text');
const screenshotCount = document.getElementById('screenshot-count');
const resultsPanel = document.getElementById('results-panel');
const resultText = document.getElementById('result-text');
const loadingOverlay = document.getElementById('loading-overlay');
const emergencyOverlay = document.getElementById('emergency-overlay');
const chatContainer = document.getElementById('chat-container');
const chatMessagesElement = document.getElementById('chat-messages');
const chatComposer = document.getElementById('chat-composer');
const chatManualInput = document.getElementById('chat-manual-input');
const chatManualSend = document.getElementById('chat-manual-send');
const chatAutoScrollToggle = document.getElementById('chat-autoscroll-toggle');

const AUTOSCROLL_STORAGE_KEY = 'open-cluely.autoScrollEnabled';
let autoScrollEnabledState = (() => {
    try {
        const raw = localStorage.getItem(AUTOSCROLL_STORAGE_KEY);
        if (raw === null) return true;
        return raw === '1';
    } catch (_) {
        return true;
    }
})();
function isAutoScrollEnabled() { return autoScrollEnabledState; }
function setAutoScrollEnabled(value) {
    autoScrollEnabledState = !!value;
    try { localStorage.setItem(AUTOSCROLL_STORAGE_KEY, autoScrollEnabledState ? '1' : '0'); } catch (_) {}
    paintAutoScrollToggle();
}
function paintAutoScrollToggle() {
    if (!chatAutoScrollToggle) return;
    const enabled = autoScrollEnabledState;
    chatAutoScrollToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    chatAutoScrollToggle.classList.toggle('off', !enabled);
    chatAutoScrollToggle.title = enabled ? 'Auto-scroll on (click to disable)' : 'Auto-scroll off (click to enable)';
}

const mobileServerPill = document.getElementById('mobile-server-pill');
const mobileServerPillLabel = document.getElementById('mobile-server-pill-label');
let mobileServerStatus = { listening: false, port: 7823, urls: [], clientCount: 0, error: null };

function paintMobileServerPill() {
    if (!mobileServerPill || !mobileServerPillLabel) return;

    mobileServerPill.classList.remove('off', 'idle', 'connected');

    if (!mobileServerStatus.listening) {
        mobileServerPill.classList.add('off');
        mobileServerPillLabel.textContent = mobileServerStatus.error ? 'Mobile · error' : 'Mobile · off';
        mobileServerPill.title = mobileServerStatus.error
            ? `Mobile companion not running: ${mobileServerStatus.error}`
            : 'Mobile companion not running';
        return;
    }

    const firstReal = mobileServerStatus.urls.find((u) => !u.virtual) || mobileServerStatus.urls[0];
    const firstUrl = firstReal?.url;
    const count = mobileServerStatus.clientCount || 0;
    mobileServerPill.classList.add(count > 0 ? 'connected' : 'idle');

    if (firstUrl) {
        mobileServerPillLabel.textContent = firstUrl.replace(/^http:\/\//, '') + (count > 0 ? ` · ${count}` : '');
    } else {
        mobileServerPillLabel.textContent = `:${mobileServerStatus.port}` + (count > 0 ? ` · ${count}` : ' · no LAN');
    }

    const lines = [
        count > 0
            ? `Mobile companion: ${count} client(s) connected`
            : 'Mobile companion listening (no clients yet — click for help)',
        ...mobileServerStatus.urls.map(({ url, name, virtual }) => virtual
            ? `${url}  (${name}) — virtual adapter, phone probably cannot reach this`
            : `${url}  (${name})`
        )
    ];
    if (mobileServerStatus.urls.length === 0) {
        lines.push('No non-loopback IPv4 interface detected.');
    }
    if (mobileServerStatus.urls.some((u) => u.virtual) && mobileServerStatus.urls.some((u) => !u.virtual)) {
        lines.push('Use the first non-virtual URL on the phone.');
    }
    lines.push('');
    lines.push('Click to copy URL. If the phone times out, run this once in elevated PowerShell:');
    lines.push('  New-NetFirewallRule -DisplayName "Open-Cluely Mobile" -Direction Inbound -LocalPort 7823 -Protocol TCP -Action Allow -Profile Any');
    mobileServerPill.title = lines.join('\n');
}

function copyMobileUrlPickReal() {
    return mobileServerStatus.urls.find((u) => !u.virtual)?.url || mobileServerStatus.urls[0]?.url;
}

async function copyMobileUrlToClipboard() {
    const url = copyMobileUrlPickReal();
    if (!url) {
        showFeedback('Mobile server has no LAN URL yet', 'error');
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        showFeedback(`Copied ${url}`, 'success');
    } catch (err) {
        showFeedback('Could not copy URL', 'error');
    }
}
const transcriptionToggle = document.getElementById('transcription-toggle');
const sourceSystemToggle = document.getElementById('source-system-toggle');
const sourceMicToggle = document.getElementById('source-mic-toggle');
const monitorMasterState = document.getElementById('monitor-master-state');
const monitorStatusSystem = document.getElementById('monitor-status-system');
const monitorStatusMic = document.getElementById('monitor-status-mic');
const monitorLiveSystem = document.getElementById('monitor-live-system');
const monitorLiveMic = document.getElementById('monitor-live-mic');
const monitorLogList = document.getElementById('monitor-log-list');
const windowResizeHandles = document.querySelectorAll('[data-resize-handle]');

const screenshotBtn = document.getElementById('screenshot-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const screenAiBtn = document.getElementById('screen-ai-btn');
const clearBtn = document.getElementById('clear-btn');
const hideBtn = document.getElementById('hide-btn');
const closeResultsBtn = document.getElementById('close-results');
const closeAppBtn = document.getElementById('close-app-btn');
const closeConfirmationDialog = document.getElementById('close-confirmation-dialog');
const cancelCloseBtn = document.getElementById('cancel-close-btn');
const confirmCloseBtn = document.getElementById('confirm-close-btn');

// New Cluely-style buttons
const suggestBtn = document.getElementById('suggest-btn');
const notesBtn = document.getElementById('notes-btn');
const insightsBtn = document.getElementById('insights-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// Settings elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingDashscopeAiModel = document.getElementById('setting-dashscope-ai-model');
const settingProgrammingLanguage = document.getElementById('setting-programming-language');
const settingAsrProvider = document.getElementById('setting-asr-provider');
const paraformerSettingsGroup = document.getElementById('paraformer-settings-group');
const xfyunSettingsGroup = document.getElementById('xfyun-settings-group');
const settingDashscopeKey = document.getElementById('setting-dashscope-key');
const toggleDashscopeKeyVisibilityBtn = document.getElementById('toggle-dashscope-key-visibility');
const settingXfyunAppId = document.getElementById('setting-xfyun-appid');
const settingXfyunKey = document.getElementById('setting-xfyun-key');
const toggleXfyunKeyVisibilityBtn = document.getElementById('toggle-xfyun-key-visibility');
const settingResumeText = document.getElementById('setting-resume-text');
const settingJobDescription = document.getElementById('setting-job-description');
const settingInterviewerMode = document.getElementById('setting-interviewer-mode');
const settingWindowOpacity = document.getElementById('setting-window-opacity');
const settingWindowOpacityValue = document.getElementById('setting-window-opacity-value');
const settingMicDevice = document.getElementById('setting-mic-device');
const settingSystemSource = document.getElementById('setting-system-source');
const refreshAudioDevicesBtn = document.getElementById('refresh-audio-devices-btn');
const openSoundSettingsBtn = document.getElementById('open-sound-settings-btn');
const settingsShortcutsList = document.getElementById('settings-shortcuts-list');

// More dropdown
const moreMenuBtn = document.getElementById('more-menu-btn');
const moreMenuPanel = document.getElementById('more-menu-panel');

// Collapsible monitor
const monitorContainer = document.getElementById('transcription-monitor');
const monitorToggleBtn = document.getElementById('monitor-toggle');
const monitorDetails = document.getElementById('monitor-details');

// Timer
let startTime = Date.now();
let timerInterval;
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 380;
const MAX_CHAT_INPUT_HEIGHT = 88;

let isCloseConfirmationOpen = false;
// Cached availability flags from get-settings IPC. AI capability is gated on
// the DashScope key. ASR capability is gated on either the DashScope key
// (Paraformer) or Xunfei credentials.
let hasAiConfigured = false;
let hasAsrConfigured = false;
const aiActionInFlightState = {
    askAi: false,
    screenAi: false,
    suggest: false,
    notes: false,
    insights: false
};
const shortcutManager = createShortcutManager({ settingsShortcutsList });
const windowAdjustmentManager = createWindowAdjustmentManager({
    windowResizeHandles,
    chatContainer,
    minWindowWidth: MIN_WINDOW_WIDTH,
    minWindowHeight: MIN_WINDOW_HEIGHT,
    onViewportResize: () => {
        autoResizeManualInput();
    }
});
const chatUiManager = createChatUiManager({
    chatContainer,
    chatMessagesElement,
    chatComposer,
    chatManualInput,
    chatManualSend,
    messageStore,
    maxChatInputHeight: MAX_CHAT_INPUT_HEIGHT,
    escapeHtml: (value) => escapeHtml(value),
    updateUi: () => updateUI(),
    onMessagesChanged: (messages) => {
        chatMessagesArray = messages;
    },
    showFeedback: (message, type) => showFeedback(message, type),
    addMonitorLog: (...args) => addMonitorLog(...args),
    isAutoScrollEnabled
});
const settingsPanelManager = createSettingsPanelManager({
    settingsPanel,
    settingDashscopeAiModel,
    settingProgrammingLanguage,
    settingAsrProvider,
    paraformerSettingsGroup,
    xfyunSettingsGroup,
    settingDashscopeKey,
    toggleDashscopeKeyVisibilityBtn,
    settingXfyunAppId,
    settingXfyunKey,
    toggleXfyunKeyVisibilityBtn,
    settingResumeText,
    settingJobDescription,
    settingInterviewerMode,
    settingWindowOpacity,
    settingWindowOpacityValue,
    settingMicDevice,
    settingSystemSource,
    refreshAudioDevicesBtn,
    openSoundSettingsBtn,
    applySettingsShortcutConfig: (settings) => applySettingsShortcutConfig(settings),
    showFeedback: (message, type) => showFeedback(message, type),
    onSettingsSaved: (settings) => {
        applyApiKeyAvailabilityFromSettings(settings);
        updateUI();
    }
});
const transcriptionManager = createTranscriptionManager({
    transcriptionSourceState,
    normalizeSourceRule: normalizeAssemblySource,
    sourceLabelRule: resolveSourceLabel,
    audioPipeline,
    transcriptBufferManager,
    chatMessagesElement,
    transcriptionToggle,
    sourceSystemToggle,
    sourceMicToggle,
    monitorMasterState,
    monitorStatusSystem,
    monitorStatusMic,
    monitorLiveSystem,
    monitorLiveMic,
    monitorLogList,
    addChatMessage: (type, content, options) => addChatMessage(type, content, options),
    updateChatMessageContent: (messageId, newContent) => chatUiManager.updateChatMessageContent(messageId, newContent),
    showFeedback: (message, type) => showFeedback(message, type),
    isAutoScrollEnabled,
    isChatNearBottom: () => chatUiManager.isChatNearBottom(),
    getSelectedMicDeviceId: () => readSelectedMicDeviceId(),
    getSelectedSystemSourceSelection: () => parseSystemSourceSelection(readSelectedSystemSourceValue())
});

function setupMoreMenu() {
    if (!moreMenuBtn || !moreMenuPanel) return;

    function closeMenu() {
        moreMenuPanel.classList.add('hidden');
        moreMenuBtn.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
        moreMenuPanel.classList.remove('hidden');
        moreMenuBtn.setAttribute('aria-expanded', 'true');
    }
    function toggleMenu() {
        if (moreMenuPanel.classList.contains('hidden')) {
            openMenu();
        } else {
            closeMenu();
        }
    }

    moreMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleMenu();
    });
    moreMenuPanel.addEventListener('click', (event) => {
        if (event.target.closest('.more-menu-item')) {
            closeMenu();
        }
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('#more-menu')) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenu();
    });
}

function setupMonitorToggle() {
    if (!monitorContainer || !monitorToggleBtn) return;
    monitorToggleBtn.addEventListener('click', () => {
        const collapsed = monitorContainer.classList.toggle('is-collapsed');
        monitorToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        if (monitorDetails) {
            monitorDetails.hidden = collapsed;
        }
    });
    if (monitorDetails) {
        monitorDetails.hidden = monitorContainer.classList.contains('is-collapsed');
    }
}

// Initialize
async function init() {
    console.log('Initializing renderer with Vosk Live Transcription...');

    if (typeof window.electronAPI !== 'undefined') {
        console.log('electronAPI is available');
    } else {
        console.error('electronAPI not available');
        showFeedback('electronAPI not available', 'error');
    }

    const settings = await loadShortcutConfig();
    setupEventListeners();
    setupIpcListeners();
    setupWindowAdjustments();
    if (chatAutoScrollToggle) {
        chatAutoScrollToggle.addEventListener('click', () => setAutoScrollEnabled(!autoScrollEnabledState));
        paintAutoScrollToggle();
    }
    if (window.electronAPI?.onClearFromMobile) {
        window.electronAPI.onClearFromMobile(() => {
            screenshotsCount = 0;
            messageStore.clear();
            chatMessagesArray = messageStore.getMessages();
            chatMessagesElement.innerHTML = '';
            updateUI();
            showFeedback('Cleared from mobile', 'info');
        });
    }
    if (mobileServerPill) {
        mobileServerPill.addEventListener('click', copyMobileUrlToClipboard);
        paintMobileServerPill();
        if (window.electronAPI?.onMobileServerStatus) {
            window.electronAPI.onMobileServerStatus((data) => {
                mobileServerStatus = { ...mobileServerStatus, ...(data || {}) };
                paintMobileServerPill();
            });
        }
        if (window.electronAPI?.getMobileServerStatus) {
            window.electronAPI.getMobileServerStatus().then((data) => {
                if (data && typeof data === 'object') {
                    mobileServerStatus = { ...mobileServerStatus, ...data };
                    paintMobileServerPill();
                }
            }).catch(() => {});
        }
    }
    setupMoreMenu();
    setupMonitorToggle();
    applyTheme(resolveInitialThemePreference(settings), { persist: false });
    updateUI();
    transcriptionManager.updateTranscriptionUI();
    transcriptionManager.renderMonitorState();
    startTimer();

    document.body.style.visibility = 'visible';
    document.body.style.display = 'block';
    const app = document.getElementById('app');
    if (app) {
        app.style.visibility = 'visible';
        app.style.display = 'flex';
    }

    console.log('Renderer initialized - Ready for live transcription!');
    showFeedback('Ready - click transcription to start', 'success');
    addMonitorLog('info', 'init', 'Renderer initialized');
    addMonitorLog('info', 'source-defaults', 'Default sources: Host on, Mic off');
}

function updateWindowOpacityValueLabel(value) {
    settingsPanelManager.updateWindowOpacityValueLabel(value);
}

function parseThemePreference(theme) {
    return theme === THEME_DARK || theme === THEME_LIGHT ? theme : null;
}

function normalizeTheme(theme) {
    return theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
}

function loadStoredThemePreference() {
    try {
        const savedTheme = window.localStorage?.getItem(THEME_STORAGE_KEY) || '';
        return parseThemePreference(savedTheme) || THEME_DARK;
    } catch (error) {
        console.warn('Failed to read saved theme preference:', error);
        return THEME_DARK;
    }
}

function resolveInitialThemePreference(settings) {
    const settingsTheme = parseThemePreference(String(settings?.themePreference || '').trim().toLowerCase());
    if (settingsTheme) {
        saveThemePreference(settingsTheme);
        return settingsTheme;
    }

    return loadStoredThemePreference();
}

function saveThemePreference(theme) {
    try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
    } catch (error) {
        console.warn('Failed to save theme preference:', error);
    }
}

function persistThemePreference(theme) {
    const normalizedTheme = normalizeTheme(theme);
    saveThemePreference(normalizedTheme);

    const setThemePreference = window.electronAPI?.setThemePreference;
    if (typeof setThemePreference === 'function') {
        setThemePreference(normalizedTheme).catch((error) => {
            console.warn('Failed to persist theme preference to app state:', error);
        });
    }
}

function updateThemeToggleUi() {
    if (!themeToggleBtn) {
        return;
    }

    const isDarkMode = activeTheme === THEME_DARK;
    const nextThemeLabel = isDarkMode ? 'light' : 'dark';
    const ariaLabel = `Switch to ${nextThemeLabel} mode`;

    themeToggleBtn.classList.toggle('is-dark', isDarkMode);
    themeToggleBtn.setAttribute('aria-pressed', isDarkMode ? 'true' : 'false');
    themeToggleBtn.setAttribute('aria-label', ariaLabel);
    themeToggleBtn.removeAttribute('title');
}

function applyTheme(theme, options = {}) {
    const { persist = true, announce = false } = options;
    activeTheme = normalizeTheme(theme);

    document.body.classList.toggle('theme-dark', activeTheme === THEME_DARK);
    document.documentElement.setAttribute('data-theme', activeTheme);
    updateThemeToggleUi();

    if (persist) {
        persistThemePreference(activeTheme);
    }

    if (announce) {
        showFeedback(activeTheme === THEME_DARK ? 'Dark mode enabled' : 'Light mode enabled', 'info');
    }
}

function toggleThemeMode() {
    const nextTheme = activeTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    applyTheme(nextTheme, { persist: true, announce: true });
}

function applySettingsShortcutConfig(settings) {
    shortcutManager.applySettingsShortcutConfig(settings);
}

function isShortcutPressed(event, shortcutId) {
    return shortcutManager.isShortcutPressed(event, shortcutId);
}

function isAiActionInFlight(actionId) {
    return Boolean(aiActionInFlightState[actionId]);
}

function setAiActionInFlight(actionId, inFlight) {
    if (!Object.prototype.hasOwnProperty.call(aiActionInFlightState, actionId)) {
        return;
    }

    const nextValue = Boolean(inFlight);
    if (aiActionInFlightState[actionId] === nextValue) {
        return;
    }

    aiActionInFlightState[actionId] = nextValue;
    updateUI();
}

async function runAiActionWithLock(actionId, action) {
    if (isAiActionInFlight(actionId)) {
        return false;
    }

    setAiActionInFlight(actionId, true);
    try {
        await action();
        return true;
    } finally {
        setAiActionInFlight(actionId, false);
    }
}

let activeScreenAiStream = null;

function createStreamHandler(actionId) {
    let accumulatedText = '';
    let messageRecord = null;
    let removeChunkListener = null;
    let loadingHidden = false;

    function start(headingPrefix) {
        accumulatedText = headingPrefix || '';
        messageRecord = addChatMessage('ai-response', accumulatedText || '...');

        removeChunkListener = window.electronAPI.onAiStreamChunk((data) => {
            if (data.actionId !== actionId) return;
            accumulatedText += data.text;
            if (messageRecord) {
                chatUiManager.updateChatMessageContent(messageRecord.id, accumulatedText);
            }
            if (!loadingHidden) {
                loadingHidden = true;
                hideLoadingOverlay();
            }
        });

        return messageRecord;
    }

    function finalize(finalText) {
        if (finalText && messageRecord) {
            chatUiManager.updateChatMessageContent(messageRecord.id, finalText);
        }
    }

    function cleanup() {
        if (removeChunkListener) {
            removeChunkListener();
            removeChunkListener = null;
        }
    }

    return { start, finalize, cleanup };
}

function applyApiKeyAvailabilityFromSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        hasAiConfigured = false;
        hasAsrConfigured = false;
        return;
    }

    if (typeof settings.hasDashscopeApiKey === 'boolean') {
        hasAiConfigured = settings.hasDashscopeApiKey;
    } else {
        hasAiConfigured = String(settings.dashscopeApiKey ?? '').trim().length > 0;
    }

    // Paraformer reuses the DashScope key; Xunfei needs its own pair.
    if (settings.asrProvider === 'xfyun') {
        hasAsrConfigured = settings.hasXfyunCredentials === true
            || (String(settings.xfyunAppId ?? '').trim().length > 0
                && String(settings.xfyunApiKey ?? '').trim().length > 0);
    } else {
        hasAsrConfigured = hasAiConfigured;
    }
}

async function loadShortcutConfig() {
    if (!window.electronAPI?.getSettings) {
        applyApiKeyAvailabilityFromSettings(null);
        return null;
    }

    try {
        const settings = await window.electronAPI.getSettings();
        applySettingsShortcutConfig(settings);
        applyApiKeyAvailabilityFromSettings(settings);
        return settings;
    } catch (error) {
        console.error('Failed to load shortcut config:', error);
        applyApiKeyAvailabilityFromSettings(null);
        return null;
    }
}

function setupWindowAdjustments() {
    windowAdjustmentManager.setupWindowAdjustments();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isMessageIncludedForAi(message) {
    return messageStore.isIncludedForAi(message);
}

function buildFilteredAiContextBundle({ charBudget = AI_CONTEXT_CHAR_BUDGET, emitTruncationLog = true } = {}) {
    return buildAiContextBundle({
        messages: chatMessagesArray,
        isMessageIncludedForAi,
        charBudget,
        emitTruncationLog,
        onTruncationLog: (dropped, budget) => {
            addMonitorLog(
                'info',
                'context-cap',
                `Trimmed ${dropped} older context message(s) to stay within ${budget} chars`
            );
        }
    });
}

function updateMessageAiToggleUi(message) {
    syncMessageAiToggleUi(chatMessagesElement, message);
}

function toggleChatMessageInclusion(messageId) {
    const message = messageStore.toggleInclusion(messageId);
    if (!message) return;

    chatMessagesArray = messageStore.getMessages();
    updateMessageAiToggleUi(message);
    updateUI();

    const stateText = message.includeInAi ? 'included in' : 'excluded from';
    addMonitorLog('info', 'ai-context-toggle', `Message ${stateText} AI context`, null, {
        id: message.id,
        type: message.type
    });
}

function addMonitorLog(level, event, message, source = null, meta = null, timestamp = Date.now()) {
    transcriptionManager.addMonitorLog(level, event, message, source, meta, timestamp);
}

function flushAllFinalTranscripts(reason = 'flush-all') {
    transcriptionManager.flushAllFinalTranscripts(reason);
}

function setSourceSelected(source, enabled) {
    return transcriptionManager.setSourceSelected(source, enabled);
}

async function toggleMasterTranscription() {
    if (!hasAsrConfigured) {
        showFeedback('Speech-recognition credentials missing. Add them in Settings.', 'error');
        return;
    }

    return transcriptionManager.toggleMasterTranscription();
}

// Screenshot functions
async function takeStealthScreenshot() {
    try {
        showFeedback('Taking screenshot...', 'info');
        await window.electronAPI.takeStealthScreenshot();
    } catch (error) {
        console.error('Screenshot error:', error);
        showFeedback('Screenshot failed', 'error');
    }
}

function buildAskAiContextPayload() {
    const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
    return {
        mode: 'best-next-answer',
        contextString: bundle.contextString,
        transcriptContext: bundle.transcriptContext,
        sessionSummary: bundle.sessionSummary,
        enabledScreenshotIds: bundle.enabledScreenshotIds,
        screenshotCount: bundle.enabledScreenshotIds.length
    };
}

async function askAiWithSessionContext() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI?.askAiWithSessionContext) {
        showFeedback('Feature not available', 'error');
        return;
    }

    const payload = buildAskAiContextPayload();
    if (!payload.contextString && payload.enabledScreenshotIds.length === 0) {
        showFeedback('No transcript or screenshots available yet', 'error');
        return;
    }

    await runAiActionWithLock('askAi', async () => {
        const stream = createStreamHandler('askAi');
        try {
            setAnalyzing(true);
            showLoadingOverlay('Analyzing full session context...');
            stream.start('**Best Next Answer:**\n\n');

            const result = await window.electronAPI.askAiWithSessionContext(payload);

            if (result?.success && result?.text) {
                const heading = result.usedScreenshots
                    ? '**Best Next Answer (Transcript + Screen):**'
                    : '**Best Next Answer (Transcript):**';
                stream.finalize(`${heading}\n\n${result.text}`);
                showFeedback('Ask AI ready', 'success');
            } else {
                throw new Error(result?.error || 'Ask AI failed');
            }
        } catch (error) {
            console.error('Ask AI error:', error);
            showFeedback('Ask AI failed', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
            hideLoadingOverlay();
        }
    });
}

async function analyzeScreenshotsOnly() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API key missing. Add it in Settings.', 'error');
        return;
    }

    const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
    if (bundle.enabledScreenshotIds.length === 0) {
        showFeedback('No enabled screenshots to analyze', 'error');
        return;
    }

    await runAiActionWithLock('screenAi', async () => {
        const stream = createStreamHandler('screenAi');
        activeScreenAiStream = stream;
        try {
            setAnalyzing(true);
            showLoadingOverlay('Analyzing screenshots...');
            stream.start('');

            await window.electronAPI.analyzeStealthWithContext({
                contextString: bundle.contextString,
                enabledScreenshotIds: bundle.enabledScreenshotIds
            });
        } catch (error) {
            console.error('Analysis error:', error);
            showFeedback('Analysis failed', 'error');
            setAnalyzing(false);
            hideLoadingOverlay();
            // Clean up on error since onAnalysisResult may not fire
            stream.cleanup();
            activeScreenAiStream = null;
        }
        // Don't cleanup in finally - onAnalysisResult handles it for success path
        // This avoids a race where the invoke resolves before the event is delivered
    });
}

async function clearStealthData() {
    try {
        await window.electronAPI.clearStealth();
        if (window.electronAPI.clearConversationHistory) {
            await window.electronAPI.clearConversationHistory();
        }
        screenshotsCount = 0;
        messageStore.clear();
        chatMessagesArray = messageStore.getMessages();
        chatMessagesElement.innerHTML = '';
        updateUI();
        showFeedback('Cleared', 'success');
    } catch (error) {
        console.error('Clear error:', error);
        showFeedback('Clear failed', 'error');
    }
}

async function emergencyHide() {
    try {
        await window.electronAPI.emergencyHide();
        showEmergencyOverlay();
    } catch (error) {
        console.error('Emergency hide error:', error);
    }
}

function openCloseConfirmation() {
    if (!closeConfirmationDialog) {
        closeApplication();
        return;
    }

    isCloseConfirmationOpen = true;
    closeConfirmationDialog.classList.remove('hidden');
    confirmCloseBtn?.focus();
}

function closeCloseConfirmation() {
    if (!closeConfirmationDialog) {
        return;
    }

    isCloseConfirmationOpen = false;
    closeConfirmationDialog.classList.add('hidden');
    closeAppBtn?.focus();
}

async function closeApplication() {
    try {
        console.log('Closing application...');
        flushAllFinalTranscripts('app-close');
        await window.electronAPI.closeApp();
    } catch (error) {
        console.error('Close application error:', error);
    }
}

// NEW CLUELY-STYLE FEATURES

async function getResponseSuggestions() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.suggestResponse) {
        showFeedback('Feature not available', 'error');
        return;
    }

    await runAiActionWithLock('suggest', async () => {
        const stream = createStreamHandler('suggest');
        try {
            showFeedback('Generating suggestions...', 'info');
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            const transcriptOnlyContext = String(bundle.transcriptContext || '').trim();
            if (!transcriptOnlyContext) {
                showFeedback('No enabled transcript context available for suggestions', 'error');
                return;
            }

            stream.start('\u{1F4A1} **What should I say?**\n\n');

            const result = await window.electronAPI.suggestResponse({
                context: bundle.sessionSummary || 'Current meeting conversation',
                contextString: transcriptOnlyContext
            });

            if (result.success && result.suggestions) {
                stream.finalize(`\u{1F4A1} **What should I say?**\n\n${result.suggestions}`);
                showFeedback('Suggestions generated', 'success');
            } else {
                throw new Error(result.error || 'Failed to generate suggestions');
            }
        } catch (error) {
            console.error('Error getting suggestions:', error);
            showFeedback('Failed to generate suggestions', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
        }
    });
}

async function generateMeetingNotes() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.generateMeetingNotes) {
        showFeedback('Feature not available', 'error');
        return;
    }

    await runAiActionWithLock('notes', async () => {
        const stream = createStreamHandler('notes');
        try {
            showFeedback('Generating meeting notes...', 'info');
            setAnalyzing(true);
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            if (!bundle.contextString) {
                showFeedback('No enabled context available for notes', 'error');
                return;
            }

            stream.start('\u{1F4DD} **Meeting Notes**\n\n');

            const result = await window.electronAPI.generateMeetingNotes({
                contextString: bundle.contextString
            });

            if (result.success && result.notes) {
                stream.finalize(`\u{1F4DD} **Meeting Notes**\n\n${result.notes}`);
                showFeedback('Meeting notes generated', 'success');
            } else {
                throw new Error(result.error || 'Failed to generate notes');
            }
        } catch (error) {
            console.error('Error generating notes:', error);
            showFeedback('Failed to generate notes', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
        }
    });
}

async function getConversationInsights() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.getConversationInsights) {
        showFeedback('Feature not available', 'error');
        return;
    }

    await runAiActionWithLock('insights', async () => {
        const stream = createStreamHandler('insights');
        try {
            showFeedback('Analyzing conversation...', 'info');
            setAnalyzing(true);
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            if (!bundle.contextString) {
                showFeedback('No enabled context available for insights', 'error');
                return;
            }

            stream.start('\u{1F4CA} **Conversation Insights**\n\n');

            const result = await window.electronAPI.getConversationInsights({
                contextString: bundle.contextString
            });

            if (result.success && result.insights) {
                stream.finalize(`\u{1F4CA} **Conversation Insights**\n\n${result.insights}`);
                showFeedback('Insights generated', 'success');
            } else {
                throw new Error(result.error || 'Failed to get insights');
            }
        } catch (error) {
            console.error('Error getting insights:', error);
            showFeedback('Failed to get insights', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
        }
    });
}

// SETTINGS FUNCTIONS

async function openSettings() {
    await settingsPanelManager.openSettings();
}

function closeSettings() {
    settingsPanelManager.closeSettings();
}

async function saveSettings() {
    const result = await settingsPanelManager.saveSettings();
    if (result?.success && result?.settings) {
        applyApiKeyAvailabilityFromSettings(result.settings);
        updateUI();
    }
}

// UI Helper functions
function setAnalyzing(analyzing) {
    isAnalyzing = analyzing;
    updateUI();
}

function updateUI() {
    if (screenshotCount) {
        screenshotCount.textContent = screenshotsCount;
    }

    const aiBundle = buildFilteredAiContextBundle({
        charBudget: AI_CONTEXT_CHAR_BUDGET,
        emitTruncationLog: false
    });
    const hasTranscriptContext = aiBundle.transcriptContext.length > 0;
    const hasEnabledScreenshots = aiBundle.enabledScreenshotIds.length > 0;
    const hasAiContext = hasTranscriptContext || hasEnabledScreenshots || aiBundle.contextString.length > 0;
    const canRunAiActions = hasAiConfigured;
    const canRunTranscription = hasAsrConfigured;
    const askAiInFlight = isAiActionInFlight('askAi');
    const screenAiInFlight = isAiActionInFlight('screenAi');
    const suggestInFlight = isAiActionInFlight('suggest');
    const notesInFlight = isAiActionInFlight('notes');
    const insightsInFlight = isAiActionInFlight('insights');

    if (analyzeBtn) {
        analyzeBtn.disabled = isAnalyzing || askAiInFlight || !canRunAiActions || !hasAiContext;
    }

    if (screenAiBtn) {
        screenAiBtn.disabled = isAnalyzing || screenAiInFlight || !canRunAiActions || !hasEnabledScreenshots;
    }

    if (suggestBtn) {
        suggestBtn.disabled = isAnalyzing || suggestInFlight || !canRunAiActions || !hasTranscriptContext;
    }

    if (notesBtn) {
        notesBtn.disabled = isAnalyzing || notesInFlight || !canRunAiActions || !hasAiContext;
    }

    if (insightsBtn) {
        insightsBtn.disabled = isAnalyzing || insightsInFlight || !canRunAiActions || !hasAiContext;
    }

    if (transcriptionToggle) {
        transcriptionToggle.disabled = !canRunTranscription;
    }

    if (sourceSystemToggle) {
        sourceSystemToggle.disabled = !canRunTranscription;
    }

    if (sourceMicToggle) {
        sourceMicToggle.disabled = !canRunTranscription;
    }
}

function showFeedback(message, type = 'info') {
    console.log(`Feedback (${type}):`, message);

    if (statusText) {
        statusText.textContent = message;
        statusText.className = `status-text ${type} show`;
        statusText.style.display = 'block';

        setTimeout(() => {
            statusText.classList.remove('show');
            setTimeout(() => {
                statusText.style.display = 'none';
            }, 300);
        }, 3000);
    }
}

function showLoadingOverlay(message = 'Analyzing screen...') {
    if (loadingOverlay) {
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            // textContent (not innerHTML) — message can originate from AI/error strings
            loadingTextElement.textContent = message;
        }
        loadingOverlay.classList.remove('hidden');
    }
}

function hideLoadingOverlay() {
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.textContent = 'Analyzing screen...';
        }
    }
}

function showEmergencyOverlay() {
    if (emergencyOverlay) {
        emergencyOverlay.classList.remove('hidden');
        setTimeout(() => {
            emergencyOverlay.classList.add('hidden');
        }, 2000);
    }
}

function hideResults() {
    if (resultsPanel) {
        resultsPanel.classList.add('hidden');
    }
}

async function writeTextToClipboard(text) {
    const value = String(text ?? '');

    if (navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch (error) {
            console.warn('Clipboard API denied, using fallback copy path:', error);
        }
    }

    const copyListener = (event) => {
        event.preventDefault();
        if (event.clipboardData) {
            event.clipboardData.setData('text/plain', value);
        }
    };

    document.addEventListener('copy', copyListener, true);
    try {
        const copiedViaEvent = document.execCommand('copy');
        if (copiedViaEvent) {
            return;
        }
    } finally {
        document.removeEventListener('copy', copyListener, true);
    }

    const temporaryInput = document.createElement('textarea');
    temporaryInput.value = value;
    temporaryInput.setAttribute('readonly', '');
    temporaryInput.style.position = 'fixed';
    temporaryInput.style.left = '-9999px';
    temporaryInput.style.top = '0';
    document.body.appendChild(temporaryInput);
    temporaryInput.select();

    const copiedViaSelection = document.execCommand('copy');
    document.body.removeChild(temporaryInput);

    if (!copiedViaSelection) {
        throw new Error('Clipboard write failed');
    }
}

async function copyChatMessageById(messageId) {
    const message = messageStore.findById(messageId);
    const content = String(message?.content || '');

    if (!content.trim()) {
        showFeedback('Nothing to copy', 'error');
        return;
    }

    try {
        await writeTextToClipboard(content);
        showFeedback('Message copied', 'success');
    } catch (error) {
        console.error('Message copy error:', error);
        showFeedback('Copy failed', 'error');
    }
}

// Chat message management
function addChatMessage(type, content, options = {}) {
    return chatUiManager.addChatMessage(type, content, options);
}

function autoResizeManualInput() {
    chatUiManager.autoResizeManualInput();
}

function updateManualComposerState() {
    chatUiManager.updateManualComposerState();
}

function submitManualContextMessage() {
    chatUiManager.submitManualContextMessage();
}

// Timer
function startTimer() {
    const timerElement = document.querySelector('.timer');
    if (!timerElement) return;

    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        timerElement.textContent = `${minutes}:${seconds}`;
    }, 1000);
}

// Event listeners
function setupEventListeners() {
    setupEventListenersModule({
        windowApi: window.electronAPI,
        screenshotBtn,
        analyzeBtn,
        screenAiBtn,
        clearBtn,
        hideBtn,
        chatManualSend,
        chatManualInput,
        closeResultsBtn,
        transcriptionToggle,
        sourceSystemToggle,
        sourceMicToggle,
        closeAppBtn,
        cancelCloseBtn,
        confirmCloseBtn,
        closeConfirmationDialog,
        chatMessagesElement,
        suggestBtn,
        notesBtn,
        insightsBtn,
        themeToggleBtn,
        settingsBtn,
        closeSettingsBtn,
        saveSettingsBtn,
        settingWindowOpacity,
        selectedSources,
        isCloseConfirmationOpen: () => isCloseConfirmationOpen,
        isShortcutPressed,
        updateWindowOpacityValueLabel,
        takeStealthScreenshot,
        askAiWithSessionContext,
        analyzeScreenshotsOnly,
        clearStealthData,
        emergencyHide,
        copyChatMessageById,
        submitManualContextMessage,
        autoResizeManualInput,
        updateManualComposerState,
        hideResults,
        toggleMasterTranscription,
        addMonitorLog,
        setSourceSelected,
        openCloseConfirmation,
        closeCloseConfirmation,
        closeApplication,
        toggleChatMessageInclusion,
        getResponseSuggestions,
        generateMeetingNotes,
        getConversationInsights,
        toggleThemeMode,
        openSettings,
        closeSettings,
        saveSettings
    });
}

// IPC listeners
function setupIpcListeners() {
    setupIpcListenersModule({
        windowApi: window.electronAPI,
        setScreenshotsCount: (nextCount) => {
            screenshotsCount = nextCount;
        },
        updateUi: updateUI,
        addChatMessage,
        setAnalyzing,
        showLoadingOverlay,
        hideLoadingOverlay,
        showFeedback,
        showEmergencyOverlay,
        transcriptionManager,
        toggleMasterTranscription,
        askAiWithSessionContext,
        isAskAiShortcutEnabled: () => Boolean(analyzeBtn && !analyzeBtn.disabled),
        addMonitorLog,
        getActiveScreenAiStream: () => activeScreenAiStream,
        clearActiveScreenAiStream: () => {
            if (activeScreenAiStream) {
                activeScreenAiStream.cleanup();
                activeScreenAiStream = null;
            }
        }
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}





