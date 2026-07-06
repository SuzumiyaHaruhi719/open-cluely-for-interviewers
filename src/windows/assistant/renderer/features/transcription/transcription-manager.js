const MAX_MONITOR_LOG_ENTRIES = 80;

function friendlyError(error) {
  const name = error?.name || '';
  const msg = error?.message || String(error);
  if (name === 'NotAllowedError' || /permission/i.test(msg))
    return '麦克风权限被拒绝。请在系统设置 → 隐私 → 麦克风中允许此应用。';
  if (name === 'NotFoundError' || /not found|notfound/i.test(msg))
    return '未找到所选音频设备。请刷新设备列表或选择默认设备。';
  if (name === 'NotReadableError' || /in use|occupied|not readable/i.test(msg))
    return '设备被其他应用占用。请关闭其他录音软件后重试。';
  return `音频采集失败：${msg}`;
}

export function createTranscriptionManager({
    transcriptionSourceState,
    normalizeSourceRule,
    sourceLabelRule,
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
    addChatMessage,
    updateChatMessageContent,
    showFeedback,
    isAutoScrollEnabled = () => true,
    isChatNearBottom = () => true,
    getSelectedMicDeviceId = () => '',
    getSelectedSystemSourceSelection = () => ({ type: 'default', id: null })
}) {
    // Per-source state for the in-progress "live" transcript bubble. Until
    // the merge window flushes (or maxBufferChars triggers), all partials
    // and finals for one continuous speech burst update the SAME chat
    // message in place — no ephemeral div removed at sentence_end, no
    // multi-second blank gap before the merged bubble lands.
    const activeLive = {
        mic: { messageId: null, accumText: '' },
        system: { messageId: null, accumText: '' }
    };

    function isCjk(ch) {
        if (!ch) return false;
        const code = ch.codePointAt(0);
        return (code >= 0x3400 && code <= 0x9FFF)
            || (code >= 0xF900 && code <= 0xFAFF)
            || (code >= 0x3040 && code <= 0x30FF)
            || (code >= 0xAC00 && code <= 0xD7AF);
    }

    function joinForDisplay(left, right) {
        if (!left) return right;
        if (!right) return left;
        if (isCjk(left.slice(-1)) && isCjk(right.slice(0, 1))) {
            return `${left}${right}`;
        }
        return `${left} ${right}`;
    }

    function renderLiveBubble(source, fullText) {
        const state = activeLive[source];
        const text = String(fullText || '').trim();
        if (!text) return;

        if (state.messageId && typeof updateChatMessageContent === 'function') {
            updateChatMessageContent(state.messageId, text);
            if (isAutoScrollEnabled() && isChatNearBottom() && chatMessagesElement) {
                chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
            }
            return;
        }

        const messageType = source === 'system' ? 'voice-system' : 'voice-mic';
        const record = addChatMessage(messageType, text);
        if (record?.id) {
            state.messageId = record.id;
        }
    }

    function setActiveAccumText(source, text) {
        // Called from the buffer manager's onBuffer (every queued final).
        // text here is the canonical merged buffer text — supersedes any
        // partial text the bubble was showing.
        activeLive[source].accumText = String(text || '');
        renderLiveBubble(source, activeLive[source].accumText);
    }

    function commitActiveLive(source) {
        // Called on merge-flush. The bubble already shows the final merged
        // text (last setActiveAccumText). Just release the reference so the
        // next partial/final starts a brand-new bubble.
        activeLive[source] = { messageId: null, accumText: '' };
    }

    function resetActiveLive(source) {
        // Called on error / source-stop. Drop the reference; the bubble
        // (if any) becomes a normal finalised message.
        activeLive[source] = { messageId: null, accumText: '' };
    }
    let micAudioContext = null;
    let micMediaStream = null;
    let micScriptProcessor = null;
    let isMicActive = false;

    let systemAudioContext = null;
    let systemMediaStream = null;
    let systemScriptProcessor = null;
    let isSystemActive = false;

    // micPartialDiv / systemPartialDiv used to be ephemeral DOM nodes that
    // were removed at sentence_end — replaced by persistent live chat
    // messages (see activeLive + renderLiveBubble below).

    const selectedSources = transcriptionSourceState.selectedSources;
    const sourceStatuses = transcriptionSourceState.sourceStatuses;
    const monitorLogEntries = [];
    const monitorLastText = {
        system: '暂无转写',
        mic: '暂无转写'
    };

    function normalizeSource(source) {
        return normalizeSourceRule(source);
    }

    function sourceLabel(source) {
        return sourceLabelRule(normalizeSource(source));
    }

    function isSourceActive(source) {
        return source === 'system' ? isSystemActive : isMicActive;
    }

    function setMicActive(active) {
        isMicActive = !!active;
        transcriptionSourceState.setSourceActive('mic', isMicActive);
    }

    function setSystemActive(active) {
        isSystemActive = !!active;
        transcriptionSourceState.setSourceActive('system', isSystemActive);
    }

    function isAnyTranscriptionActive() {
        return isSystemActive || isMicActive;
    }

    function isAnySourceConnecting() {
        return transcriptionSourceState.isAnySourceConnecting();
    }

    function setSourceStatus(source, status, liveText) {
        const resolvedSource = normalizeSource(source);
        transcriptionSourceState.setSourceStatus(resolvedSource, status);

        if (typeof liveText === 'string' && liveText.trim().length > 0) {
            monitorLastText[resolvedSource] = liveText.trim();
        }

        renderMonitorState();
    }

    function updateTranscriptionUI() {
        const anyActive = isAnyTranscriptionActive();
        const anyConnecting = !anyActive && isAnySourceConnecting();

        if (transcriptionToggle) {
            transcriptionToggle.classList.toggle('active', anyActive);
            transcriptionToggle.classList.toggle('listening', anyActive);
            transcriptionToggle.classList.toggle('connecting', anyConnecting);
        }

        if (sourceSystemToggle) {
            sourceSystemToggle.classList.toggle('selected', selectedSources.system);
            sourceSystemToggle.classList.toggle('running', isSystemActive);
        }

        if (sourceMicToggle) {
            sourceMicToggle.classList.toggle('selected', selectedSources.mic);
            sourceMicToggle.classList.toggle('running', isMicActive);
        }
    }

    function renderMonitorState() {
        updateTranscriptionUI();

        const statusMap = {
            off: '关闭',
            connecting: '连接中',
            listening: '监听中',
            error: '错误'
        };

        if (monitorStatusSystem) {
            monitorStatusSystem.dataset.state = sourceStatuses.system;
            monitorStatusSystem.setAttribute('aria-label', `主机: ${statusMap[sourceStatuses.system] || '关闭'}`);
            monitorStatusSystem.setAttribute('title', `主机: ${statusMap[sourceStatuses.system] || '关闭'}`);
        }

        if (monitorStatusMic) {
            monitorStatusMic.dataset.state = sourceStatuses.mic;
            monitorStatusMic.setAttribute('aria-label', `麦克风: ${statusMap[sourceStatuses.mic] || '关闭'}`);
            monitorStatusMic.setAttribute('title', `麦克风: ${statusMap[sourceStatuses.mic] || '关闭'}`);
        }

        if (monitorLiveSystem) {
            monitorLiveSystem.textContent = monitorLastText.system || '暂无转写';
        }

        if (monitorLiveMic) {
            monitorLiveMic.textContent = monitorLastText.mic || '暂无转写';
        }

        if (monitorMasterState) {
            monitorMasterState.classList.remove('active', 'connecting');
            if (isAnyTranscriptionActive()) {
                monitorMasterState.textContent = '运行中';
                monitorMasterState.classList.add('active');
            } else if (isAnySourceConnecting()) {
                monitorMasterState.textContent = '连接中';
                monitorMasterState.classList.add('connecting');
            } else {
                monitorMasterState.textContent = '空闲';
            }
        }
    }

    function formatMonitorTime(timestamp = Date.now()) {
        return new Date(timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function safeJson(value) {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return '';
        }
    }

    function addMonitorLog(level, event, message, source = null, meta = null, timestamp = Date.now()) {
        const entry = {
            level: level || 'info',
            event: event || 'event',
            message: message || '',
            source: source ? normalizeSource(source) : null,
            meta,
            timestamp
        };

        monitorLogEntries.push(entry);
        if (monitorLogEntries.length > MAX_MONITOR_LOG_ENTRIES) {
            monitorLogEntries.shift();
        }

        if (!monitorLogList) {
            return;
        }

        monitorLogList.innerHTML = '';
        const entriesToRender = [...monitorLogEntries].reverse();
        for (const item of entriesToRender) {
            const row = document.createElement('div');
            const isError = item.level === 'error';
            row.className = `monitor-log-entry ${isError ? 'error' : ''}`.trim();

            const sourcePrefix = item.source ? `${sourceLabel(item.source)} ` : '';
            // Meta is rendered for error-level entries only — info/debug logs stay
            // terse so the feed doesn't drown in JSON noise. Wrapped in a styled
            // .monitor-log-meta span (opacity 0.4, mono, 10px) so it recedes.
            row.textContent = `${formatMonitorTime(item.timestamp)} ${sourcePrefix}${item.event}: ${item.message}`;
            if (isError && item.meta) {
                const metaSpan = document.createElement('span');
                metaSpan.className = 'monitor-log-meta';
                metaSpan.textContent = ` ${safeJson(item.meta)}`;
                row.appendChild(metaSpan);
            }
            monitorLogList.appendChild(row);
        }
    }

    function resetFinalTranscriptBuffer(source) {
        transcriptBufferManager.resetFinalTranscriptBuffer(source);
    }

    function flushFinalTranscript(source, reason = 'pause-timeout') {
        transcriptBufferManager.flushFinalTranscript(source, reason);
    }

    function queueFinalTranscript(source, text, emotion) {
        transcriptBufferManager.queueFinalTranscript(source, text, emotion);
    }

    function flushAllFinalTranscripts(reason = 'flush-all') {
        transcriptBufferManager.flushAllFinalTranscripts(reason);
    }

    function setSourceSelected(source, enabled) {
        const resolvedSource = normalizeSource(source);
        transcriptionSourceState.setSourceSelected(resolvedSource, enabled);
        addMonitorLog('info', 'source-toggle', `${sourceLabel(resolvedSource)} ${enabled ? '已启用' : '已停用'}`, resolvedSource);
        updateTranscriptionUI();

        if (isAnyTranscriptionActive() || sourceStatuses[resolvedSource] === 'connecting') {
            ensureSourceRunning(resolvedSource, !!enabled).catch((error) => {
                console.error(`Failed to apply live source toggle for ${resolvedSource}:`, error);
                addMonitorLog('error', 'source-toggle-failed', error.message, resolvedSource);
            });
        }
    }

    async function ensureSourceRunning(source, shouldRun) {
        const resolvedSource = normalizeSource(source);
        if (shouldRun) {
            if (resolvedSource === 'system') {
                await startSystemAudioRecording();
            } else {
                await startMicRecording();
            }
        } else if (resolvedSource === 'system') {
            await stopSystemAudioRecording();
        } else {
            await stopMicRecording();
        }
    }

    async function startSelectedSources() {
        if (!selectedSources.system && !selectedSources.mic) {
            const message = '开始转写前请至少选择一个音源（Host 或 Mic）。';
            showFeedback(message, 'error');
            addMonitorLog('error', 'start-blocked', message);
            return;
        }

        addMonitorLog('info', 'master-start', '正在启动所选转写音源');

        if (selectedSources.system) {
            await ensureSourceRunning('system', true);
        }

        if (selectedSources.mic) {
            await ensureSourceRunning('mic', true);
        }
    }

    async function stopAllSources() {
        addMonitorLog('info', 'master-stop', '正在停止所有活动转写音源');
        if (isSystemActive || sourceStatuses.system === 'connecting') {
            await stopSystemAudioRecording();
        }
        if (isMicActive || sourceStatuses.mic === 'connecting') {
            await stopMicRecording();
        }
    }

    async function toggleMasterTranscription() {
        if (isAnyTranscriptionActive() || isAnySourceConnecting()) {
            await stopAllSources();
        } else {
            await startSelectedSources();
        }
        updateTranscriptionUI();
    }

    function isLikelyCameraTrack(trackLabel) {
        return audioPipeline.isLikelyCameraTrack(trackLabel);
    }

    async function getSystemAudioStream(sourceId) {
        return audioPipeline.getSystemAudioStream(sourceId);
    }

    async function captureDefaultScreenLoopback(preferredSourceId) {
        // macOS hard-fail: Chromium's chromeMediaSource:'desktop' path is
        // Windows-only for audio. On Mac the stream comes back with either no
        // audio track at all OR a track that's permanently silent, so we
        // either crash early or feed empty PCM to the ASR server which then
        // responds with the cryptic "no valid audio" message.
        //
        // The only working macOS path is a virtual loopback INPUT device
        // (BlackHole / Aggregate). We surface that directly so the user knows
        // exactly what to do instead of decoding an opaque server error.
        const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent || '');
        if (isMac) {
            throw new Error(
                'macOS 无法通过 desktop loopback 捕获系统音频（Chromium 限制）。'
                + '请在「设置 → 系统音源」中选择一个「Virtual loopback (capture-ready)」条目，例如 '
                + '「BlackHole 2ch」或「Blackhole Audio Input (Aggregate)」。然后确保会议音频'
                + '确实通过该设备播放——通常需在 /Applications/Utilities/Audio MIDI Setup.app '
                + '中设置一个 Multi-Output Device。'
            );
        }

        const sources = await window.electronAPI.getDesktopSources();
        if (!sources || sources.length === 0) {
            throw new Error('未找到桌面源');
        }
        let chosen = null;
        if (preferredSourceId) {
            chosen = sources.find((source) => source?.id === preferredSourceId) || null;
            if (!chosen) {
                addMonitorLog('warn', 'desktop-source-fallback', `未找到屏幕 ${preferredSourceId}；改用首个可用源`, 'system');
            }
        }
        if (!chosen) chosen = sources[0];
        addMonitorLog('info', 'desktop-source', `使用桌面源：${chosen.name || chosen.id}`, 'system');

        const stream = await getSystemAudioStream(chosen.id);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && isLikelyCameraTrack(videoTrack.label)) {
            throw new Error(`桌面捕获回退到了摄像头源（${videoTrack.label || '未知'}）。`);
        }
        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach((track) => { try { track.stop(); } catch (_) {} });
            throw new Error('桌面捕获未返回音频轨道。请检查系统声音权限，并确认所选源支持音频。');
        }
        return stream;
    }

    function resetSourceSampleQueue(source) {
        audioPipeline.resetSourceSampleQueue(source);
    }

    function drainSourceSampleQueue(source, { flushPartial = false } = {}) {
        audioPipeline.drainSourceSampleQueue(source, { flushPartial });
    }

    async function buildAudioProcessor(context, stream, source, activeCheck) {
        return audioPipeline.buildAudioProcessor(context, stream, source, activeCheck);
    }

    function stopAudioResources(ctx, stream, processor) {
        audioPipeline.stopAudioResources(ctx, stream, processor);
    }

    async function startMicRecording() {
        if (isMicActive || sourceStatuses.mic === 'connecting') return;
        setSourceStatus('mic', 'connecting', '正在连接麦克风...');
        addMonitorLog('info', 'start-request', '正在启动麦克风音源', 'mic');
        resetFinalTranscriptBuffer('mic');

        try {
            const result = await window.electronAPI.startVoiceRecognition('mic');
            if (result && result.error) throw new Error(result.error);

            const selectedMicDeviceId = String(getSelectedMicDeviceId() || '').trim();
            const audioConstraint = {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            };
            if (selectedMicDeviceId) {
                audioConstraint.deviceId = { exact: selectedMicDeviceId };
                addMonitorLog('info', 'mic-device', `使用所选麦克风设备 ${selectedMicDeviceId.slice(0, 8)}…`, 'mic');
            }

            try {
                micMediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
            } catch (deviceError) {
                if (selectedMicDeviceId) {
                    addMonitorLog('warn', 'mic-device-fallback', `所选麦克风不可用（${deviceError.message}）；回退到默认设备`, 'mic');
                    delete audioConstraint.deviceId;
                    micMediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
                } else {
                    throw deviceError;
                }
            }
            micAudioContext = new AudioContext();
            await micAudioContext.resume();
            resetSourceSampleQueue('mic');
            micScriptProcessor = await buildAudioProcessor(micAudioContext, micMediaStream, 'mic', () => isMicActive);

            setMicActive(true);
            addChatMessage('system', '麦克风监听中...');
            showFeedback('麦克风已开启', 'success');
            addMonitorLog('info', 'source-active', '麦克风音源已激活', 'mic');
        } catch (error) {
            console.error('Failed to start mic:', error);
            showFeedback(`麦克风启动失败：${friendlyError(error)}`, 'error');
            addMonitorLog('error', 'source-failed', error.message, 'mic');
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null;
            micMediaStream = null;
            micScriptProcessor = null;
            setMicActive(false);
            resetSourceSampleQueue('mic');
            setSourceStatus('mic', 'error', `麦克风错误：${error.message}`);
            try {
                await window.electronAPI.stopVoiceRecognition('mic');
            } catch (_) {}
        }

        updateTranscriptionUI();
    }

    async function stopMicRecording() {
        if (!isMicActive && sourceStatuses.mic !== 'connecting') return;
        drainSourceSampleQueue('mic', { flushPartial: true });
        flushFinalTranscript('mic', 'stop-request');
        stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
        micAudioContext = null;
        micMediaStream = null;
        micScriptProcessor = null;
        resetActiveLive('mic');
        try {
            await window.electronAPI.stopVoiceRecognition('mic');
        } catch (error) {
            addMonitorLog('error', 'stop-failed', error.message || '停止麦克风音源失败', 'mic');
        }
        setMicActive(false);
        resetSourceSampleQueue('mic');
        audioPipeline.resetChunkCounter('mic');
        setSourceStatus('mic', 'off', '麦克风已停止');
        addMonitorLog('info', 'source-stopped', '麦克风音源已停止', 'mic');
        showFeedback('麦克风已关闭', 'info');
    }

    async function startSystemAudioRecording() {
        if (isSystemActive || sourceStatuses.system === 'connecting') return;
        setSourceStatus('system', 'connecting', '正在连接主机音频...');
        addMonitorLog('info', 'start-request', '正在启动主机音频源', 'system');
        resetFinalTranscriptBuffer('system');

        try {
            const selection = getSelectedSystemSourceSelection() || { type: 'default', id: null };

            const result = await window.electronAPI.startVoiceRecognition('system');
            if (result && result.error) throw new Error(result.error);

            if (selection.type === 'process' && selection.id) {
                // Windows-only: per-process loopback via the application-loopback
                // sidecar. Audio is pumped main-side into asrService directly,
                // so the renderer doesn't build a MediaStream/AudioContext for
                // this branch. We still call startVoiceRecognition above to
                // open the WebSocket; the sidecar fills it.
                if (!window.electronAPI?.startProcessAudio) {
                    addMonitorLog('warn', 'system-source-fallback', '缺少按进程捕获 API；回退到默认 loopback', 'system');
                    systemMediaStream = await captureDefaultScreenLoopback(null);
                } else {
                    addMonitorLog('info', 'system-source', `正在为 PID ${selection.id} 启动按进程捕获`, 'system');
                    const startResult = await window.electronAPI.startProcessAudio(selection.id);
                    if (!startResult || startResult.success === false) {
                        const reason = startResult?.error || '未知';
                        addMonitorLog('warn', 'system-source-fallback', `按进程捕获失败（${reason}）；回退到默认 loopback`, 'system');
                        showFeedback(`按进程捕获失败：${reason}`, 'error');
                        systemMediaStream = await captureDefaultScreenLoopback(null);
                    } else {
                        // No MediaStream — bytes flow main → ASR directly. We
                        // mark a sentinel value so the stop path knows to call
                        // stopProcessAudio instead of stopping a MediaStream.
                        systemMediaStream = '__process_loopback__';
                    }
                }
            } else if (selection.type === 'input' && selection.id) {
                // Capture directly from a virtual loopback input (Stereo Mix,
                // VB-Cable, BlackHole, etc.). The most reliable way to pick a
                // specific source on any platform.
                addMonitorLog('info', 'system-source', `使用 loopback 输入设备 ${String(selection.id).slice(0, 8)}…`, 'system');
                try {
                    systemMediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            deviceId: { exact: selection.id },
                            channelCount: 1,
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false
                        }
                    });
                } catch (deviceError) {
                    addMonitorLog('warn', 'system-source-fallback', `Loopback 输入不可用（${deviceError.message}）；回退到默认屏幕 loopback`, 'system');
                    systemMediaStream = await captureDefaultScreenLoopback(null);
                }
            } else if (selection.type === 'output' && selection.label && window.electronAPI?.setMacosDefaultOutput) {
                // macOS-only path: user picked a real output device (Freebuds,
                // MacBook Pro Speakers, etc.). Chromium can't capture from
                // audiooutput devices directly, so we ask the main process to
                // switch the macOS system default to that device via
                // SwitchAudioSource, then fall through to the default loopback
                // path which follows the system default.
                addMonitorLog('info', 'system-source', `正在将 macOS 默认输出切换为「${selection.label}」`, 'system');
                try {
                    const switchResult = await window.electronAPI.setMacosDefaultOutput(selection.label);
                    if (!switchResult?.success) {
                        const hint = switchResult?.hint ? ` — ${switchResult.hint}` : '';
                        const reason = switchResult?.error || '未知';
                        addMonitorLog('warn', 'system-source-fallback', `无法切换 macOS 输出（${reason}）${hint}；回退到当前默认设备`, 'system');
                        showFeedback(`无法切换输出：${reason}${hint}`, 'error');
                    } else {
                        addMonitorLog('info', 'system-source', `macOS 默认输出当前为：${selection.label}`, 'system');
                    }
                } catch (switchError) {
                    addMonitorLog('warn', 'system-source-fallback', `setMacosDefaultOutput 抛出异常：${switchError.message}`, 'system');
                }
                systemMediaStream = await captureDefaultScreenLoopback(null);
            } else if (selection.type === 'screen' && selection.id) {
                addMonitorLog('info', 'system-source', `使用屏幕源 ${selection.id}`, 'system');
                systemMediaStream = await captureDefaultScreenLoopback(selection.id);
            } else {
                systemMediaStream = await captureDefaultScreenLoopback(null);
            }

            if (systemMediaStream === '__process_loopback__') {
                // Sidecar pumps PCM main-side; no renderer-side audio graph.
                setSystemActive(true);
                addChatMessage('system', `正在捕获 PID ${selection.id} 的音频`);
                showFeedback('按进程捕获已开启', 'success');
                addMonitorLog('info', 'source-active', '按进程捕获已激活', 'system');
            } else {
                systemMediaStream.getVideoTracks().forEach((track) => track.stop());

                systemAudioContext = new AudioContext();
                await systemAudioContext.resume();
                resetSourceSampleQueue('system');
                systemScriptProcessor = await buildAudioProcessor(systemAudioContext, systemMediaStream, 'system', () => isSystemActive);

                setSystemActive(true);
                addChatMessage('system', '正在监听主机音频...');
                showFeedback('系统音频已开启', 'success');
                addMonitorLog('info', 'source-active', '主机音源已激活', 'system');
            }
        } catch (error) {
            console.error('Failed to start system audio:', error);
            showFeedback(`系统音频启动失败：${friendlyError(error)}`, 'error');
            addMonitorLog('error', 'source-failed', error.message, 'system');
            if (systemMediaStream === '__process_loopback__') {
                try { await window.electronAPI?.stopProcessAudio?.(); } catch (_) {}
            } else {
                stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            }
            systemAudioContext = null;
            systemMediaStream = null;
            systemScriptProcessor = null;
            setSystemActive(false);
            resetSourceSampleQueue('system');
            setSourceStatus('system', 'error', `主机错误：${error.message}`);
            try {
                await window.electronAPI.stopVoiceRecognition('system');
            } catch (_) {}
        }

        updateTranscriptionUI();
    }

    async function stopSystemAudioRecording() {
        if (!isSystemActive && sourceStatuses.system !== 'connecting') return;
        drainSourceSampleQueue('system', { flushPartial: true });
        flushFinalTranscript('system', 'stop-request');
        if (systemMediaStream === '__process_loopback__') {
            try { await window.electronAPI?.stopProcessAudio?.(); } catch (error) {
                addMonitorLog('error', 'stop-failed', error.message || '停止按进程捕获失败', 'system');
            }
        } else {
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
        }
        systemAudioContext = null;
        systemMediaStream = null;
        systemScriptProcessor = null;
        resetActiveLive('system');
        try {
            await window.electronAPI.stopVoiceRecognition('system');
        } catch (error) {
            addMonitorLog('error', 'stop-failed', error.message || '停止主机音源失败', 'system');
        }
        setSystemActive(false);
        resetSourceSampleQueue('system');
        audioPipeline.resetChunkCounter('system');
        setSourceStatus('system', 'off', '主机音源已停止');
        addMonitorLog('info', 'source-stopped', '主机音源已停止', 'system');
        showFeedback('系统音频已关闭', 'info');
    }

    function handleVoskPartial(data) {
        const source = normalizeSource(data?.source);
        const text = data?.text;
        if (!text || text.trim().length === 0) return;
        if (!isSourceActive(source)) return;

        const trimmed = text.trim();
        monitorLastText[source] = `实时：${trimmed}`;
        renderMonitorState();

        // Show the merged finals so far (from the buffer) plus the live
        // partial. accumText is updated each time onBuffer fires from the
        // buffer manager (see setActiveAccumText). Between finals we keep
        // the bubble visible, so paraformer's sentence_end no longer
        // produces a blank gap.
        const display = joinForDisplay(activeLive[source].accumText, trimmed);
        renderLiveBubble(source, display);
    }

    function handleVoskFinal(data) {
        const source = normalizeSource(data?.source);
        const text = data?.text;
        if (!text || text.trim().length === 0) return;

        const finalText = text.trim();
        const emotion = data?.emotion && data.emotion.tag ? data.emotion : null;
        monitorLastText[source] = `最终：${finalText}`;
        renderMonitorState();
        addMonitorLog('info', 'final', '已收到最终转写', source, {
            chars: finalText.length,
            emotion: emotion ? `${emotion.tag}/${emotion.confidence ?? '?'}` : null
        });

        // Queue the final — onBuffer fires synchronously inside this call
        // and bumps the visible bubble to the latest merged text via
        // setActiveAccumText. No DOM removal here: the bubble survives
        // sentence_end and keeps showing the running merged content.
        queueFinalTranscript(source, finalText, emotion);
    }

    function handleVoskStatus(data) {
        const source = normalizeSource(data?.source);
        const status = data?.status;
        const message = data?.message || '';
        console.log(`STT status [${source}]:`, status, message);

        if (status === 'loading') {
            setSourceStatus(source, 'connecting', `正在连接（${sourceLabel(source)}）...`);
            showFeedback(`正在连接（${sourceLabel(source)}）...`, 'info');
            addMonitorLog('info', 'status-loading', message || '已请求连接', source);
        } else if (status === 'listening') {
            setSourceStatus(source, 'listening', `监听中（${sourceLabel(source)}）...`);
            showFeedback(`监听中（${sourceLabel(source)}）...`, 'success');
            addMonitorLog('info', 'status-listening', message || '音源监听中', source);
        } else if (status === 'stopped') {
            setSourceStatus(source, 'off', `${sourceLabel(source)} 已停止`);
            showFeedback(`已停止（${sourceLabel(source)}）`, 'info');
            addMonitorLog('info', 'status-stopped', message || '音源已停止', source);
        }
    }

    function handleVoskError(data) {
        const source = normalizeSource(data?.source);
        const error = data?.error || '未知转写错误';
        console.error(`STT error [${source}]:`, error);
        showFeedback(`错误（${sourceLabel(source)}）：${error}`, 'error');
        addChatMessage('system', `转写出错（${sourceLabel(source)}）：${error}`);
        addMonitorLog('error', 'status-error', error, source);
        flushFinalTranscript(source, 'status-error');

        if (source === 'system') {
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            systemAudioContext = null;
            systemMediaStream = null;
            systemScriptProcessor = null;
            resetActiveLive('system');
            setSystemActive(false);
            resetSourceSampleQueue('system');
            resetFinalTranscriptBuffer('system');
        } else {
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null;
            micMediaStream = null;
            micScriptProcessor = null;
            resetActiveLive('mic');
            setMicActive(false);
            resetSourceSampleQueue('mic');
            resetFinalTranscriptBuffer('mic');
        }

        setSourceStatus(source, 'error', `错误：${error}`);
        updateTranscriptionUI();
    }

    function handleVoskStopped(data) {
        const source = normalizeSource(data?.source);
        console.log(`STT stopped [${source}]`);
        flushFinalTranscript(source, 'stopped-event');
        if (source === 'system') {
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            systemAudioContext = null;
            systemMediaStream = null;
            systemScriptProcessor = null;
            resetActiveLive('system');
            setSystemActive(false);
            resetSourceSampleQueue('system');
            resetFinalTranscriptBuffer('system');
        } else {
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null;
            micMediaStream = null;
            micScriptProcessor = null;
            resetActiveLive('mic');
            setMicActive(false);
            resetSourceSampleQueue('mic');
            resetFinalTranscriptBuffer('mic');
        }
        setSourceStatus(source, 'off', `${sourceLabel(source)} 已停止`);
        addMonitorLog('info', 'stopped-event', '后端已确认停止', source);
    }

    return {
        selectedSources,
        sourceStatuses,
        normalizeSource,
        sourceLabel,
        addMonitorLog,
        updateTranscriptionUI,
        renderMonitorState,
        setSourceSelected,
        toggleMasterTranscription,
        ensureSourceRunning,
        flushAllFinalTranscripts,
        handleVoskPartial,
        handleVoskFinal,
        handleVoskStatus,
        handleVoskError,
        handleVoskStopped,
        setActiveAccumText,
        commitActiveLive,
        resetActiveLive
    };
}
