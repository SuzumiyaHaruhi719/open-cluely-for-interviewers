/// <reference path="./renderer-globals.d.ts" />

import { createMessageStore } from './renderer/features/ai-context/message-store.js';
import { buildFilteredAiContextBundle as buildAiContextBundle } from './renderer/features/ai-context/context-bundle.js';
import { updateMessageAiToggleUi as syncMessageAiToggleUi } from './renderer/features/ai-context/toggle-ui.js';
import { createChatUiManager } from './renderer/features/chat/chat-ui-manager.js';
import { createProgressCard } from './renderer/features/chat/progress-card.js';
import { createPipelineStudio } from './renderer/features/pipeline/pipeline-studio.js';
import { INTERVIEW_SAMPLES, getInterviewSample } from './renderer/features/session/interview-samples.js';
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
// Throttle the per-final "已捕获" toast so a burst of transcript finals
// doesn't spam the toast. The screenshot-count badge already updates per
// capture; the toast is only reaffirmed if 3s+ have passed since the last.
let lastCapturedToastTime = 0;
const CAPTURED_TOAST_THROTTLE_MS = 3000;
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
    // Coalesce concurrent callers. createSession is async, and ASR finalizes
    // several transcript lines in quick succession — without this guard each
    // line that arrives before the first create resolves would spawn its OWN
    // session, fragmenting the conversation across many 1-message sessions.
    if (activeSessionCreation) return activeSessionCreation;
    if (!window.electronAPI?.createSession) return null;
    activeSessionCreation = (async () => {
        try {
            const title = `面试 · ${new Date().toLocaleString('zh-CN', {
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
            addMonitorLog('info', 'session-auto', '首次活动时已创建面试会话', null, {
                id: activeSessionId,
                mode: interviewerMode,
                interviewType: session.interviewType || activeInterviewType
            });
            return activeSessionId;
        } catch (error) {
            console.error('ensureActiveSession failed:', error);
            return null;
        } finally {
            activeSessionCreation = null;
        }
    })();
    return activeSessionCreation;
}

// The ordered conversation for the active interview — the SINGLE source of truth
// for persistence. Transcripts (shown via the transcription manager's live bubble,
// not the message store) and AI follow-up cards are both appended here as they
// happen, then the whole array is saved to the session (full replace). One array,
// one writer → cannot fragment, race, or drop a line. Reset on new interview;
// re-hydrated from the record on session load.
let liveConversation = [];

function recordConversationTurn(turn) {
    if (isReplayingSession) return;          // loading a past session must not re-record it
    if (!turn || !String(turn.text || '').trim()) return;
    liveConversation.push({ ...turn, text: String(turn.text).trim(), ts: turn.ts || Date.now() });
    void persistConversationNow();
}

// Persist the full conversation to the active session (full replace). Written
// immediately per turn — turns are infrequent (transcripts ~every few seconds,
// follow-ups ~every 30s), so there's no need to debounce, and writing now (rather
// than on a timer) means the turn lands in the session that was active WHEN it
// happened — a later navigation can't redirect a pending write to the wrong
// session. No-op during replay or when empty.
async function persistConversationNow() {
    if (isReplayingSession || !liveConversation.length) return;
    const snapshot = liveConversation.slice();
    try {
        const id = await ensureActiveSession();
        if (!id) return;
        await window.electronAPI?.setSessionMessages?.(id, snapshot);
    } catch (error) {
        console.error('persistConversationNow failed:', error);
    }
}

function renderInterviewerCoachMessage(stage2Parsed, stage1Parsed, meta = null) {
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
    if (typeof score === 'number') headerBits.push(`评分 ${score}`);
    if (direction) headerBits.push(direction);
    const header = headerBits.length ? `_(${headerBits.join(' · ')})_` : '';

    // Cost footer: model · elapsed · tokens (parity with the Expert follow-up card).
    if (meta) {
        const bits = [];
        if (meta.model) bits.push(`🧠 ${meta.model}`);
        if (Number(meta.elapsedMs) > 0) bits.push(`⏱ ${(Number(meta.elapsedMs) / 1000).toFixed(1)}s`);
        if (meta.tokensUsed && Number(meta.tokensUsed.total) > 0) bits.push(`🪙 ${Number(meta.tokensUsed.total).toLocaleString()} tokens`);
        if (bits.length) lines.push(`*${bits.join(' · ')}*`);
    }

    const body = (header ? `${header}\n\n` : '') + lines.join('\n');
    addChatMessage('interviewer-coach', body);
    recordConversationTurn({ role: 'coach', kind: 'question', text: body });
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
    // Record the generated follow-up so it persists + restores on session reload.
    // (This path — Expert/Customize — renders via renderQuestionCard directly, so
    // it needs its own record call; the Fast path records in renderInterviewerCoachMessage.)
    recordConversationTurn({ role: 'coach', kind: 'question', text: primary });

    const rationale = String(output?.rationale_for_interviewer || '').trim();
    const alternative = String(output?.alternative_question || '').trim();
    // The rationale is the analysis of the PRIMARY question, so it comes FIRST
    // (right under the primary card) — not after the alternative, where it read as
    // if it belonged to the alternative. Then the alternative follow-up. Both
    // persist (round-trip on reload); the cost line below is runtime-only.
    const persistParts = [];
    if (rationale) persistParts.push(`💡 **追问解析** ${rationale}`);
    if (alternative) persistParts.push(`**备选追问** ${alternative}`);
    const extra = persistParts.slice();
    const costBits = [];
    if (Number(elapsedMs) > 0) costBits.push(`⏱ 耗时 ${(Number(elapsedMs) / 1000).toFixed(1)}s`);
    if (tokensUsed && Number(tokensUsed.total) > 0) {
        const t = tokensUsed;
        costBits.push(`🪙 ${Number(t.total).toLocaleString()} tokens（输入 ${Number(t.input).toLocaleString()} · 输出 ${Number(t.output).toLocaleString()}）`);
    }
    if (costBits.length) extra.push(`*${costBits.join(' · ')}*`);
    if (extra.length) addChatMessage('interviewer-coach', extra.join('\n'));
    // Record the alternative + rationale so BOTH the follow-up and the candidate
    // follow-up round-trip on session reload (not just the primary).
    if (persistParts.length) recordConversationTurn({ role: 'coach', kind: 'question', text: persistParts.join('\n') });
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
                addMonitorLog('warn', 'interviewer', 'AI 密钥（DashScope）未配置 — 面试官助手已禁用。请在设置中添加。', 'system');
            }
            return;
        }
        // Reset the once-warned latch if a successful analysis happened
        // (means the user added the key and the system recovered).
        interviewerSkipKeyWarned = false;

        interviewerProgressCard.finish(requestId);

        if (response.mode === 'expert' || response.mode === 'custom') {
            if (response.shouldShowFollowUps) {
                renderExpertFollowUp(response.output, response.tokensUsed, response.elapsedMs);
            } else {
                addMonitorLog('info', 'interviewer', 'Expert 链未产生高置信度的追问', 'system');
            }
        } else if (response.shouldShowFollowUps && response.stage2?.parsed) {
            renderInterviewerCoachMessage(response.stage2.parsed, response.stage1?.parsed, { model: response.model, tokensUsed: response.tokensUsed, elapsedMs: response.elapsedMs });
        } else {
            addMonitorLog('info', 'interviewer', `Stage1 评分 ${response.stage1?.parsed?.score ?? '?'} — 未生成追问`, 'system');
        }
    } catch (err) {
        interviewerProgressCard.fail(requestId);
        addMonitorLog('error', 'interviewer', err?.message || '分析失败', 'system');
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
        showFeedback('DashScope API 密钥缺失。请在设置中添加。', 'error');
        return;
    }

    const candidateAnswer = getLatestCandidateTranscript();
    if (!candidateAnswer) {
        showFeedback('暂无候选人回答可用于生成问题', 'info');
        return;
    }

    generateQuestionInFlight = true;
    const originalLabel = generateQuestionBtn ? generateQuestionBtn.textContent : '';
    if (generateQuestionBtn) {
        generateQuestionBtn.disabled = true;
        generateQuestionBtn.textContent = '生成中…';
    }
    try {
        // Same path the candidate-final onFlush auto-trigger uses. No emotion is
        // available for a manual trigger, so pass null (the analysis treats it
        // as optional). Do NOT duplicate the analysis logic here.
        await triggerInterviewerAnalysis(candidateAnswer, null);
    } catch (error) {
        console.error('Generate question failed:', error);
        showFeedback(`无法生成问题：${error?.message || '未知错误'}。请检查网络或 API 密钥。`, 'error');
    } finally {
        generateQuestionInFlight = false;
        if (generateQuestionBtn) {
            generateQuestionBtn.disabled = false;
            generateQuestionBtn.textContent = originalLabel || '生成追问';
        }
    }
}

// Seed a chosen sample interview into the live chat: sets résumé/JD and injects
// the transcript turns (interviewer → "You" mic lane; candidate → computer-audio
// lane online, room-mic lane offline). Interviewer turns also feed the question
// history so Generate Q has prior context. Called from createSessionWithType when
// a sample is picked in the new-interview modal.
// Set the sample's résumé/JD (async; order-independent). Separate from turn
// injection because the transcript must be injected inside swapChatContent's
// (async) clear callback — otherwise the clear fires after the seed and wipes it.
async function applySampleContext(sample) {
    if (!sample) return;
    try { await window.electronAPI?.saveSettings?.({ resumeText: sample.resume || '', jobDescription: sample.jd || '' }); } catch (_) { /* non-fatal */ }
    if (resumeDropzone && sample.resume) resumeDropzone.setText(sample.resume);
    if (jobDescriptionInput) jobDescriptionInput.value = sample.jd || '';
}

// Inject the sample's transcript turns into the (already-cleared) chat. SYNC, so
// it can run inside the swap callback right after clearTranscriptUi.
function injectSampleTurns(sample) {
    if (!sample || !chatMessagesElement) return;
    const candidateType = (sample.interviewType === 'offline' || activeInterviewType === 'offline') ? 'voice-mic' : 'voice-system';
    for (const turn of (sample.turns || [])) {
        const type = turn.speaker === 'interviewer' ? 'voice-mic' : candidateType;
        chatUiManager.addChatMessage(type, turn.text);
        if (turn.speaker === 'interviewer') pushInterviewerQuestion(turn.text);
        // Record so the seeded sample transcript persists with the interview.
        recordConversationTurn({
            role: turn.speaker === 'interviewer' ? 'interviewer' : 'candidate',
            source: turn.speaker === 'interviewer' ? 'mic' : 'system',
            kind: 'transcript', text: turn.text
        });
    }
}

// Populate the new-interview modal's sample dropdown once.
function populateInterviewSampleOptions() {
    const sel = document.getElementById('interview-sample-select');
    if (!sel) return;
    const opts = ['<option value="">空白 / Blank（无转录）</option>']
        .concat(INTERVIEW_SAMPLES.map((s) => `<option value="${s.id}">${s.name}</option>`));
    sel.innerHTML = opts.join('');
}

const transcriptBufferManager = createTranscriptBufferManager({
    // 9s window keeps natural conversational pauses (3-6s) inside a single
    // bubble. Bubbles still force-flush at maxBufferChars so a long answer
    // doesn't grow without bound.
    mergeWindowMs: 9000,
    onBuffer: ({ source, text, segments }) => {
        addMonitorLog('info', 'final-buffer', '已缓存转录片段', source, {
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

        // Record this finalized line in the conversation (system→candidate teal
        // lane; mic→interviewer amber lane), which lazily creates + saves the
        // session. Fire-and-forget so the live path is never blocked by disk I/O.
        recordConversationTurn({
            role: source === 'system' ? 'candidate' : 'interviewer',
            source, kind: 'transcript', text
        });

        addMonitorLog('info', 'final-flush', '已提交合并后的转录', source, {
            reason,
            segments,
            chars: text.length
        });
        // Throttle the "已捕获" toast: the transcript bubble already updates live
        // and finals often arrive in bursts, so showing a toast on every one
        // spams. Only reaffirm if 3s+ passed since the last such toast.
        const now = Date.now();
        if (now - lastCapturedToastTime >= CAPTURED_TOAST_THROTTLE_MS) {
            lastCapturedToastTime = now;
            showFeedback('已捕获', 'success');
        }
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
    chatAutoScrollToggle.title = enabled ? '自动滚动已开启（点击关闭）' : '自动滚动已关闭（点击开启）';
}

const mobileServerPill = document.getElementById('mobile-server-pill');
const mobileServerPillLabel = document.getElementById('mobile-server-pill-label');
let mobileServerStatus = { listening: false, port: 7823, urls: [], clientCount: 0, error: null };

function paintMobileServerPill() {
    if (!mobileServerPill || !mobileServerPillLabel) return;

    mobileServerPill.classList.remove('off', 'idle', 'connected');

    if (!mobileServerStatus.listening) {
        mobileServerPill.classList.add('off');
        mobileServerPillLabel.textContent = mobileServerStatus.error ? '手机端 · 错误' : '手机端 · 关闭';
        mobileServerPill.title = mobileServerStatus.error
            ? `手机伴侣未运行：${mobileServerStatus.error}`
            : '手机伴侣未运行';
        return;
    }

    const firstReal = mobileServerStatus.urls.find((u) => !u.virtual) || mobileServerStatus.urls[0];
    const firstUrl = firstReal?.url;
    const count = mobileServerStatus.clientCount || 0;
    mobileServerPill.classList.add(count > 0 ? 'connected' : 'idle');

    if (firstUrl) {
        mobileServerPillLabel.textContent = firstUrl.replace(/^http:\/\//, '') + (count > 0 ? ` · ${count}` : '');
    } else {
        mobileServerPillLabel.textContent = `:${mobileServerStatus.port}` + (count > 0 ? ` · ${count}` : ' · 无局域网');
    }

    const lines = [
        count > 0
            ? `手机伴侣：${count} 个客户端已连接`
            : '手机伴侣正在监听（暂无客户端 — 点击查看帮助）',
        ...mobileServerStatus.urls.map(({ url, name, virtual }) => virtual
            ? `${url}  (${name}) — 虚拟适配器，手机可能无法访问`
            : `${url}  (${name})`
        )
    ];
    if (mobileServerStatus.urls.length === 0) {
        lines.push('未检测到非回环 IPv4 接口。');
    }
    if (mobileServerStatus.urls.some((u) => u.virtual) && mobileServerStatus.urls.some((u) => !u.virtual)) {
        lines.push('请在手机上使用第一个非虚拟的 URL。');
    }
    lines.push('');
    lines.push('点击复制 URL。如果手机超时，请以管理员身份运行 PowerShell 并执行一次：');
    lines.push('  New-NetFirewallRule -DisplayName "Open-Cluely Mobile" -Direction Inbound -LocalPort 7823 -Protocol TCP -Action Allow -Profile Any');
    mobileServerPill.title = lines.join('\n');
}

function copyMobileUrlPickReal() {
    return mobileServerStatus.urls.find((u) => !u.virtual)?.url || mobileServerStatus.urls[0]?.url;
}

async function copyMobileUrlToClipboard() {
    const url = copyMobileUrlPickReal();
    if (!url) {
        showFeedback('手机端尚无局域网 URL', 'error');
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        showFeedback(`已复制 ${url}`, 'success');
    } catch (err) {
        // Fallback: the async Clipboard API can fail in non-secure contexts or
        // when the document isn't focused. Rather than dead-end on an error
        // toast, surface the URL in a prompt dialog so the user can copy it
        // manually (Ctrl/Cmd+C the pre-selected value).
        const picked = window.prompt('无法自动复制，请手动复制手机端 URL:', url);
        if (picked === null) {
            // User dismissed the prompt — nothing copied, so confirm explicitly.
            showFeedback('无法复制 URL', 'error');
        }
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

// Clear-session confirmation (清空会话) — mirrors the close-confirmation flow.
const clearConfirmationDialog = document.getElementById('clear-confirmation-dialog');
const cancelClearSessionBtn = document.getElementById('cancel-clear-session-btn');
const confirmClearSessionBtn = document.getElementById('confirm-clear-session-btn');

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
// JD save-status pip (see setupJobDescriptionInput): shows 保存中… / 已保存.
const jdSavePip = document.getElementById('jd-save-pip');
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

// Settings elements
const settingsBtn = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
// Auto-save: no manual Save button in the new settings surface.
const saveSettingsBtn = null;
const settingsStatusIndicator = document.getElementById('settings-status');
const settingStealthToggle = document.getElementById('setting-stealth-toggle');
const settingDashscopeAiModel = document.getElementById('setting-dashscope-ai-model');
const settingOutputLanguage = document.getElementById('setting-output-language');
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
const settingVolcModel = document.getElementById('setting-volc-model');
const settingVolcResourceIdRow = document.getElementById('setting-volc-resource-id-row');
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
let activeSessionCreation = null; // in-flight createSession promise (coalesces concurrent ensureActiveSession callers)
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

// ── Customize mode + Pipeline Studio (SP2/SP3) ──────────────────────────────
let activePipelineId = null;
const customizeRowEl = document.getElementById('customize-row');
const customizeTemplatesEl = document.getElementById('customize-templates');
const customizeAiInput = document.getElementById('customize-ai-input');
const customizeAiGenerateBtn = document.getElementById('customize-ai-generate');
const customizeAiHint = document.getElementById('customize-ai-hint');
const openStudioBtn = document.getElementById('open-pipeline-studio');
const pipelineStudio = createPipelineStudio({
    api: window.electronAPI,
    showFeedback: (m, t) => showFeedback(m, t),
    onUsed: (id, name) => {
        activePipelineId = id;
        interviewerMode = 'customize';
        paintModeIndicator();
        refreshCustomizePicker();
        showFeedback(`已启用: ${name}`, 'success');
    }
});

// Pick a pipeline as the active Customize pipeline (also flips mode to customize).
async function selectPipeline(id, name) {
    const r = await window.electronAPI.pipelineSetActive({ id });
    if (r && r.success) {
        activePipelineId = id;
        interviewerMode = 'customize';
        paintModeIndicator();
        renderTemplateCards(lastPipelineList);
        showFeedback(`已启用模板: ${name || id}`, 'success');
    } else {
        showFeedback(`启用失败: ${r && r.error}`, 'error');
    }
}

let lastPipelineList = [];
function renderTemplateCards(items) {
    if (!customizeTemplatesEl) return;
    customizeTemplatesEl.innerHTML = (items || []).map((p) => {
        const active = p.id === activePipelineId ? ' customize-card--active' : '';
        const badge = p.builtin ? '<span class="customize-card__badge">模板</span>' : '<span class="customize-card__badge customize-card__badge--user">自定义</span>';
        const desc = p.blurb ? `<div class="customize-card__desc">${escapeHtml(p.blurb)}</div>` : '';
        return `<button type="button" class="customize-card${active}" role="option" aria-selected="${p.id === activePipelineId}" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">
            <div class="customize-card__top">${escapeHtml(p.name)}${badge}</div>${desc}</button>`;
    }).join('');
    customizeTemplatesEl.querySelectorAll('.customize-card').forEach((el) => {
        el.addEventListener('click', () => selectPipeline(el.dataset.id, el.dataset.name));
    });
}

async function refreshCustomizePicker() {
    if (!customizeTemplatesEl || !window.electronAPI?.pipelineList) return;
    const r = await window.electronAPI.pipelineList();
    // Expert 1.0 / 2.0 are now top-level modes (not Customize templates), so hide
    // them from the gallery — Customize is for role templates + your own pipelines.
    lastPipelineList = ((r && r.pipelines) || []).filter((p) => p.id !== 'builtin-expert' && p.id !== 'builtin-expert-fast');
    renderTemplateCards(lastPipelineList);
}

async function generatePipelineFromInput() {
    const desc = (customizeAiInput && customizeAiInput.value || '').trim();
    if (!desc) { showFeedback('先用一句话描述这次面试', 'info'); return; }
    if (!window.electronAPI?.pipelineGenerate) return;
    customizeAiGenerateBtn.disabled = true;
    if (customizeAiHint) customizeAiHint.textContent = 'AI 正在生成面试方案…';
    try {
        const r = await window.electronAPI.pipelineGenerate({ description: desc });
        if (r && r.success && r.id) {
            await refreshCustomizePicker();
            await selectPipeline(r.id, r.pipeline && r.pipeline.name);
            if (customizeAiHint) customizeAiHint.textContent = `已生成并启用: ${r.pipeline && r.pipeline.name || r.id}`;
            if (customizeAiInput) customizeAiInput.value = '';
        } else {
            if (customizeAiHint) customizeAiHint.textContent = '';
            showFeedback(`生成失败: ${r && r.error}`, 'error');
        }
    } finally {
        customizeAiGenerateBtn.disabled = false;
    }
}

function setupPipelineStudio() {
    if (openStudioBtn) openStudioBtn.addEventListener('click', () => pipelineStudio.open(activePipelineId || ''));
    if (customizeAiGenerateBtn) customizeAiGenerateBtn.addEventListener('click', generatePipelineFromInput);
    if (customizeAiInput) customizeAiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); generatePipelineFromInput(); } });
}

// Doubao model picker: a friendly dropdown of the known Volcengine resource IDs
// that drives the (still-editable) Resource ID field, auto-saving on change.
const VOLC_KNOWN_RESOURCES = ['volc.bigasr.sauc.duration', 'volc.bigasr.sauc.concurrent', 'volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent'];
function syncVolcModelFromInput() {
    if (!settingVolcModel || !settingVolcResourceId) return;
    const v = String(settingVolcResourceId.value || '').trim();
    settingVolcModel.value = VOLC_KNOWN_RESOURCES.includes(v) ? v : '__custom';
    if (settingVolcResourceIdRow) settingVolcResourceIdRow.style.display = settingVolcModel.value === '__custom' ? '' : 'none';
}
function setupVolcModelPicker() {
    if (!settingVolcModel || !settingVolcResourceId) return;
    settingVolcModel.addEventListener('change', () => {
        if (settingVolcModel.value === '__custom') {
            if (settingVolcResourceIdRow) settingVolcResourceIdRow.style.display = '';
            settingVolcResourceId.focus();
            return;
        }
        settingVolcResourceId.value = settingVolcModel.value;
        if (settingVolcResourceIdRow) settingVolcResourceIdRow.style.display = 'none';
        window.electronAPI?.saveSettings?.({ volcResourceId: settingVolcModel.value }).catch(() => {});
    });
    settingVolcResourceId.addEventListener('change', () => {
        window.electronAPI?.saveSettings?.({ volcResourceId: String(settingVolcResourceId.value || '').trim() }).catch(() => {});
        syncVolcModelFromInput();
    });
    // The settings panel populates the Resource ID input asynchronously on open;
    // sync the dropdown to it shortly after.
    if (settingsBtn) settingsBtn.addEventListener('click', () => setTimeout(syncVolcModelFromInput, 200));
    syncVolcModelFromInput();
}
const settingsPanelManager = createSettingsPanelManager({
    settingsPanel,
    settingDashscopeAiModel,
    settingOutputLanguage,
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
    // New auto-save deps: status pip + stealth control. Stealth persists through
    // setStealth (toggle-stealth IPC) — it does not ride save-settings.
    settingsStatusIndicator,
    settingStealthToggle,
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
async function createSessionWithType(interviewType, sampleId = null) {
    const sample = sampleId ? getInterviewSample(sampleId) : null;
    // A picked sample defines its own interview format; otherwise use the card.
    const type = (sample ? sample.interviewType : interviewType) === 'offline' ? 'offline' : 'online';
    try {
        const title = `面试 · ${new Date().toLocaleString('zh-CN', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })}`;
        const result = await window.electronAPI.createSession({ title, mode: interviewerMode, interviewType: type });
        const session = result?.session;
        if (!result?.success || !session) {
            showFeedback('无法开始新的面试', 'error');
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
        // Clear the transcript, then (in the same async swap callback) inject the
        // sample turns so the swap's clear can't wipe them. Résumé/JD set separately.
        swapChatContent(() => { clearTranscriptUi(); if (sample) injectSampleTurns(sample); });
        if (sample) await applySampleContext(sample);
        sessionContextPanel?.update(session.interviewerSessionState || null);
        historySidebar?.setActive(session.id);
        await historySidebar?.refresh();
        showFeedback(sample ? `样本已载入：${sample.name}` : (type === 'offline' ? '线下面试已开始' : '新面试已开始'), 'success');
        addMonitorLog('info', 'session-new', '已创建面试会话', null, {
            id: session.id,
            mode: interviewerMode,
            interviewType: session.interviewType || type
        });
    } catch (error) {
        console.error('Create session failed:', error);
        showFeedback('无法开始新的面试', 'error');
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
const MIC_CHANNEL_OFFLINE_LABEL = '房间麦克风';
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

// ── Focus trap ─────────────────────────────────────────────────────────────
// Reusable focus trap for modal dialogs. On open, store the element that had
// focus (so it can be restored on close), then call trapFocus(container): it
// focuses the first visible focusable child and keeps Tab/Shift+Tab cycling
// INSIDE the container (wrapping from the last element back to the first and
// vice-versa) so focus can never escape to the background UI while the modal is
// open. Returns a cleanup function that removes the keydown listener — call it
// on close, then restore focus to the stored element.
//
// Visibility filter: `.hidden` on these modals is `display:none`, so
// `el.offsetParent !== null` correctly excludes elements that are not actually
// rendered (a display:none ancestor yields offsetParent === null). This keeps
// the focus list honest when sub-groups (e.g. ASR provider panels) are hidden.
function trapFocus(container) {
    if (!container) return () => {};
    const focusable = container.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    const visible = Array.from(focusable).filter((el) => el.offsetParent !== null);
    if (visible.length === 0) return () => {};

    const first = visible[0];
    const last = visible[visible.length - 1];

    // Re-query the visible set on each Tab so dynamically shown/hidden fields
    // (provider sub-groups, disabled buttons) are always reflected.
    function visibleFocusables() {
        const list = container.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        );
        return Array.from(list).filter((el) => el.offsetParent !== null);
    }

    // Defer the initial focus to the next frame so the container's display
    // change (hidden→visible) has settled — focusing synchronously right after
    // removing .hidden can land on an element before layout is ready.
    requestAnimationFrame(() => { first.focus(); });

    const handler = (e) => {
        if (e.key !== 'Tab') return;
        const items = visibleFocusables();
        if (items.length === 0) return;
        const f = items[0];
        const l = items[items.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === f || !container.contains(document.activeElement)) {
                e.preventDefault();
                l.focus();
            }
        } else {
            if (document.activeElement === l || !container.contains(document.activeElement)) {
                e.preventDefault();
                f.focus();
            }
        }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
}

// ── New-interview type picker (online vs offline) ───────────────────────────
// Opens on "+ New interview". Esc + backdrop click cancel; choosing a card
// creates the session with that interviewType then closes. Arrow/Enter keyboard
// nav between the two cards is supported.
let interviewTypeModalKeydownHandler = null;
let interviewTypeFocusTrapCleanup = null;
let interviewTypeFocusReturnEl = null;
function openInterviewTypeModal() {
    if (!interviewTypeModal) {
        // No modal in the DOM (defensive) — fall back to creating an online
        // session directly so the button is never dead.
        createSessionWithType('online');
        return;
    }
    interviewTypeFocusReturnEl = document.activeElement;
    interviewTypeModal.classList.remove('hidden');
    // Trap focus inside the dialog (focuses the first focusable + wraps Tab).
    interviewTypeFocusTrapCleanup?.();
    interviewTypeFocusTrapCleanup = trapFocus(interviewTypeModal);
    // trapFocus focuses the close button (first focusable in DOM order) by
    // default; for this picker we prefer the first option card so the
    // arrow-key nav between cards starts on a card, not the close control.
    // Run after trapFocus's own focus-deferral so this wins.
    requestAnimationFrame(() => {
        interviewTypeModal.querySelector('.interview-type-option')?.focus();
    });
}

function closeInterviewTypeModal() {
    if (!interviewTypeModal) return;
    interviewTypeModal.classList.add('hidden');
    // Release the focus trap before restoring focus.
    interviewTypeFocusTrapCleanup?.();
    interviewTypeFocusTrapCleanup = null;
    // Return focus to the trigger (or the stored origin) for a clean loop.
    (interviewTypeFocusReturnEl || newInterviewBtn)?.focus();
    interviewTypeFocusReturnEl = null;
}

function setupInterviewTypeModal() {
    if (!interviewTypeModal) return;

    const options = Array.from(interviewTypeModal.querySelectorAll('.interview-type-option'));

    function chooseOption(optionEl) {
        const type = optionEl?.dataset?.interviewType === 'offline' ? 'offline' : 'online';
        const sampleSel = document.getElementById('interview-sample-select');
        const sampleId = sampleSel && sampleSel.value ? sampleSel.value : null;
        closeInterviewTypeModal();
        createSessionWithType(type, sampleId);
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

// On launch, re-open the most recent interview that actually has messages so its
// chat history is visible and new activity continues it (rather than spawning a
// fresh blank session on every restart). No-op if there are no sessions yet.
async function restoreLatestSession() {
    try {
        if (!window.electronAPI?.listSessions) return;
        const r = await window.electronAPI.listSessions();
        const list = (r && r.sessions) || (Array.isArray(r) ? r : []);
        if (!Array.isArray(list) || !list.length) return;
        // Index is newest-first by lastMessageAt; prefer the newest with content.
        const target = list.find((s) => (s.messageCount || s.messages || 0) > 0) || list[0];
        if (target && target.id) await handleSelectSession(target.id);
    } catch (error) {
        console.error('restoreLatestSession failed:', error);
    }
}

async function handleSelectSession(id) {
    if (!id) return;
    try {
        const result = await window.electronAPI.loadSession(id);
        const session = result?.session;
        if (!result?.success || !session) {
            showFeedback('无法加载该面试', 'error');
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
        addMonitorLog('info', 'session-load', '已加载面试会话', null, {
            id: session.id,
            messages: Array.isArray(session.messages) ? session.messages.length : 0
        });
    } catch (error) {
        console.error('Load session failed:', error);
        showFeedback('无法加载该面试', 'error');
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
    // Re-hydrate the live conversation from the loaded record so any further
    // activity in this interview appends to (and re-saves) the full history.
    liveConversation = (messages || [])
        .filter((m) => m && String(m.text || '').trim())
        .map((m) => ({ role: m.role, source: m.source, kind: m.kind, text: String(m.text).trim(), ts: m.ts || Date.now() }));
}

function clearTranscriptUi() {
    messageStore.clear();
    chatMessagesArray = messageStore.getMessages();
    if (chatMessagesElement) chatMessagesElement.innerHTML = '';
    interviewerQuestionHistory.length = 0;
    liveConversation = []; // new/empty interview starts a fresh conversation record
    updateUI();
}

function setSessionTitle(title) {
    if (sessionTitleEl) {
        sessionTitleEl.textContent = String(title || '未命名面试');
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
                showFeedback('简历已移除', 'info');
                addMonitorLog('info', 'resume-cleared', '此面试的简历已移除', null, {});
                document.getElementById('resume-section-title')?.classList.remove('has-resume');
            } else {
                showFeedback('简历已载入', 'success');
                addMonitorLog('info', 'resume-parsed', '简历已上传', null, { chars: chars || 0 });
                document.getElementById('resume-section-title')?.classList.add('has-resume');
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
const JD_PIP_CLEAR_MS = 2000;
let jdSaveTimer = null;
let jdPipClearTimer = null;
// Module-level flush handle so a beforeunload handler can force-save any
// pending JD edits immediately (the input debounces saves by ~600ms, so a
// refresh right after typing would otherwise lose the last keystrokes).
let flushJdInputNow = null;

// Paint the JD save-status pip. Pass {state, text}: state is one of
// '' | 'saving' | 'saved' (drives the colour class), text is the visible label.
function setJdSavePip(state, text) {
    if (!jdSavePip) return;
    jdSavePip.classList.remove('saving', 'saved');
    if (state) jdSavePip.classList.add(state);
    jdSavePip.textContent = text || '';
}

function clearJdPipSoon() {
    if (jdPipClearTimer) clearTimeout(jdPipClearTimer);
    jdPipClearTimer = setTimeout(() => {
        setJdSavePip('', '');
        jdPipClearTimer = null;
    }, JD_PIP_CLEAR_MS);
}

function setupJobDescriptionInput() {
    if (!jobDescriptionInput) return;
    const flush = () => {
        if (jdSaveTimer) {
            clearTimeout(jdSaveTimer);
            jdSaveTimer = null;
        }
        const value = jobDescriptionInput.value;
        setJdSavePip('saving', '保存中…');
        window.electronAPI?.saveSettings?.({ jobDescription: value }).then(() => {
            setJdSavePip('saved', '已保存');
            clearJdPipSoon();
        }).catch((error) => {
            console.error('Failed to save job description:', error);
            setJdSavePip('', '');
        });
        // Mirror into the settings-panel textarea so the two stay consistent.
        if (settingJobDescription) settingJobDescription.value = value;
    };
    jobDescriptionInput.addEventListener('input', () => {
        // User typed: a debounced save is now pending. Mark as unsaved so the
        // pip doesn't linger on a stale 已保存 from the previous save.
        if (jdPipClearTimer) {
            clearTimeout(jdPipClearTimer);
            jdPipClearTimer = null;
        }
        setJdSavePip('', '未保存');
        if (jdSaveTimer) clearTimeout(jdSaveTimer);
        jdSaveTimer = setTimeout(flush, JD_SAVE_DEBOUNCE_MS);
    });
    jobDescriptionInput.addEventListener('change', flush);

    // Expose the flush for the beforeunload handler (registered in init()).
    flushJdInputNow = flush;
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
        showFeedback('electronAPI 不可用', 'error');
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
    // Loading-overlay cancel: hide the overlay + confirm to the user that the
    // in-flight analysis was cancelled. The actual AI request is not aborted
    // here (the main process owns it); this only dismisses the waiting UI.
    document.getElementById('loading-cancel-btn')?.addEventListener('click', () => {
        hideLoadingOverlay();
        showFeedback('已取消分析', 'info');
    });
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
            showFeedback('已从手机端清除', 'info');
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
    // Flush any pending JD edits on unload: the input debounces saves by
    // ~600ms, so a refresh/close right after typing would lose the last
    // keystrokes. Force-save synchronously before the page tears down.
    window.addEventListener('beforeunload', () => {
        if (typeof flushJdInputNow === 'function') flushJdInputNow();
    });
    setupSessionContextPanel();
    setupInterviewerProgressListener();
    setupPipelineStudio();
    setupVolcModelPicker();
    populateInterviewSampleOptions();
    // Components are mounted now, so reflect any persisted resume/JD from the
    // settings we loaded above (loadShortcutConfig runs before the components
    // exist, so the reflection has to happen here).
    reflectPersistedContext(settings);
    // Restore the most recent interview so its chat history shows on launch and
    // new activity continues it — without this, activeSessionId is in-memory only,
    // so every app restart starts a blank session and the conversation fragments.
    restoreLatestSession();
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
    showFeedback('已就绪 — 在下方开启一个频道即可开始', 'success');
    addMonitorLog('info', 'init', '渲染器已初始化');
    // Start spotlight tour on first launch
    startSpotlightTour();
    setupReplayTourButton();
}

function updateWindowOpacityValueLabel(value) {
    settingsPanelManager.updateWindowOpacityValueLabel(value);
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

    // Paraformer reuses the DashScope key; Xunfei + Doubao need their own creds.
    if (settings.asrProvider === 'xfyun') {
        hasAsrConfigured = settings.hasXfyunCredentials === true
            || (String(settings.xfyunAppId ?? '').trim().length > 0
                && String(settings.xfyunApiKey ?? '').trim().length > 0);
    } else if (settings.asrProvider === 'volc') {
        hasAsrConfigured = String(settings.volcAppId ?? '').trim().length > 0
            && String(settings.volcAccessToken ?? '').trim().length > 0;
    } else {
        hasAsrConfigured = hasAiConfigured;
    }

    paintAsrIndicator(settings.asrProvider);
}

// Topbar pill showing which speech-to-text engine is active.
const ASR_PROVIDER_NAMES = { paraformer: 'Paraformer', xfyun: '讯飞', volc: '豆包' };
function paintAsrIndicator(provider) {
    const el = document.getElementById('asr-indicator');
    const label = document.getElementById('asr-indicator-label');
    const key = ['paraformer', 'xfyun', 'volc'].includes(provider) ? provider : 'paraformer';
    if (el) { el.dataset.asr = key; el.setAttribute('title', `语音转文字：${ASR_PROVIDER_NAMES[key]}`); }
    if (label) label.textContent = ASR_PROVIDER_NAMES[key];
}

// Track the interviewer mode from settings so the topbar pill + new-session
// `mode` stay in sync with what the backend orchestrator will actually run.
const MODE_LABELS = { fast: '快速', expert: 'Expert 1.0', expert2: 'Expert 2.0', customize: '自定义' };
function applyInterviewerModeFromSettings(settings) {
    const m = settings && settings.interviewerMode;
    interviewerMode = ['expert', 'expert2', 'customize'].includes(m) ? m : 'fast';
    if (settings && typeof settings.activePipelineId === 'string') activePipelineId = settings.activePipelineId;
    paintModeIndicator();
    if (customizeRowEl) customizeRowEl.classList.toggle('is-visible', interviewerMode === 'customize');
    if (interviewerMode === 'customize') refreshCustomizePicker();
}

function paintModeIndicator() {
    if (modeIndicatorEl) {
        modeIndicatorEl.dataset.mode = interviewerMode;
        modeIndicatorEl.setAttribute('title', `面试官模式：${MODE_LABELS[interviewerMode] || '快速'}`);
    }
    if (modeIndicatorLabel) {
        modeIndicatorLabel.textContent = MODE_LABELS[interviewerMode] || '快速';
    }
}

// Reflect the live capture state in the topbar ● REC pill. Driven off the
// transcription source-status object the manager mutates in place.
function paintRecIndicator() {
    if (!recIndicatorEl) return;
    const statuses = transcriptionManager?.sourceStatuses || {};
    const values = Object.values(statuses);
    let state = 'idle';
    let label = '空闲';
    if (values.includes('listening')) {
        state = 'live';
        label = '录音中';
    } else if (values.includes('connecting')) {
        state = 'connecting';
        label = '连接中';
    }
    recIndicatorEl.dataset.state = state;
    if (recIndicatorLabel) recIndicatorLabel.textContent = label;
    // Reflect recording state for screen readers. The element is an aria-live
    // region, so updating aria-label announces the state change aloud.
    const ariaLabel = state === 'live' ? '正在录音'
        : state === 'connecting' ? '正在连接'
        : '未录音';
    recIndicatorEl.setAttribute('aria-label', ariaLabel);
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
                `已裁剪 ${dropped} 条较早的上下文消息以保持在 ${budget} 字符以内`
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

    const stateText = message.includeInAi ? '已纳入' : '已排除';
    addMonitorLog('info', 'ai-context-toggle', `消息${stateText} AI 上下文`, null, {
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
        showFeedback('语音识别凭据缺失。请在设置中添加。', 'error');
        return;
    }

    return transcriptionManager.toggleMasterTranscription();
}

// Screenshot functions
async function takeStealthScreenshot() {
    try {
        showFeedback('正在截图...', 'info');
        await window.electronAPI.takeStealthScreenshot();
    } catch (error) {
        console.error('Screenshot error:', error);
        showFeedback('截图失败', 'error');
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
        showFeedback('DashScope API 密钥缺失。请在设置中添加。', 'error');
        return;
    }

    if (!window.electronAPI?.askAiWithSessionContext) {
        showFeedback('功能不可用', 'error');
        return;
    }

    const payload = buildAskAiContextPayload();
    if (!payload.contextString && payload.enabledScreenshotIds.length === 0) {
        showFeedback('暂无可用的转录或截图', 'error');
        return;
    }

    await runAiActionWithLock('askAi', async () => {
        const stream = createStreamHandler('askAi');
        try {
            setAnalyzing(true);
            showLoadingOverlay('正在分析完整会话上下文...');
            stream.start('**最佳下一步回答：**\n\n');

            const result = await window.electronAPI.askAiWithSessionContext(payload);

            if (result?.success && result?.text) {
                const heading = result.usedScreenshots
                    ? '**最佳下一步回答（转录 + 截图）：**'
                    : '**最佳下一步回答（转录）：**';
                stream.finalize(`${heading}\n\n${result.text}`);
                showFeedback('Ask AI 已就绪', 'success');
            } else {
                throw new Error(result?.error || 'Ask AI 失败');
            }
        } catch (error) {
            console.error('Ask AI error:', error);
            showFeedback('Ask AI 失败', 'error');
            addChatMessage('system', `错误：${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
            hideLoadingOverlay();
        }
    });
}

async function analyzeScreenshotsOnly() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API 密钥缺失。请在设置中添加。', 'error');
        return;
    }

    const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
    if (bundle.enabledScreenshotIds.length === 0) {
        showFeedback('没有可分析的已启用截图', 'error');
        return;
    }

    await runAiActionWithLock('screenAi', async () => {
        const stream = createStreamHandler('screenAi');
        activeScreenAiStream = stream;
        try {
            setAnalyzing(true);
            showLoadingOverlay('正在分析截图...');
            stream.start('');

            await window.electronAPI.analyzeStealthWithContext({
                contextString: bundle.contextString,
                enabledScreenshotIds: bundle.enabledScreenshotIds
            });
        } catch (error) {
            console.error('Analysis error:', error);
            showFeedback('分析失败', 'error');
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
        showFeedback('已清除', 'success');
    } catch (error) {
        console.error('Clear error:', error);
        showFeedback('清除失败', 'error');
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

let closeConfirmationFocusTrapCleanup = null;
let closeConfirmationFocusReturnEl = null;
function openCloseConfirmation() {
    if (!closeConfirmationDialog) {
        closeApplication();
        return;
    }

    closeConfirmationFocusReturnEl = document.activeElement;
    isCloseConfirmationOpen = true;
    closeConfirmationDialog.classList.remove('hidden');
    // Trap focus inside the dialog (focuses the first button + wraps Tab).
    closeConfirmationFocusTrapCleanup?.();
    closeConfirmationFocusTrapCleanup = trapFocus(closeConfirmationDialog);
}

function closeCloseConfirmation() {
    if (!closeConfirmationDialog) {
        return;
    }

    isCloseConfirmationOpen = false;
    closeConfirmationDialog.classList.add('hidden');
    // Release the focus trap before restoring focus.
    closeConfirmationFocusTrapCleanup?.();
    closeConfirmationFocusTrapCleanup = null;
    (closeConfirmationFocusReturnEl || closeAppBtn)?.focus();
    closeConfirmationFocusReturnEl = null;
}

// ── Clear-session confirmation dialog ────────────────────────────────────────
// "清空会话" now asks for confirmation before actually clearing the transcript
// and context. Mirrors openCloseConfirmation / closeCloseConfirmation above.
let isClearConfirmationOpen = false;
let clearConfirmationFocusTrapCleanup = null;
let clearConfirmationFocusReturnEl = null;

function openClearConfirmation() {
    if (!clearConfirmationDialog) {
        // No dialog available — fall back to clearing directly.
        clearStealthData().catch((error) => {
            console.error('Clear session error:', error);
        });
        return;
    }

    clearConfirmationFocusReturnEl = document.activeElement;
    isClearConfirmationOpen = true;
    clearConfirmationDialog.classList.remove('hidden');
    // Trap focus inside the dialog (focuses the first button + wraps Tab).
    clearConfirmationFocusTrapCleanup?.();
    clearConfirmationFocusTrapCleanup = trapFocus(clearConfirmationDialog);
}

function closeClearConfirmation() {
    if (!clearConfirmationDialog) {
        isClearConfirmationOpen = false;
        return;
    }

    isClearConfirmationOpen = false;
    clearConfirmationDialog.classList.add('hidden');
    // Release the focus trap before restoring focus.
    clearConfirmationFocusTrapCleanup?.();
    clearConfirmationFocusTrapCleanup = null;
    (clearConfirmationFocusReturnEl || clearBtn)?.focus();
    clearConfirmationFocusReturnEl = null;
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
        showFeedback('DashScope API 密钥缺失。请在设置中添加。', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.suggestResponse) {
        showFeedback('功能不可用', 'error');
        return;
    }

    await runAiActionWithLock('suggest', async () => {
        const stream = createStreamHandler('suggest');
        try {
            showFeedback('正在生成建议...', 'info');
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            const transcriptOnlyContext = String(bundle.transcriptContext || '').trim();
            if (!transcriptOnlyContext) {
                showFeedback('暂无可用于生成建议的已启用转录上下文', 'error');
                return;
            }

            stream.start('\u{1F4A1} **我该说什么？**\n\n');

            const result = await window.electronAPI.suggestResponse({
                context: bundle.sessionSummary || '当前会议对话',
                contextString: transcriptOnlyContext
            });

            if (result.success && result.suggestions) {
                stream.finalize(`\u{1F4A1} **我该说什么？**\n\n${result.suggestions}`);
                showFeedback('建议已生成', 'success');
            } else {
                throw new Error(result.error || '生成建议失败');
            }
        } catch (error) {
            console.error('Error getting suggestions:', error);
            showFeedback('生成建议失败', 'error');
            addChatMessage('system', `错误：${error.message}`);
        } finally {
            stream.cleanup();
        }
    });
}

async function generateMeetingNotes() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API 密钥缺失。请在设置中添加。', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.generateMeetingNotes) {
        showFeedback('功能不可用', 'error');
        return;
    }

    await runAiActionWithLock('notes', async () => {
        const stream = createStreamHandler('notes');
        try {
            showFeedback('正在生成会议纪要...', 'info');
            setAnalyzing(true);
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            if (!bundle.contextString) {
                showFeedback('暂无可用于生成纪要的已启用上下文', 'error');
                return;
            }

            stream.start('\u{1F4DD} **会议纪要**\n\n');

            const result = await window.electronAPI.generateMeetingNotes({
                contextString: bundle.contextString
            });

            if (result.success && result.notes) {
                stream.finalize(`\u{1F4DD} **会议纪要**\n\n${result.notes}`);
                showFeedback('会议纪要已生成', 'success');
            } else {
                throw new Error(result.error || '生成纪要失败');
            }
        } catch (error) {
            console.error('Error generating notes:', error);
            showFeedback('生成纪要失败', 'error');
            addChatMessage('system', `错误：${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
        }
    });
}

async function getConversationInsights() {
    if (!hasAiConfigured) {
        showFeedback('DashScope API 密钥缺失。请在设置中添加。', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.getConversationInsights) {
        showFeedback('功能不可用', 'error');
        return;
    }

    await runAiActionWithLock('insights', async () => {
        const stream = createStreamHandler('insights');
        try {
            showFeedback('正在分析对话...', 'info');
            setAnalyzing(true);
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            if (!bundle.contextString) {
                showFeedback('暂无可用于生成洞察的已启用上下文', 'error');
                return;
            }

            stream.start('\u{1F4CA} **对话洞察**\n\n');

            const result = await window.electronAPI.getConversationInsights({
                contextString: bundle.contextString
            });

            if (result.success && result.insights) {
                stream.finalize(`\u{1F4CA} **对话洞察**\n\n${result.insights}`);
                showFeedback('洞察已生成', 'success');
            } else {
                throw new Error(result.error || '获取洞察失败');
            }
        } catch (error) {
            console.error('Error getting insights:', error);
            showFeedback('获取洞察失败', 'error');
            addChatMessage('system', `错误：${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
        }
    });
}

// SETTINGS FUNCTIONS

// Focus trap state for the settings panel. The actual .hidden toggle lives in
// the settings-panel-manager (it also runs an exit animation on close), so the
// trap is installed/released here around the manager's open/close calls. The
// panel is a large form, so trapping Tab inside it is the key accessibility win.
let settingsFocusTrapCleanup = null;
let settingsFocusReturnEl = null;

async function openSettings() {
    settingsFocusReturnEl = document.activeElement;
    await settingsPanelManager.openSettings();
    // The manager just removed .hidden (display restored) — now safe to trap.
    // Defer to the next frame so the panel's layout is ready before we focus.
    settingsFocusTrapCleanup?.();
    requestAnimationFrame(() => {
        if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
            settingsFocusTrapCleanup = trapFocus(settingsPanel);
        }
    });
}

function closeSettings() {
    settingsPanelManager.closeSettings();
    // The manager plays a short exit animation before adding .hidden back, but
    // we release the trap immediately so Tab can't escape during that window.
    settingsFocusTrapCleanup?.();
    settingsFocusTrapCleanup = null;
    (settingsFocusReturnEl || settingsBtn)?.focus();
    settingsFocusReturnEl = null;
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
// Ctrl/Cmd+B toggles the right rail (parity with the web app). Ignored when a
// modifier combo other than Ctrl/Cmd is held, and when focus is inside an input
// field so it never hijacks normal text editing.
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey && !e.altKey) {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) {
            return;
        }
        e.preventDefault();
        toggleRailBtn?.click();
    }
});
// "?" key = Shift+/ — triggers the spotlight tour from anywhere (parity with the
// web app). Ignored inside form fields so it never hijacks normal text entry.
document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) {
        e.preventDefault();
        import('./tour.js').then(({ resetTour, startTour }) => {
            resetTour();
            startTour();
        });
    }
});
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
        // Honour the .is-zero / data-count="0" CSS opt-in (styles.css): the
        // counter pill fades to 0.3 opacity when there's nothing to count.
        screenshotCount.setAttribute('data-count', String(screenshotsCount));
        screenshotCount.classList.toggle('is-zero', screenshotsCount <= 0);
    }

    // Show the chat-empty-state placeholder only while the transcript is empty;
    // hide it as soon as the first message lands so it never overlaps real
    // chat content.
    const emptyState = document.getElementById('chat-empty-state');
    if (emptyState) {
        emptyState.style.display = (chatMessagesArray.length === 0) ? 'flex' : 'none';
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

let feedbackTimer = null;
function showFeedback(message, type = 'info') {
    console.log(`Feedback (${type}):`, message);

    if (statusText) {
        statusText.textContent = message;
        statusText.className = `status-text ${type} show`;
        statusText.style.display = 'block';

        // Clear any prior toast timer before scheduling a new one so rapid
        // successive calls don't stack/overlap (the latest toast wins).
        if (feedbackTimer) clearTimeout(feedbackTimer);
        // Duration scales with message length so a short hint dismisses quickly
        // while a long error stays readable: ~60ms per char, floor 2s.
        const duration = Math.max(2000, (message || '').length * 60);
        feedbackTimer = setTimeout(() => {
            statusText.classList.remove('show');
            feedbackTimer = setTimeout(() => {
                statusText.style.display = 'none';
                feedbackTimer = null;
            }, 300);
        }, duration);
    }
}

// Loading-overlay wait timer. Started when the overlay is shown and cleared
// when hidden — updates #loading-timer's "已等待 N 秒…" text every second so the
// user has a live progress signal during a long screen analysis.
let loadingTimerInterval = null;
function startLoadingTimer() {
    const timerEl = document.getElementById('loading-timer');
    let seconds = 0;
    if (timerEl) timerEl.textContent = '已等待 0 秒…';
    if (loadingTimerInterval) clearInterval(loadingTimerInterval);
    loadingTimerInterval = setInterval(() => {
        seconds += 1;
        if (timerEl) timerEl.textContent = `已等待 ${seconds} 秒…`;
    }, 1000);
}
function stopLoadingTimer() {
    if (loadingTimerInterval) {
        clearInterval(loadingTimerInterval);
        loadingTimerInterval = null;
    }
}

function showLoadingOverlay(message = '正在分析屏幕...') {
    if (loadingOverlay) {
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            // textContent (not innerHTML) — message can originate from AI/error strings
            loadingTextElement.textContent = message;
        }
        loadingOverlay.classList.remove('hidden');
        startLoadingTimer();
    }
}

function hideLoadingOverlay() {
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.textContent = '正在分析屏幕...';
        }
    }
    stopLoadingTimer();
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
        throw new Error('写入剪贴板失败');
    }
}

async function copyChatMessageById(messageId) {
    const message = messageStore.findById(messageId);
    const content = String(message?.content || '');

    if (!content.trim()) {
        showFeedback('没有可复制的内容', 'error');
        return;
    }

    try {
        await writeTextToClipboard(content);
        showFeedback('消息已复制', 'success');
    } catch (error) {
        console.error('Message copy error:', error);
        showFeedback('复制失败', 'error');
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
        isCloseConfirmationOpen: () => isCloseConfirmationOpen,
        clearConfirmationDialog,
        cancelClearSessionBtn,
        confirmClearSessionBtn,
        isClearConfirmationOpen: () => isClearConfirmationOpen,
        chatMessagesElement,
        suggestBtn,
        notesBtn,
        insightsBtn,
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
        // clearStealthData is invoked only after the clear-session confirmation
        // is accepted (openClearConfirmation falls back to it when no dialog).
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
        openClearConfirmation,
        closeClearConfirmation,
        closeApplication,
        toggleChatMessageInclusion,
        getResponseSuggestions,
        generateMeetingNotes,
        getConversationInsights,
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

// ── Spotlight tour / 新手引导 ──
// Tour engine is in tour.js (loaded as module before renderer.js).
// Start it after init() so all DOM elements are ready.
function startSpotlightTour() {
    try {
        import('./tour.js').then(({ startTourIfNeeded }) => {
            setTimeout(() => startTourIfNeeded(), 800);
        });
    } catch (e) {
        console.warn('Tour module not available:', e);
    }
}

// Replay tour from settings button
function setupReplayTourButton() {
    const btn = document.getElementById('replay-tour-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        // Close settings panel first — go through closeSettings() so the focus
        // trap is released and focus is restored (rather than toggling .hidden
        // directly, which would leave the trap listener dangling).
        closeSettings();
        // Reset and start tour
        import('./tour.js').then(({ resetTour, startTour }) => {
            resetTour();
            setTimeout(() => startTour(), 300);
        });
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}





