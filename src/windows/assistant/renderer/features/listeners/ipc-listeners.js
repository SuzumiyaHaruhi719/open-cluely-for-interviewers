export function setupIpcListeners({
    windowApi,
    setScreenshotsCount,
    updateUi,
    addChatMessage,
    setAnalyzing,
    showLoadingOverlay,
    hideLoadingOverlay,
    showFeedback,
    showEmergencyOverlay,
    transcriptionManager,
    toggleMasterTranscription,
    askAiWithSessionContext,
    isAskAiShortcutEnabled,
    addMonitorLog,
    getActiveScreenAiStream,
    clearActiveScreenAiStream
}) {
    if (!windowApi) {
        console.error('electronAPI not available');
        return;
    }

    windowApi.onScreenshotTakenStealth((count) => {
        const payload = typeof count === 'object' && count !== null ? count : { count };
        setScreenshotsCount(Number(payload.count || 0));
        updateUi();
        addChatMessage('screenshot', 'Screenshot captured', {
            screenshotId: typeof payload.screenshotId === 'string' ? payload.screenshotId : null
        });
        showFeedback('截图已捕获', 'success');
    });

    windowApi.onAnalysisStart(() => {
        setAnalyzing(true);
        showLoadingOverlay();
        const stream = typeof getActiveScreenAiStream === 'function' ? getActiveScreenAiStream() : null;
        if (!stream) {
            addChatMessage('system', 'Analyzing screenshots...');
        }
    });

    windowApi.onAnalysisResult((data) => {
        setAnalyzing(false);
        hideLoadingOverlay();

        const stream = typeof getActiveScreenAiStream === 'function' ? getActiveScreenAiStream() : null;
        console.log('[onAnalysisResult] stream active:', !!stream, 'has error:', !!data.error);
        if (data.error) {
            addChatMessage('system', `Error: ${data.error}`);
            showFeedback('分析失败', 'error');
        } else if (stream) {
            stream.finalize(data.text);
            showFeedback('分析完成', 'success');
        } else {
            console.log('[onAnalysisResult] No active stream - creating new message');
            addChatMessage('ai-response', data.text);
            showFeedback('分析完成', 'success');
        }

        // Clean up the screen AI stream after processing the result
        if (typeof clearActiveScreenAiStream === 'function') {
            clearActiveScreenAiStream();
        }
    });

    windowApi.onSetStealthMode((enabled) => {
        showFeedback(enabled ? 'Stealth mode ON' : 'Stealth mode OFF', 'info');
    });

    windowApi.onEmergencyClear(() => {
        showEmergencyOverlay();
    });

    windowApi.onError((message) => {
        showFeedback(message, 'error');
    });

    windowApi.onVoskStatus((data) => {
        transcriptionManager.handleVoskStatus(data);
    });

    windowApi.onVoskPartial((data) => {
        transcriptionManager.handleVoskPartial(data);
    });

    windowApi.onVoskFinal((data) => {
        transcriptionManager.handleVoskFinal(data);
    });

    windowApi.onVoskError((data) => {
        transcriptionManager.handleVoskError(data);
    });

    windowApi.onVoskStopped((data) => {
        transcriptionManager.handleVoskStopped(data);
    });

    if (windowApi.onToggleVoiceRecognition) {
        windowApi.onToggleVoiceRecognition(() => {
            addMonitorLog('info', 'shortcut-event', 'Global shortcut toggled transcription');
            toggleMasterTranscription().catch((error) => {
                console.error('Global shortcut toggle failed:', error);
                addMonitorLog('error', 'shortcut-toggle-failed', error.message);
            });
        });
    }

    if (windowApi.onTriggerAskAi) {
        windowApi.onTriggerAskAi(() => {
            if (typeof isAskAiShortcutEnabled === 'function' && !isAskAiShortcutEnabled()) {
                addMonitorLog('info', 'shortcut-ask-ai-blocked', 'Global Ask AI shortcut ignored because Ask AI is disabled');
                return;
            }

            addMonitorLog('info', 'shortcut-event', 'Global Ask AI shortcut triggered');
            askAiWithSessionContext().catch((error) => {
                console.error('Global Ask AI trigger failed:', error);
                addMonitorLog('error', 'shortcut-ask-ai-failed', error.message);
            });
        });
    }

    if (windowApi.onSttDebug) {
        windowApi.onSttDebug((data) => {
            const source = data?.source ? transcriptionManager.normalizeSource(data.source) : null;
            addMonitorLog(
                data?.level || 'info',
                data?.event || 'stt-debug',
                data?.message || '',
                source,
                data?.meta || null,
                data?.ts || Date.now()
            );
        });
    }

    window.addEventListener('error', (event) => {
        addMonitorLog('error', 'renderer-error', event?.message || 'Renderer error');
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        const message = typeof reason === 'string'
            ? reason
            : reason?.message || 'Unhandled promise rejection';
        addMonitorLog('error', 'renderer-rejection', message);
    });
}
