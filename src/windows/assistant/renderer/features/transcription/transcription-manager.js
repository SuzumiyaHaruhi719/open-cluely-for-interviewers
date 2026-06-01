const MAX_MONITOR_LOG_ENTRIES = 80;

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
        system: 'No transcript yet',
        mic: 'No transcript yet'
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
            off: 'Off',
            connecting: 'Connecting',
            listening: 'Listening',
            error: 'Error'
        };

        if (monitorStatusSystem) {
            monitorStatusSystem.dataset.state = sourceStatuses.system;
            monitorStatusSystem.setAttribute('aria-label', `Host: ${statusMap[sourceStatuses.system] || 'Off'}`);
            monitorStatusSystem.setAttribute('title', `Host: ${statusMap[sourceStatuses.system] || 'Off'}`);
        }

        if (monitorStatusMic) {
            monitorStatusMic.dataset.state = sourceStatuses.mic;
            monitorStatusMic.setAttribute('aria-label', `Mic: ${statusMap[sourceStatuses.mic] || 'Off'}`);
            monitorStatusMic.setAttribute('title', `Mic: ${statusMap[sourceStatuses.mic] || 'Off'}`);
        }

        if (monitorLiveSystem) {
            monitorLiveSystem.textContent = monitorLastText.system || 'No transcript yet';
        }

        if (monitorLiveMic) {
            monitorLiveMic.textContent = monitorLastText.mic || 'No transcript yet';
        }

        if (monitorMasterState) {
            monitorMasterState.classList.remove('active', 'connecting');
            if (isAnyTranscriptionActive()) {
                monitorMasterState.textContent = 'Running';
                monitorMasterState.classList.add('active');
            } else if (isAnySourceConnecting()) {
                monitorMasterState.textContent = 'Connecting';
                monitorMasterState.classList.add('connecting');
            } else {
                monitorMasterState.textContent = 'Idle';
            }
        }
    }

    function formatMonitorTime(timestamp = Date.now()) {
        return new Date(timestamp).toLocaleTimeString('en-US', {
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
            row.className = `monitor-log-entry ${item.level === 'error' ? 'error' : ''}`.trim();

            const sourcePrefix = item.source ? `${sourceLabel(item.source)} ` : '';
            const metaText = item.meta ? ` ${safeJson(item.meta)}` : '';
            row.textContent = `${formatMonitorTime(item.timestamp)} ${sourcePrefix}${item.event}: ${item.message}${metaText}`;
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
        addMonitorLog('info', 'source-toggle', `${sourceLabel(resolvedSource)} ${enabled ? 'enabled' : 'disabled'}`, resolvedSource);
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
            const message = 'Select at least one source (Host or Mic) before starting transcription.';
            showFeedback(message, 'error');
            addMonitorLog('error', 'start-blocked', message);
            return;
        }

        addMonitorLog('info', 'master-start', 'Starting selected transcription sources');

        if (selectedSources.system) {
            await ensureSourceRunning('system', true);
        }

        if (selectedSources.mic) {
            await ensureSourceRunning('mic', true);
        }
    }

    async function stopAllSources() {
        addMonitorLog('info', 'master-stop', 'Stopping all active transcription sources');
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
                'macOS can\'t capture system audio through desktop loopback (Chromium limitation). '
                + 'In Settings → System source, pick a "Virtual loopback (capture-ready)" entry such as '
                + '"BlackHole 2ch" or "Blackhole Audio Input (Aggregate)". Then make sure your meeting '
                + 'audio actually plays through that device — usually via a Multi-Output Device set up '
                + 'in /Applications/Utilities/Audio MIDI Setup.app.'
            );
        }

        const sources = await window.electronAPI.getDesktopSources();
        if (!sources || sources.length === 0) {
            throw new Error('No desktop sources found');
        }
        let chosen = null;
        if (preferredSourceId) {
            chosen = sources.find((source) => source?.id === preferredSourceId) || null;
            if (!chosen) {
                addMonitorLog('warn', 'desktop-source-fallback', `Screen ${preferredSourceId} not found; using first available`, 'system');
            }
        }
        if (!chosen) chosen = sources[0];
        addMonitorLog('info', 'desktop-source', `Using desktop source: ${chosen.name || chosen.id}`, 'system');

        const stream = await getSystemAudioStream(chosen.id);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && isLikelyCameraTrack(videoTrack.label)) {
            throw new Error(`Desktop capture fell back to camera source (${videoTrack.label || 'unknown'}).`);
        }
        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach((track) => { try { track.stop(); } catch (_) {} });
            throw new Error('Desktop capture returned no audio track. Check OS sound permissions and that the selected source supports audio.');
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
        setSourceStatus('mic', 'connecting', 'Connecting to mic...');
        addMonitorLog('info', 'start-request', 'Starting mic source', 'mic');
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
                addMonitorLog('info', 'mic-device', `Using selected mic device ${selectedMicDeviceId.slice(0, 8)}…`, 'mic');
            }

            try {
                micMediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
            } catch (deviceError) {
                if (selectedMicDeviceId) {
                    addMonitorLog('warn', 'mic-device-fallback', `Selected mic unavailable (${deviceError.message}); falling back to default`, 'mic');
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
            addChatMessage('system', 'Mic listening...');
            showFeedback('Mic on', 'success');
            addMonitorLog('info', 'source-active', 'Mic source active', 'mic');
        } catch (error) {
            console.error('Failed to start mic:', error);
            showFeedback(`Mic failed: ${error.message}`, 'error');
            addMonitorLog('error', 'source-failed', error.message, 'mic');
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null;
            micMediaStream = null;
            micScriptProcessor = null;
            setMicActive(false);
            resetSourceSampleQueue('mic');
            setSourceStatus('mic', 'error', `Mic error: ${error.message}`);
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
            addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop mic source', 'mic');
        }
        setMicActive(false);
        resetSourceSampleQueue('mic');
        audioPipeline.resetChunkCounter('mic');
        setSourceStatus('mic', 'off', 'Mic stopped');
        addMonitorLog('info', 'source-stopped', 'Mic source stopped', 'mic');
        showFeedback('Mic off', 'info');
    }

    async function startSystemAudioRecording() {
        if (isSystemActive || sourceStatuses.system === 'connecting') return;
        setSourceStatus('system', 'connecting', 'Connecting to host audio...');
        addMonitorLog('info', 'start-request', 'Starting host audio source', 'system');
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
                    addMonitorLog('warn', 'system-source-fallback', 'Per-process capture API missing; falling back to default loopback', 'system');
                    systemMediaStream = await captureDefaultScreenLoopback(null);
                } else {
                    addMonitorLog('info', 'system-source', `Starting per-process capture for PID ${selection.id}`, 'system');
                    const startResult = await window.electronAPI.startProcessAudio(selection.id);
                    if (!startResult || startResult.success === false) {
                        const reason = startResult?.error || 'unknown';
                        addMonitorLog('warn', 'system-source-fallback', `Per-process capture failed (${reason}); falling back to default loopback`, 'system');
                        showFeedback(`Per-process capture failed: ${reason}`, 'error');
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
                addMonitorLog('info', 'system-source', `Using loopback input device ${String(selection.id).slice(0, 8)}…`, 'system');
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
                    addMonitorLog('warn', 'system-source-fallback', `Loopback input unavailable (${deviceError.message}); falling back to default screen loopback`, 'system');
                    systemMediaStream = await captureDefaultScreenLoopback(null);
                }
            } else if (selection.type === 'output' && selection.label && window.electronAPI?.setMacosDefaultOutput) {
                // macOS-only path: user picked a real output device (Freebuds,
                // MacBook Pro Speakers, etc.). Chromium can't capture from
                // audiooutput devices directly, so we ask the main process to
                // switch the macOS system default to that device via
                // SwitchAudioSource, then fall through to the default loopback
                // path which follows the system default.
                addMonitorLog('info', 'system-source', `Switching macOS default output to "${selection.label}"`, 'system');
                try {
                    const switchResult = await window.electronAPI.setMacosDefaultOutput(selection.label);
                    if (!switchResult?.success) {
                        const hint = switchResult?.hint ? ` — ${switchResult.hint}` : '';
                        const reason = switchResult?.error || 'unknown';
                        addMonitorLog('warn', 'system-source-fallback', `Could not switch macOS output (${reason})${hint}; falling back to current default`, 'system');
                        showFeedback(`Could not switch output: ${reason}${hint}`, 'error');
                    } else {
                        addMonitorLog('info', 'system-source', `macOS default output now: ${selection.label}`, 'system');
                    }
                } catch (switchError) {
                    addMonitorLog('warn', 'system-source-fallback', `setMacosDefaultOutput threw: ${switchError.message}`, 'system');
                }
                systemMediaStream = await captureDefaultScreenLoopback(null);
            } else if (selection.type === 'screen' && selection.id) {
                addMonitorLog('info', 'system-source', `Using screen source ${selection.id}`, 'system');
                systemMediaStream = await captureDefaultScreenLoopback(selection.id);
            } else {
                systemMediaStream = await captureDefaultScreenLoopback(null);
            }

            if (systemMediaStream === '__process_loopback__') {
                // Sidecar pumps PCM main-side; no renderer-side audio graph.
                setSystemActive(true);
                addChatMessage('system', `Capturing audio from PID ${selection.id}`);
                showFeedback('Per-process capture on', 'success');
                addMonitorLog('info', 'source-active', 'Per-process capture active', 'system');
            } else {
                systemMediaStream.getVideoTracks().forEach((track) => track.stop());

                systemAudioContext = new AudioContext();
                await systemAudioContext.resume();
                resetSourceSampleQueue('system');
                systemScriptProcessor = await buildAudioProcessor(systemAudioContext, systemMediaStream, 'system', () => isSystemActive);

                setSystemActive(true);
                addChatMessage('system', 'Listening to host audio...');
                showFeedback('System audio on', 'success');
                addMonitorLog('info', 'source-active', 'Host source active', 'system');
            }
        } catch (error) {
            console.error('Failed to start system audio:', error);
            showFeedback(`System audio failed: ${error.message}`, 'error');
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
            setSourceStatus('system', 'error', `Host error: ${error.message}`);
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
                addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop process audio', 'system');
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
            addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop host source', 'system');
        }
        setSystemActive(false);
        resetSourceSampleQueue('system');
        audioPipeline.resetChunkCounter('system');
        setSourceStatus('system', 'off', 'Host source stopped');
        addMonitorLog('info', 'source-stopped', 'Host source stopped', 'system');
        showFeedback('System audio off', 'info');
    }

    function handleVoskPartial(data) {
        const source = normalizeSource(data?.source);
        const text = data?.text;
        if (!text || text.trim().length === 0) return;
        if (!isSourceActive(source)) return;

        const trimmed = text.trim();
        monitorLastText[source] = `Live: ${trimmed}`;
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
        monitorLastText[source] = `Final: ${finalText}`;
        renderMonitorState();
        addMonitorLog('info', 'final', 'Final transcript received', source, {
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
            setSourceStatus(source, 'connecting', `Connecting (${sourceLabel(source)})...`);
            showFeedback(`Connecting (${sourceLabel(source)})...`, 'info');
            addMonitorLog('info', 'status-loading', message || 'Connection requested', source);
        } else if (status === 'listening') {
            setSourceStatus(source, 'listening', `Listening (${sourceLabel(source)})...`);
            showFeedback(`Listening (${sourceLabel(source)})...`, 'success');
            addMonitorLog('info', 'status-listening', message || 'Source listening', source);
        } else if (status === 'stopped') {
            setSourceStatus(source, 'off', `${sourceLabel(source)} stopped`);
            showFeedback(`Stopped (${sourceLabel(source)})`, 'info');
            addMonitorLog('info', 'status-stopped', message || 'Source stopped', source);
        }
    }

    function handleVoskError(data) {
        const source = normalizeSource(data?.source);
        const error = data?.error || 'Unknown transcription error';
        console.error(`STT error [${source}]:`, error);
        showFeedback(`Error (${sourceLabel(source)}): ${error}`, 'error');
        addChatMessage('system', `Transcription error (${sourceLabel(source)}): ${error}`);
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

        setSourceStatus(source, 'error', `Error: ${error}`);
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
        setSourceStatus(source, 'off', `${sourceLabel(source)} stopped`);
        addMonitorLog('info', 'stopped-event', 'Stop acknowledged by backend', source);
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
