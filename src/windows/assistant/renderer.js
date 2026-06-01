/// <reference path="./renderer-globals.d.ts" />

import { createMessageStore } from './renderer/features/ai-context/message-store.js';
import { buildFilteredAiContextBundle as buildAiContextBundle } from './renderer/features/ai-context/context-bundle.js';
import { updateMessageAiToggleUi as syncMessageAiToggleUi } from './renderer/features/ai-context/toggle-ui.js';
import { createChatUiManager } from './renderer/features/chat/chat-ui-manager.js';
import { createProgressCard } from './renderer/features/chat/progress-card.js';
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

import { createHistorySidebar } from './renderer/features/history/history-sidebar.js';
import { createChannelControls } from './renderer/features/audio/channel-control.js';
import { createResumeDropzone } from './renderer/features/resume/resume-dropzone.js';
import { createSessionContextPanel } from './renderer/features/context/session-context.js';
import { createResumeChat } from './renderer/features/resume/resume-chat.js';

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

// ── Session persistence helpers ────────────────────────────────────────────
// Lazily materialize an interview session the first time real activity happens
// (a finalized transcript line or an AI follow-up), instead of creating an
// empty record on boot. Returns the active session id, or null if creation
// failed — callers must tolerate null and skip persistence rather than throw.
async function ensureActiveSession() {
    if (activeSessionId) return activeSessionId;
    if (!window.electronAPI?.createSession) return null;
    try {
        const title = `Interview · ${new Date().toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })}`;
        const result = await window.electronAPI.createSession({ title, mode: interviewerMode, interviewType: activeInterviewType });
        const session = result?.session;
        if (!result?.success || !session) return null;
        activeSessionId = session.id;
        setSessionTitle(session.title);
        // Keep the live format aligned with the persisted record (no-ops when it
        // already matches the active type).
        applyInterviewType(session.interviewType === 'offline' ? 'offline' : 'online');
        sessionContextPanel?.update(session.interviewerSessionState || null);
        await historySidebar?.refresh();
        historySidebar?.setActive(activeSessionId);
        addMonitorLog('info', 'session-auto', 'Started interview session on first activity', null, {
            id: activeSessionId,
            mode: interviewerMode,
            interviewType: session.interviewType || activeInterviewType
        });
        return activeSessionId;
    } catch (error) {
        console.error('ensureActiveSession failed:', error);
        return null;
    }
}

// Append one finalized transcript line to the active session. system→candidate
// (the person being interviewed, teal lane); mic→interviewer (the user asking,
// amber lane). No-ops during replay so loading a past interview never re-writes
// its own transcript; swallows persistence errors so the live UI is unaffected.
async function persistTranscriptLine(source, text) {
    if (isReplayingSession) return;
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    try {
        const id = await ensureActiveSession();
        if (!id) return;
        await window.electronAPI?.appendToSession?.(id, {
            role: source === 'system' ? 'candidate' : 'interviewer',
            source,
            kind: 'transcript',
            text: trimmed,
            ts: Date.now()
        });
    } catch (error) {
        console.error('persistTranscriptLine failed:', error);
    }
}

// Append one AI follow-up / coach card to the active session as a coach
// question record so it round-trips through renderQuestionCard() on reload.
// Same replay guard + error-swallowing contract as persistTranscriptLine.
async function persistCoachQuestion(text) {
    if (isReplayingSession) return;
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    try {
        const id = await ensureActiveSession();
        if (!id) return;
        await window.electronAPI?.appendToSession?.(id, {
            role: 'coach',
            kind: 'question',
            text: trimmed,
            ts: Date.now()
        });
    } catch (error) {
        console.error('persistCoachQuestion failed:', error);
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
    // Persist the rendered coach card so it round-trips on session reload.
    // Fire-and-forget: persistence must never block or break the live render.
    persistCoachQuestion(body);
}

// Render an Expert-chain follow-up (Block G output): the primary question as a
// question card (with the anchor quote it drills into), plus a compact coach
// line carrying the interviewer rationale + the alternative phrasing.
function renderExpertFollowUp(output, tokensUsed = null, elapsedMs = null) {
    const primary = String(output?.primary_question || '').trim();
    if (!primary) return;

    const anchor = Array.isArray(output?.anchor_quotes) && output.anchor_quotes.length
        ? String(output.anchor_quotes[0] || '').trim()
        : '';
    chatUiManager.renderQuestionCard({ question: primary, anchor });

    const rationale = String(output?.rationale_for_interviewer || '').trim();
    const alternative = String(output?.alternative_question || '').trim();
    const extra = [];
    if (alternative) extra.push(`**备选追问** ${alternative}`);
    if (rationale) extra.push(`*${rationale}*`);
    // Cost line: elapsed time + total token spend for this follow-up, shown muted.
    const costBits = [];
    if (Number(elapsedMs) > 0) costBits.push(`⏱ 耗时 ${(Number(elapsedMs) / 1000).toFixed(1)}s`);
    if (tokensUsed && Number(tokensUsed.total) > 0) {
        const t = tokensUsed;
        costBits.push(`🪙 ${Number(t.total).toLocaleString()} tokens（输入 ${Number(t.input).toLocaleString()} · 输出 ${Number(t.output).toLocaleString()}）`);
    }
    if (costBits.length) extra.push(`*${costBits.join(' · ')}*`);
    if (extra.length) {
        const body = extra.join('\n');
        addChatMessage('interviewer-coach', body);
        persistCoachQuestion(body);
    }
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
    interviewerRequestSeq += 1;
    const requestId = String(interviewerRequestSeq);
    interviewerProgressCard.start({ requestId });
    try {
        const response = await window.electronAPI.interviewerAnalyzeAnswer({
            candidateAnswer,
            emotion,
            requestId,
            questionHistory: interviewerQuestionHistory.slice()
        });
        if (!response || response.success === false) {
            interviewerProgressCard.fail(requestId);
            if (response?.error) {
                addMonitorLog('warn', 'interviewer', response.error, 'system');
            }
            return;
        }
        if (response.skipped) {
            interviewerProgressCard.fail(requestId);
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

        interviewerProgressCard.finish(requestId);

        if (response.mode === 'expert') {
            if (response.shouldShowFollowUps) {
                renderExpertFollowUp(response.output, response.tokensUsed, response.elapsedMs);
            } else {
                addMonitorLog('info', 'interviewer', 'Expert chain produced no high-confidence follow-up', 'system');
            }
        } else if (response.shouldShowFollowUps && response.stage2?.parsed) {
            renderInterviewerCoachMessage(response.stage2.parsed, response.stage1?.parsed);
        } else {
            addMonitorLog('info', 'interviewer', `Stage1 score ${response.stage1?.parsed?.score ?? '?'} — no follow-up emitted`, 'system');
        }
    } catch (err) {
        interviewerProgressCard.fail(requestId);
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

// Walk the live transcript (message store) backwards for the most recent
// candidate line. In ONLINE interviews the candidate is the computer-audio
// (system) channel → 'voice-system' chat messages. In OFFLINE interviews there
// is no system channel; the candidate speaks into the shared room mic, so the
// candidate answer comes from the 'voice-mic' channel instead. Reading from the
// durable message store (not the transient accumulator) survives the
// buffer/activeLive reset that happens on each flush.
function getLatestCandidateTranscript() {
    const candidateMessageType = activeInterviewType === 'offline' ? 'voice-mic' : 'voice-system';
    for (let i = chatMessagesArray.length - 1; i >= 0; i -= 1) {
        const message = chatMessagesArray[i];
        if (message?.type === candidateMessageType) {
            const text = String(message.content || '').trim();
            if (text) return text;
        }
    }
    return '';
}

// Manual "Generate Q" button: generate a follow-up question for the interviewer
// from the CURRENT candidate context on demand, instead of waiting for the
// candidate-final auto-trigger. Reuses the exact same analysis path as the
// auto-trigger (triggerInterviewerAnalysis) so Fast/Expert mode, session-state,
// coalescing, and coach-card rendering all behave identically. The local
// `generateQuestionInFlight` guard only debounces this button; the analysis
// pipeline's own `interviewerAnalysisInFlight` still coalesces concurrent work.
let generateQuestionInFlight = false;
async function handleGenerateQuestionClick() {
    if (generateQuestionInFlight) return;

    // Mirror the other AI actions: bail with feedback if AI isn't configured.
    if (!hasAiConfigured) {
        showFeedback('DashScope API key missing. Add it in Settings.', 'error');
        return;
    }

    const candidateAnswer = getLatestCandidateTranscript();
    if (!candidateAnswer) {
        showFeedback('No candidate answer yet to generate a question from', 'info');
        return;
    }

    generateQuestionInFlight = true;
    const originalLabel = generateQuestionBtn ? generateQuestionBtn.textContent : '';
    if (generateQuestionBtn) {
        generateQuestionBtn.disabled = true;
        generateQuestionBtn.textContent = 'Generating…';
    }
    try {
        // Same path the candidate-final onFlush auto-trigger uses. No emotion is
        // available for a manual trigger, so pass null (the analysis treats it
        // as optional). Do NOT duplicate the analysis logic here.
        await triggerInterviewerAnalysis(candidateAnswer, null);
    } catch (error) {
        console.error('Generate question failed:', error);
        showFeedback('Could not generate a question', 'error');
    } finally {
        generateQuestionInFlight = false;
        if (generateQuestionBtn) {
            generateQuestionBtn.disabled = false;
            generateQuestionBtn.textContent = originalLabel || 'Generate Q';
        }
    }
}

// Dev convenience: seed a short sample interview so Generate Q can be tested
// immediately without a live transcript. Idempotent — only seeds when the chat
// is empty. Flip SEED_SAMPLE_INTERVIEW to false to disable.
const SEED_SAMPLE_INTERVIEW = true;
function seedSampleInterview() {
    if (!chatMessagesElement) return;
    if (chatMessagesArray.length > 0) return; // don't clobber a real session
    // Candidate lane depends on interview type: online → computer-audio
    // ('voice-system' / Candidate), offline → shared room mic ('voice-mic').
    const candidateType = activeInterviewType === 'offline' ? 'voice-mic' : 'voice-system';
    const turns = [
        { type: 'voice-mic', text: 'Tell me about a recent project where you owned the technical design.' },
        { type: candidateType, text: 'Sure. I led the migration of our payments service from a monolith to microservices. We had reliability issues during peak traffic, so I redesigned the order pipeline and introduced an async queue. After the rollout, p99 latency dropped a lot and the on-call pages basically stopped.' }
    ];
    for (const t of turns) {
        chatUiManager.addChatMessage(t.type, t.text);
        if (t.type === 'voice-mic') pushInterviewerQuestion(t.text);
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

        // Route finals to the interviewer coach depending on the interview
        // format. ONLINE: the candidate is the computer-audio (system) channel,
        // so system finals drive follow-ups and mic finals (the interviewer's
        // own questions) just feed the question history. OFFLINE: there is no
        // system channel — the room mic carries the whole conversation, so mic
        // finals drive follow-ups instead. Online behavior is unchanged.
        if (activeInterviewType === 'offline') {
            if (source === 'mic') {
                triggerInterviewerAnalysis(text, emotion);
            } else {
                pushInterviewerQuestion(text);
            }
        } else if (source === 'system') {
            triggerInterviewerAnalysis(text, emotion);
        } else {
            pushInterviewerQuestion(text);
        }

        // Persist this finalized line into the active interview record (lazily
        // creating the session on first activity). Fire-and-forget so the live
        // transcript/analysis path above is never blocked by disk I/O.
        persistTranscriptLine(source, text);

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
// The old absolutely-positioned #chat-container overlay is gone — the chat now
// lives in CSS-Grid rows in #main, so the composer can never overlap the
// transcript and the legacy --chat-composer-height offset is unnecessary. Both
// the chat-ui-manager and window-adjustment manager null-guard this ref.
const chatContainer = null;
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
// The legacy master/per-source transcription toggle trio was replaced by the
// dual channel-control boxes in the composer (each box drives its own source
// via transcriptionManager.ensureSourceRunning). These refs stay null so the
// transcription-manager / event-listeners null-guards no-op; channel toggles
// and the global keyboard shortcut still drive capture.
const transcriptionToggle = null;
const sourceSystemToggle = null;
const sourceMicToggle = null;
const monitorMasterState = document.getElementById('monitor-master-state');
const monitorStatusSystem = document.getElementById('monitor-status-system');
const monitorStatusMic = document.getElementById('monitor-status-mic');
const monitorLiveSystem = document.getElementById('monitor-live-system');
const monitorLiveMic = document.getElementById('monitor-live-mic');
const monitorLogList = document.getElementById('monitor-log-list');
// Frameless window has no custom resize handles (real OS-resizable window now);
// the window-adjustment manager simply gets an empty NodeList and no-ops.
const windowResizeHandles = document.querySelectorAll('[data-resize-handle]');

const screenshotBtn = document.getElementById('screenshot-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const screenAiBtn = document.getElementById('screen-ai-btn');
const generateQuestionBtn = document.getElementById('generate-question-btn');
const clearBtn = document.getElementById('clear-btn');
// Emergency-hide is shortcut-only now (no dedicated topbar button); the
// event-listeners null-guard skips the click binding.
const hideBtn = null;
const closeResultsBtn = document.getElementById('close-results');
// Close lives in the title bar (#btn-close); confirmation dialog unchanged.
const closeAppBtn = document.getElementById('btn-close');
const closeConfirmationDialog = document.getElementById('close-confirmation-dialog');
const cancelCloseBtn = document.getElementById('cancel-close-btn');
const confirmCloseBtn = document.getElementById('confirm-close-btn');

// Title-bar controls
const stealthBtn = document.getElementById('btn-stealth');
const minimizeBtn = document.getElementById('btn-min');

// Sidebar (history)
const sessionListEl = document.getElementById('session-list');
const newInterviewBtn = document.getElementById('btn-new-interview');

// New-interview type picker (online vs offline)
const interviewTypeModal = document.getElementById('interview-type-modal');
const interviewTypeCloseBtn = document.getElementById('interview-type-close');

// Composer channel-control roots
const channelComputerEl = document.getElementById('channel-computer');
const channelMicEl = document.getElementById('channel-mic');

// Right rail
const resumeDropzoneEl = document.getElementById('resume-dropzone');
const resumeChatEl = document.getElementById('resume-chat');
const jobDescriptionInput = document.getElementById('jd-input');
const sessionContextEl = document.getElementById('session-context');

// Topbar live indicators
const sessionTitleEl = document.getElementById('session-title');
const modeIndicatorEl = document.getElementById('mode-indicator');
const modeIndicatorLabel = document.getElementById('mode-indicator-label');
const recIndicatorEl = document.getElementById('rec-indicator');
const recIndicatorLabel = document.getElementById('rec-indicator-label');

// New Cluely-style buttons
const suggestBtn = document.getElementById('suggest-btn');
const notesBtn = document.getElementById('notes-btn');
const insightsBtn = document.getElementById('insights-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// Settings elements
const settingsBtn = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
// Auto-save: no manual Save button in the new settings surface.
const saveSettingsBtn = null;
const settingsStatusIndicator = document.getElementById('settings-status');
const settingThemeToggle = document.getElementById('setting-theme-toggle');
const settingStealthToggle = document.getElementById('setting-stealth-toggle');
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
const settingVolcAppId = document.getElementById('setting-volc-appid');
const settingVolcAccessToken = document.getElementById('setting-volc-access-token');
const toggleVolcAccessTokenVisibilityBtn = document.getElementById('toggle-volc-access-token-visibility');
const settingVolcResourceId = document.getElementById('setting-volc-resource-id');
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

// New chat-app components (instantiated in init()).
let historySidebar = null;
let channelControls = null;
let resumeDropzone = null;
let resumeChat = null;
let sessionContextPanel = null;

// Active interview session + current interviewer mode (fast | expert). The mode
// drives both the topbar indicator and the mode stamped on new sessions.
let activeSessionId = null;
let interviewerMode = 'fast';
// Active interview FORMAT (online | offline). Online = dual-channel (computer
// audio = candidate + mic = you). Offline = in-person, ONE room microphone
// (the mic channel). Drives body.offline-mode (hides the computer-audio box via
// interview-type.css) and the offline question-gen routing (mic finals feed the
// interviewer coach instead of system finals). Set on session create + load.
let activeInterviewType = 'online';
// True only while renderSessionMessages() replays a loaded session's persisted
// messages back into the transcript. The transcript/coach persistence helpers
// early-return when this is set so replaying a past interview never re-appends
// its own messages back into the record (double-write guard).
let isReplayingSession = false;

// Timer
let startTime = Date.now();
let timerInterval;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 640;
const MAX_CHAT_INPUT_HEIGHT = 160;
const REC_INDICATOR_POLL_MS = 300;

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
// Chat-stream progress card for the interviewer Expert follow-up chain. The
// requestId sequence correlates progress events + the final result to the card
// that started a given analysis (analysis is coalesced, but a late event from a
// prior run must not move a freshly-started card).
const interviewerProgressCard = createProgressCard({
    chatMessagesElement,
    isAutoScrollEnabled
});
let interviewerRequestSeq = 0;
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
    settingVolcAppId,
    settingVolcAccessToken,
    toggleVolcAccessTokenVisibilityBtn,
    settingVolcResourceId,
    settingResumeText,
    settingJobDescription,
    settingInterviewerMode,
    settingWindowOpacity,
    settingWindowOpacityValue,
    settingMicDevice,
    settingSystemSource,
    refreshAudioDevicesBtn,
    openSoundSettingsBtn,
    // New auto-save deps: status pip + theme/stealth controls. Theme persists
    // through onThemeChange (set-theme-preference IPC), stealth through
    // setStealth (toggle-stealth IPC) — neither rides save-settings.
    settingsStatusIndicator,
    settingTheme: settingThemeToggle,
    settingStealthToggle,
    onThemeChange: (theme) => applyTheme(theme, { persist: true }),
    setStealth: () => window.electronAPI?.toggleStealth?.(),
    applySettingsShortcutConfig: (settings) => applySettingsShortcutConfig(settings),
    showFeedback: (message, type) => showFeedback(message, type),
    onSettingsSaved: (settings) => {
        applyApiKeyAvailabilityFromSettings(settings);
        applyInterviewerModeFromSettings(settings);
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

// ── Title-bar window controls ──────────────────────────────────────────────
function setupTitleBarControls() {
    if (stealthBtn) {
        stealthBtn.addEventListener('click', () => {
            // toggle-stealth is a flip; the .stealth-on class is synced from the
            // authoritative onSetStealthMode IPC echo (see setupIpcListeners),
            // but we optimistically flip here for immediate feedback.
            const next = !document.body.classList.contains('stealth-on');
            applyStealthVisualState(next);
            window.electronAPI?.toggleStealth?.();
        });
    }
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            // Optional-chained: main may not expose minimizeWindow yet (see
            // report — orchestrator must add a `window-minimize` IPC for this).
            window.electronAPI?.minimizeWindow?.();
        });
    }
    // Authoritative stealth echo from main (set-stealth-mode). This is an
    // additive subscription — the ipc-listeners module also listens on the same
    // channel for its toast; both handlers fire independently.
    if (window.electronAPI?.onSetStealthMode) {
        window.electronAPI.onSetStealthMode((enabled) => {
            applyStealthVisualState(Boolean(enabled));
        });
    }
}

// Reflect stealth state on <body> (drives the title-bar icon swap + dim) and on
// the settings switch so the two stay consistent.
function applyStealthVisualState(enabled) {
    const on = Boolean(enabled);
    document.body.classList.toggle('stealth-on', on);
    if (stealthBtn) stealthBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (settingStealthToggle) settingStealthToggle.checked = on;
}

// ── Chat-history sidebar ───────────────────────────────────────────────────
function setupHistorySidebar() {
    historySidebar = createHistorySidebar({
        listEl: sessionListEl,
        newBtnEl: newInterviewBtn,
        onNewSession: () => handleNewSession(),
        onSelectSession: (id) => handleSelectSession(id)
    });
    historySidebar.refresh();
}

// ── Transcript crossfade orchestration ─────────────────────────────────────
// Switching sessions (or starting a new one) replaces the entire #chat-messages
// content. To make that swap feel smooth instead of snapping, swapChatContent()
// runs a short crossfade: fade/slide the OLD content out (~120ms, ease-in via
// the .is-switching class in chat.css), run the caller's swap (clear + render),
// then fade/slide the NEW content in (~200ms, ease-out via .is-entering).
//
// Interruptibility: a monotonically increasing token tags each swap. Any timer
// callback re-checks that its token is still current before touching the DOM,
// so a rapid second tab click cancels the first swap (clears its pending timer,
// strips both transition classes, applies the new swap immediately) without
// stacking transitions or stranding the container at opacity:0.
const CHAT_SWAP_OUT_MS = 120;
const CHAT_SWAP_IN_MS = 200;
let chatSwapToken = 0;
let chatSwapTimer = null;

// Animations are forced on by owner request: the session-switch crossfade must
// ALWAYS play, even when the OS reports prefers-reduced-motion. Returning false
// unconditionally neutralizes the short-circuit in swapChatContent() so the
// animated out→swap→in path always runs. The interruptible token logic in
// swapChatContent/cancelChatSwap is unaffected.
function prefersReducedMotion() {
    return false;
}

// Clear any in-flight swap: drop the pending timer and strip the transition
// classes so the container is back to a clean, fully-visible resting state
// before the next swap (or an instant reduced-motion swap) begins.
function cancelChatSwap() {
    if (chatSwapTimer) {
        clearTimeout(chatSwapTimer);
        chatSwapTimer = null;
    }
    if (chatMessagesElement) {
        chatMessagesElement.classList.remove('is-switching', 'is-entering');
    }
}

// Run `swapFn` (the synchronous clear + re-render of the transcript) wrapped in
// the out→swap→in crossfade. `stagger` adds .is-entering, which both runs the
// container rise AND enables the per-line replay cascade (chat.css) — used for
// session loads (a batch of persisted lines), not for a bare new-session clear.
function swapChatContent(swapFn, { stagger = false } = {}) {
    if (typeof swapFn !== 'function') return;

    // Always cancel a previous swap first so tokens/timers/classes never stack.
    cancelChatSwap();

    // Reduced motion (or no container): swap instantly, no animation at all.
    if (!chatMessagesElement || prefersReducedMotion()) {
        swapFn();
        return;
    }

    const token = ++chatSwapToken;

    // Phase 1 — fade/slide the current content out.
    chatMessagesElement.classList.add('is-switching');

    chatSwapTimer = setTimeout(() => {
        // A newer swap superseded us while we were fading out — bail.
        if (token !== chatSwapToken || !chatMessagesElement) return;

        // Phase 2 — replace the content, then fade/slide it in.
        try {
            swapFn();
        } finally {
            chatMessagesElement.classList.remove('is-switching');
            if (stagger) {
                chatMessagesElement.classList.add('is-entering');
                // Strip .is-entering once the enter animation is done so the
                // replay cascade only ever applies to this batch (live lines
                // appended later must not inherit the staggered delays).
                chatSwapTimer = setTimeout(() => {
                    if (token !== chatSwapToken || !chatMessagesElement) return;
                    chatMessagesElement.classList.remove('is-entering');
                    chatSwapTimer = null;
                }, CHAT_SWAP_IN_MS + 60);
            } else {
                chatSwapTimer = null;
            }
        }
    }, CHAT_SWAP_OUT_MS);
}

// "+ New interview" no longer creates a session immediately — it opens the
// online/offline picker first. The actual creation happens in
// createSessionWithType() once the user chooses a card.
function handleNewSession() {
    openInterviewTypeModal();
}

// Create + activate a new interview session stamped with the chosen format.
// `interviewType` is 'online' | 'offline' (the store sanitizes + defaults to
// 'online'). Mirrors the old handleNewSession body, plus applies the format to
// the live UI (body.offline-mode + mic relabel).
async function createSessionWithType(interviewType) {
    const type = interviewType === 'offline' ? 'offline' : 'online';
    try {
        const title = `Interview · ${new Date().toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })}`;
        const result = await window.electronAPI.createSession({ title, mode: interviewerMode, interviewType: type });
        const session = result?.session;
        if (!result?.success || !session) {
            showFeedback('Could not start a new interview', 'error');
            return;
        }
        activeSessionId = session.id;
        setSessionTitle(session.title);
        // A new interview starts with a CLEAN per-interview context: clear the
        // live resume/JD (app-state) + the rail UI so a previous interview's
        // resume never carries over. The new record already has empty fields.
        window.electronAPI?.saveSettings?.({ resumeText: '', jobDescription: '' }).catch((error) => {
            console.error('Failed to clear context for new interview:', error);
        });
        if (resumeDropzone) resumeDropzone.setText('');
        if (jobDescriptionInput) jobDescriptionInput.value = '';
        resumeChat?.reset();
        // Apply the format from the persisted record (falls back to the chosen
        // type) so the live UI matches what was saved.
        applyInterviewType(session.interviewType || type);
        // Crossfade the (now empty) transcript in. No stagger — there are no
        // lines to cascade; the container just fades the placeholder in.
        swapChatContent(() => clearTranscriptUi());
        sessionContextPanel?.update(session.interviewerSessionState || null);
        historySidebar?.setActive(session.id);
        await historySidebar?.refresh();
        showFeedback(type === 'offline' ? '线下面试已开始 / Offline interview started' : 'New interview started', 'success');
        addMonitorLog('info', 'session-new', 'Created interview session', null, {
            id: session.id,
            mode: interviewerMode,
            interviewType: session.interviewType || type
        });
    } catch (error) {
        console.error('Create session failed:', error);
        showFeedback('Could not start a new interview', 'error');
    }
}

// Apply the active interview format to the live UI. Toggles body.offline-mode
// (interview-type.css hides the computer-audio box + single-columns the channel
// grid) and relabels the mic channel header so the room-mic framing is obvious.
function applyInterviewType(interviewType) {
    activeInterviewType = interviewType === 'offline' ? 'offline' : 'online';
    const isOffline = activeInterviewType === 'offline';
    document.body.classList.toggle('offline-mode', isOffline);
    relabelMicChannel(isOffline);
}

// Small DOM tweak on the EXISTING #channel-mic title. channel-control.js (which
// this module does not own) sets the title text once at construction and never
// rewrites it on repaint, so overwriting textContent here is safe and won't be
// fought. We stash the original on first change so online restores the exact
// label channel-control.js rendered.
const MIC_CHANNEL_OFFLINE_LABEL = '房间麦克风 / Room mic';
let micChannelOriginalLabel = null;
function relabelMicChannel(isOffline) {
    const titleEl = channelMicEl?.querySelector('.channel-title');
    if (!titleEl) return;
    if (isOffline) {
        if (micChannelOriginalLabel === null) {
            micChannelOriginalLabel = titleEl.textContent;
        }
        titleEl.textContent = MIC_CHANNEL_OFFLINE_LABEL;
    } else if (micChannelOriginalLabel !== null) {
        titleEl.textContent = micChannelOriginalLabel;
    }
}

// ── New-interview type picker (online vs offline) ───────────────────────────
// Opens on "+ New interview". Esc + backdrop click cancel; choosing a card
// creates the session with that interviewType then closes. Arrow/Enter keyboard
// nav between the two cards is supported.
let interviewTypeModalKeydownHandler = null;
function openInterviewTypeModal() {
    if (!interviewTypeModal) {
        // No modal in the DOM (defensive) — fall back to creating an online
        // session directly so the button is never dead.
        createSessionWithType('online');
        return;
    }
    interviewTypeModal.classList.remove('hidden');
    // Focus the first card so keyboard users land inside the dialog.
    const firstOption = interviewTypeModal.querySelector('.interview-type-option');
    firstOption?.focus();
}

function closeInterviewTypeModal() {
    if (!interviewTypeModal) return;
    interviewTypeModal.classList.add('hidden');
    // Return focus to the trigger for a clean keyboard loop.
    newInterviewBtn?.focus();
}

function setupInterviewTypeModal() {
    if (!interviewTypeModal) return;

    const options = Array.from(interviewTypeModal.querySelectorAll('.interview-type-option'));

    function chooseOption(optionEl) {
        const type = optionEl?.dataset?.interviewType === 'offline' ? 'offline' : 'online';
        closeInterviewTypeModal();
        createSessionWithType(type);
    }

    options.forEach((optionEl, index) => {
        optionEl.addEventListener('click', () => chooseOption(optionEl));
        // Arrow keys move between cards; Enter/Space activate (Space/Enter on a
        // <button> already click, but we handle arrows here).
        optionEl.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                options[(index + 1) % options.length]?.focus();
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                options[(index - 1 + options.length) % options.length]?.focus();
            }
        });
    });

    interviewTypeCloseBtn?.addEventListener('click', () => closeInterviewTypeModal());

    // Backdrop click (clicking the scrim itself, not the card) cancels.
    interviewTypeModal.addEventListener('mousedown', (event) => {
        if (event.target === interviewTypeModal) {
            closeInterviewTypeModal();
        }
    });

    // Esc cancels while the modal is open. Bound on document so it works
    // regardless of focus; guarded by the hidden class so it's inert otherwise.
    interviewTypeModalKeydownHandler = (event) => {
        if (event.key === 'Escape' && !interviewTypeModal.classList.contains('hidden')) {
            event.stopPropagation();
            closeInterviewTypeModal();
        }
    };
    document.addEventListener('keydown', interviewTypeModalKeydownHandler);
}

async function handleSelectSession(id) {
    if (!id) return;
    try {
        const result = await window.electronAPI.loadSession(id);
        const session = result?.session;
        if (!result?.success || !session) {
            showFeedback('Could not load that interview', 'error');
            return;
        }
        activeSessionId = session.id;
        setSessionTitle(session.title);
        if (session.mode === 'expert' || session.mode === 'fast') {
            interviewerMode = session.mode;
            paintModeIndicator();
        }
        // Restore the interview format from the loaded record so the composer
        // matches how the session was run (online dual-channel vs offline room
        // mic). Defaults to online for legacy records without the field.
        applyInterviewType(session.interviewType === 'offline' ? 'offline' : 'online');
        // Crossfade the transcript swap: old lines fade out, then the loaded
        // session's persisted messages replay in with a staggered cascade.
        // swapChatContent is interruptible, so rapid tab switches collapse to
        // the latest selection instead of stacking transitions.
        swapChatContent(() => {
            clearTranscriptUi();
            renderSessionMessages(session.messages);
        }, { stagger: true });
        if (jobDescriptionInput && typeof session.jobDescription === 'string') {
            jobDescriptionInput.value = session.jobDescription;
        }
        if (resumeDropzone && typeof session.resumeText === 'string') {
            resumeDropzone.setText(session.resumeText);
        }
        // Sync the LIVE interviewer context (app-state) to THIS interview's
        // snapshot so the runtime uses this session's resume/JD — not a global
        // leftover from a different interview.
        window.electronAPI?.saveSettings?.({
            resumeText: typeof session.resumeText === 'string' ? session.resumeText : '',
            jobDescription: typeof session.jobDescription === 'string' ? session.jobDescription : ''
        }).catch((error) => {
            console.error('Failed to sync live context from session:', error);
        });
        // Reset the isolated résumé chat — it belongs to this interview's résumé.
        resumeChat?.reset();
        sessionContextPanel?.update(session.interviewerSessionState || null);
        historySidebar?.setActive(session.id);
        addMonitorLog('info', 'session-load', 'Loaded interview session', null, {
            id: session.id,
            messages: Array.isArray(session.messages) ? session.messages.length : 0
        });
    } catch (error) {
        console.error('Load session failed:', error);
        showFeedback('Could not load that interview', 'error');
    }
}

// Re-render a loaded session's persisted messages into the transcript. Coach /
// question rows become indigo question cards; transcript rows become dual-lane
// lines (teal candidate / amber you).
function renderSessionMessages(messages) {
    if (!Array.isArray(messages)) return;
    // Guard the whole replay: the live persistence helpers early-return while
    // this is set, so re-rendering a loaded session never re-appends its own
    // messages back into the record.
    isReplayingSession = true;
    try {
        messages.forEach((message) => {
            if (!message || typeof message !== 'object') return;
            const text = String(message.text || '');
            if (!text) return;
            const ts = Number.isFinite(message.ts) ? new Date(message.ts) : undefined;

            if (message.kind === 'question' || message.role === 'coach') {
                chatUiManager.renderQuestionCard({ question: text });
                pushInterviewerQuestion(text);
                return;
            }
            // candidate = system/teal; interviewer = mic/amber. Prefer the explicit
            // source, else infer from role.
            const source = message.source === 'mic' || message.source === 'system'
                ? message.source
                : (message.role === 'interviewer' ? 'mic' : 'system');
            chatUiManager.renderTranscriptLine({ source, text, ts });
        });
    } finally {
        isReplayingSession = false;
    }
}

function clearTranscriptUi() {
    messageStore.clear();
    chatMessagesArray = messageStore.getMessages();
    if (chatMessagesElement) chatMessagesElement.innerHTML = '';
    interviewerQuestionHistory.length = 0;
    updateUI();
}

function setSessionTitle(title) {
    if (sessionTitleEl) {
        sessionTitleEl.textContent = String(title || 'Untitled interview');
    }
}

// ── Dual-channel audio controls (composer) ─────────────────────────────────
function setupChannelControls() {
    channelControls = createChannelControls({
        computerRootEl: channelComputerEl,
        micRootEl: channelMicEl,
        transcriptionManager,
        audioPipeline,
        getDesktopSources: () => window.electronAPI.getDesktopSources()
    });
}

// ── Resume drop-zone (right rail) ──────────────────────────────────────────
function setupResumeDropzone() {
    resumeDropzone = createResumeDropzone({
        rootEl: resumeDropzoneEl,
        onResumeParsed: async ({ chars, text, cleared } = {}) => {
            // The upload IPC already updated the LIVE context (app-state.resumeText).
            // Snapshot it onto the ACTIVE interview so resume is per-session:
            // switching interviews shows THAT interview's resume, not a global one.
            try {
                const id = await ensureActiveSession();
                if (id) {
                    await window.electronAPI?.updateSessionContext?.(id, {
                        resumeText: cleared ? '' : (typeof text === 'string' ? text : '')
                    });
                }
            } catch (error) {
                console.error('Failed to snapshot resume to session:', error);
            }
            // The résumé changed (uploaded or removed) → reset the isolated
            // résumé chat so it never references a previous résumé.
            resumeChat?.reset();
            if (cleared) {
                showFeedback('Resume removed', 'info');
                addMonitorLog('info', 'resume-cleared', 'Resume removed from this interview', null, {});
            } else {
                showFeedback('Resume loaded', 'success');
                addMonitorLog('info', 'resume-parsed', 'Resume uploaded', null, { chars: chars || 0 });
            }
        }
    });
}

// Isolated résumé chat (right rail, below the drop-zone). Grounds main-side on
// the active interview's résumé; the conversation is owned by the module and
// reset when the interview or its résumé changes. It never touches the
// interview transcript or the main AI context.
function setupResumeChat() {
    resumeChat = createResumeChat({ rootEl: resumeChatEl });
}

// ── Job-description field (debounced save into existing settings field) ─────
const JD_SAVE_DEBOUNCE_MS = 600;
let jdSaveTimer = null;
function setupJobDescriptionInput() {
    if (!jobDescriptionInput) return;
    const flush = () => {
        if (jdSaveTimer) {
            clearTimeout(jdSaveTimer);
            jdSaveTimer = null;
        }
        const value = jobDescriptionInput.value;
        window.electronAPI?.saveSettings?.({ jobDescription: value }).catch((error) => {
            console.error('Failed to save job description:', error);
        });
        // Mirror into the settings-panel textarea so the two stay consistent.
        if (settingJobDescription) settingJobDescription.value = value;
    };
    jobDescriptionInput.addEventListener('input', () => {
        if (jdSaveTimer) clearTimeout(jdSaveTimer);
        jdSaveTimer = setTimeout(flush, JD_SAVE_DEBOUNCE_MS);
    });
    jobDescriptionInput.addEventListener('change', flush);
}

// ── Right-rail session-context panel (Expert Block H state) ────────────────
function setupSessionContextPanel() {
    sessionContextPanel = createSessionContextPanel({ rootEl: sessionContextEl });
    if (window.electronAPI?.onSessionContext) {
        window.electronAPI.onSessionContext((state) => {
            sessionContextPanel?.update(state);
        });
    }
}

// Advance the chat-stream progress card as the Expert chain emits per-phase
// events. Registered once at init; Fast mode emits no events so the card it
// started stays indeterminate until finish/fail.
function setupInterviewerProgressListener() {
    if (window.electronAPI?.onInterviewerProgress) {
        window.electronAPI.onInterviewerProgress((evt) => {
            interviewerProgressCard.advance(evt || {});
        });
    }
}

// Reflect persisted resume + JD (from get-settings) into the right-rail
// components. Called from init() after the components are mounted.
function reflectPersistedContext(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (jobDescriptionInput && typeof settings.jobDescription === 'string') {
        jobDescriptionInput.value = settings.jobDescription;
    }
    if (resumeDropzone && typeof settings.resumeText === 'string' && settings.resumeText.trim()) {
        resumeDropzone.setText(settings.resumeText);
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
    // Manual "Generate Q" trigger. Bound here (not via the event-listeners
    // module) alongside the other direct init bindings; it reuses the
    // interviewer auto-analysis path so no new IPC/feature wiring is needed.
    if (generateQuestionBtn) {
        generateQuestionBtn.addEventListener('click', handleGenerateQuestionClick);
    }
    if (window.electronAPI?.onClearFromMobile) {
        window.electronAPI.onClearFromMobile(() => {
            screenshotsCount = 0;
            // Abort any in-flight transcript crossfade so its deferred phase
            // can't re-apply a transition class to the just-cleared container.
            cancelChatSwap();
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
    setupTitleBarControls();
    setupHistorySidebar();
    setupChannelControls();
    setupInterviewTypeModal();
    setupResumeDropzone();
    setupResumeChat();
    setupJobDescriptionInput();
    setupSessionContextPanel();
    setupInterviewerProgressListener();
    if (SEED_SAMPLE_INTERVIEW) seedSampleInterview();
    // Components are mounted now, so reflect any persisted resume/JD from the
    // settings we loaded above (loadShortcutConfig runs before the components
    // exist, so the reflection has to happen here).
    reflectPersistedContext(settings);
    applyTheme(resolveInitialThemePreference(settings), { persist: false });
    paintModeIndicator();
    paintRecIndicator();
    // Keep the topbar ● REC pill honest with the live source-status object the
    // transcription manager mutates from async ASR events (same cadence as the
    // channel-control status loop).
    setInterval(paintRecIndicator, REC_INDICATOR_POLL_MS);
    updateUI();
    transcriptionManager.updateTranscriptionUI();
    transcriptionManager.renderMonitorState();
    startTimer();

    document.body.style.visibility = 'visible';
    const app = document.getElementById('app');
    if (app) {
        app.style.visibility = 'visible';
    }

    console.log('Renderer initialized - Ready for live transcription!');
    showFeedback('Ready — start a channel below to begin', 'success');
    addMonitorLog('info', 'init', 'Renderer initialized');
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
    // Keep the settings "Dark theme" switch consistent with the live theme,
    // even before the settings panel is first opened.
    if (settingThemeToggle) {
        settingThemeToggle.checked = activeTheme === THEME_DARK;
    }

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

// Track the interviewer mode from settings so the topbar pill + new-session
// `mode` stay in sync with what the backend orchestrator will actually run.
function applyInterviewerModeFromSettings(settings) {
    const mode = settings && settings.interviewerMode === 'expert' ? 'expert' : 'fast';
    interviewerMode = mode;
    paintModeIndicator();
}

function paintModeIndicator() {
    if (modeIndicatorEl) {
        modeIndicatorEl.dataset.mode = interviewerMode;
        modeIndicatorEl.setAttribute('title', `Interviewer mode: ${interviewerMode}`);
    }
    if (modeIndicatorLabel) {
        modeIndicatorLabel.textContent = interviewerMode === 'expert' ? 'Expert' : 'Fast';
    }
}

// Reflect the live capture state in the topbar ● REC pill. Driven off the
// transcription source-status object the manager mutates in place.
function paintRecIndicator() {
    if (!recIndicatorEl) return;
    const statuses = transcriptionManager?.sourceStatuses || {};
    const values = Object.values(statuses);
    let state = 'idle';
    let label = 'Idle';
    if (values.includes('listening')) {
        state = 'live';
        label = 'REC';
    } else if (values.includes('connecting')) {
        state = 'connecting';
        label = 'Connecting';
    }
    recIndicatorEl.dataset.state = state;
    if (recIndicatorLabel) recIndicatorLabel.textContent = label;
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
        applyInterviewerModeFromSettings(settings);
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
        // Abort any in-flight transcript crossfade before wiping the container
        // so a deferred swap phase can't strand a transition class on it.
        cancelChatSwap();
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

// Click on the settings scrim (anywhere outside the dialog card) closes the
// panel. Uses mousedown (not click) so a text-selection drag that happens to
// release on the scrim doesn't dismiss it. Settings auto-save, so closing this
// way never loses changes.
if (settingsPanel) {
    settingsPanel.addEventListener('mousedown', (event) => {
        if (event.target === settingsPanel) {
            closeSettings();
        }
    });
}

// Whole right-panel collapse — topbar toggle flips body.rail-collapsed (CSS
// animates the rail column to 0). State persists across reloads via localStorage.
const toggleRailBtn = document.getElementById('toggle-rail-btn');
function applyRailCollapsed(collapsed) {
    document.body.classList.toggle('rail-collapsed', Boolean(collapsed));
    if (toggleRailBtn) toggleRailBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    try { localStorage.setItem('open-cluely.railCollapsed', collapsed ? '1' : '0'); } catch (_) {}
}
if (toggleRailBtn) {
    toggleRailBtn.addEventListener('click', () => {
        applyRailCollapsed(!document.body.classList.contains('rail-collapsed'));
    });
}
try {
    if (localStorage.getItem('open-cluely.railCollapsed') === '1') {
        applyRailCollapsed(true);
    }
} catch (_) { /* localStorage unavailable — default expanded */ }

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





