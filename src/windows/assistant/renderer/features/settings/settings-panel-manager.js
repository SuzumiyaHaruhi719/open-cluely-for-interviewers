function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export const MIC_DEVICE_STORAGE_KEY = 'open-cluely.audioDevice.mic';
export const SYSTEM_SOURCE_STORAGE_KEY = 'open-cluely.audioDevice.system';

const LOOPBACK_LABEL_PATTERNS = [
    /stereo mix/i,
    /what.{0,3}u.{0,3}hear/i,
    /vb[ -_]?(audio|cable)/i,
    /voicemeeter/i,
    /loopback/i,
    /blackhole/i,
    /soundflower/i,
    /\bmix\b/i
];

function isLikelyLoopbackInput(deviceLabel) {
    const label = String(deviceLabel || '');
    return LOOPBACK_LABEL_PATTERNS.some((pattern) => pattern.test(label));
}

export function getSelectedMicDeviceId() {
    try {
        return localStorage.getItem(MIC_DEVICE_STORAGE_KEY) || '';
    } catch (_) {
        return '';
    }
}

export function getSelectedSystemSourceValue() {
    try {
        return localStorage.getItem(SYSTEM_SOURCE_STORAGE_KEY) || '';
    } catch (_) {
        return '';
    }
}

// Parse a stored system-source value into a structured selector.
// Values:
//   ""              → default system loopback (desktopCapturer, first screen)
//   "input:<id>"    → audioinput device (Stereo Mix, VB-Cable, BlackHole, etc.)
//   "screen:<id>"   → specific desktopCapturer screen
//   "output:<id>::<label>" → macOS audiooutput device. Renderer switches the
//                            macOS system default output to <label> via the
//                            main-process IPC, then falls through to the
//                            default loopback path. No-op on Windows/Linux.
//   "process:<pid>" → Windows-only per-process loopback via the
//                     application-loopback sidecar.
// Anything else is treated as default.
export function parseSystemSourceSelection(rawValue) {
    const value = String(rawValue || '');
    if (!value) {
        return { type: 'default', id: null };
    }
    if (value.startsWith('input:')) {
        return { type: 'input', id: value.slice('input:'.length) };
    }
    if (value.startsWith('screen:')) {
        return { type: 'screen', id: value.slice('screen:'.length) };
    }
    if (value.startsWith('process:')) {
        return { type: 'process', id: value.slice('process:'.length) };
    }
    if (value.startsWith('output:')) {
        const rest = value.slice('output:'.length);
        const sepIndex = rest.indexOf('::');
        if (sepIndex === -1) {
            return { type: 'output', id: rest, label: '' };
        }
        return { type: 'output', id: rest.slice(0, sepIndex), label: rest.slice(sepIndex + 2) };
    }
    return { type: 'default', id: null };
}

// Detect macOS in the renderer. Used to ungrey OS audio outputs and rephrase
// Windows-specific labels in the picker without touching Windows behavior.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent || '');

function setStoredValue(key, value) {
    try {
        if (value) {
            localStorage.setItem(key, value);
        } else {
            localStorage.removeItem(key);
        }
    } catch (_) {
        // localStorage may be unavailable; ignore.
    }
}

export function createSettingsPanelManager({
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
    applySettingsShortcutConfig,
    showFeedback,
    onSettingsSaved
}) {
    function normalizeWindowOpacityLevel(value) {
        const parsedValue = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(parsedValue)) {
            return 10;
        }
        return clamp(parsedValue, 1, 10);
    }

    function updateWindowOpacityValueLabel(value) {
        if (!settingWindowOpacityValue) return;
        settingWindowOpacityValue.textContent = `${normalizeWindowOpacityLevel(value)}/10`;
    }

    function setApiKeyFieldVisibility(inputElement, toggleButton, providerName, visible) {
        if (!inputElement || !toggleButton) return;
        const shouldShow = Boolean(visible);
        inputElement.type = shouldShow ? 'text' : 'password';
        toggleButton.textContent = shouldShow ? 'Hide' : 'Show';
        toggleButton.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
        toggleButton.setAttribute(
            'aria-label',
            `${shouldShow ? 'Hide' : 'Show'} ${providerName} API key`
        );
    }

    function bindApiKeyVisibilityToggle(inputElement, toggleButton, providerName) {
        if (!inputElement || !toggleButton) return;
        setApiKeyFieldVisibility(inputElement, toggleButton, providerName, false);
        toggleButton.addEventListener('click', () => {
            setApiKeyFieldVisibility(inputElement, toggleButton, providerName, inputElement.type !== 'text');
        });
    }

    function updateAsrProviderVisibility(provider) {
        if (paraformerSettingsGroup) {
            paraformerSettingsGroup.classList.toggle('hidden', provider !== 'paraformer');
        }
        if (xfyunSettingsGroup) {
            xfyunSettingsGroup.classList.toggle('hidden', provider !== 'xfyun');
        }
    }

    function bindAsrProviderToggle() {
        if (!settingAsrProvider) return;
        settingAsrProvider.addEventListener('change', () => {
            updateAsrProviderVisibility(settingAsrProvider.value);
        });
    }

    function populateDashscopeAiModelOptions(models, selectedModel) {
        if (!settingDashscopeAiModel) return;
        settingDashscopeAiModel.innerHTML = '';

        const configured = Array.isArray(models) ? models : [];
        if (configured.length === 0) {
            throw new Error('DashScope AI models are not configured.');
        }

        configured.forEach((modelName) => {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            settingDashscopeAiModel.appendChild(option);
        });

        settingDashscopeAiModel.value = configured.includes(selectedModel)
            ? selectedModel
            : configured[0];
    }

    function populateProgrammingLanguageOptions(languages, selectedLanguage) {
        if (!settingProgrammingLanguage) return;
        settingProgrammingLanguage.innerHTML = '';

        const configured = Array.isArray(languages) ? languages : [];
        if (configured.length === 0) {
            throw new Error('Programming languages are not configured.');
        }

        configured.forEach((languageName) => {
            const option = document.createElement('option');
            option.value = languageName;
            option.textContent = languageName;
            settingProgrammingLanguage.appendChild(option);
        });

        settingProgrammingLanguage.value = configured.includes(selectedLanguage)
            ? selectedLanguage
            : configured[0];
    }

    async function enumerateAllDevices() {
        try {
            if (navigator.mediaDevices?.enumerateDevices) {
                return await navigator.mediaDevices.enumerateDevices();
            }
        } catch (error) {
            console.warn('Failed to enumerate audio devices:', error);
        }
        return [];
    }

    async function populateMicDeviceOptions(devices) {
        if (!settingMicDevice) return;

        const savedDeviceId = getSelectedMicDeviceId();
        settingMicDevice.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'System default microphone';
        settingMicDevice.appendChild(defaultOption);

        const audioInputs = (devices || []).filter((device) => device.kind === 'audioinput');
        const seenIds = new Set();

        audioInputs.forEach((device, index) => {
            if (!device.deviceId || device.deviceId === 'default' || device.deviceId === 'communications') {
                return;
            }
            if (seenIds.has(device.deviceId)) return;
            seenIds.add(device.deviceId);

            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Microphone ${index + 1}`;
            settingMicDevice.appendChild(option);
        });

        settingMicDevice.value = savedDeviceId && seenIds.has(savedDeviceId) ? savedDeviceId : '';

        if (audioInputs.length === 0) {
            const helper = document.createElement('option');
            helper.value = '';
            helper.disabled = true;
            helper.textContent = 'No microphones detected — check OS permissions';
            settingMicDevice.appendChild(helper);
        } else if (audioInputs.some((device) => !device.label)) {
            const helper = document.createElement('option');
            helper.value = '';
            helper.disabled = true;
            helper.textContent = '(Start mic capture once to reveal device names)';
            settingMicDevice.appendChild(helper);
        }
    }

    async function populateSystemSourceOptions(devices) {
        if (!settingSystemSource) return;

        const saved = getSelectedSystemSourceValue();
        settingSystemSource.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = IS_MAC
            ? 'macOS default output loopback (needs BlackHole or Aggregate)'
            : 'Windows default loopback (recommended)';
        settingSystemSource.appendChild(defaultOption);

        const audioOutputs = (devices || []).filter((device) => device.kind === 'audiooutput');
        const audioInputs = (devices || []).filter((device) => device.kind === 'audioinput');
        const loopbackInputs = audioInputs.filter((device) => isLikelyLoopbackInput(device.label));

        // Group 1: virtual loopback inputs — these CAN be directly captured via
        // getUserMedia and are the most reliable way to pick a specific source.
        if (loopbackInputs.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Virtual loopback (capture-ready)';
            loopbackInputs.forEach((device) => {
                if (!device.deviceId) return;
                const option = document.createElement('option');
                option.value = `input:${device.deviceId}`;
                option.textContent = device.label || 'Loopback input';
                group.appendChild(option);
            });
            settingSystemSource.appendChild(group);
        }

        // Group 2: detected audio output devices.
        //   Windows: informational only. Chromium's loopback follows the OS
        //     default playback device, so picking a specific output cannot be
        //     wired to a direct capture — entries stay disabled (unchanged).
        //   macOS:   selecting an entry switches the macOS system default
        //     output via SwitchAudioSource (main-process IPC). The existing
        //     loopback path then follows the new default. Still requires
        //     BlackHole / Aggregate for the capture itself.
        if (audioOutputs.length > 0) {
            const group = document.createElement('optgroup');
            group.label = IS_MAC
                ? 'OS audio outputs (sets macOS default — capture via BlackHole)'
                : 'OS audio outputs (set as Windows default to capture)';
            const labelledOutputs = audioOutputs.filter((device) => device.deviceId && device.deviceId !== 'default');
            labelledOutputs.forEach((device, index) => {
                const option = document.createElement('option');
                const label = device.label || `Output ${index + 1}`;
                if (IS_MAC) {
                    // Encode both the deviceId (renderer-side identity) and the
                    // human label (which is what SwitchAudioSource matches on
                    // because macOS audio device ids are not stable strings).
                    option.value = `output:${device.deviceId}::${label}`;
                    option.textContent = label;
                } else {
                    option.value = '';
                    option.textContent = label;
                    option.disabled = true;
                }
                group.appendChild(option);
            });
            if (labelledOutputs.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '(Start audio once to reveal output names)';
                option.disabled = true;
                group.appendChild(option);
            }
            settingSystemSource.appendChild(group);
        }

        // Group 3 (Windows-only): per-process loopback via the
        // application-loopback sidecar. The only way to truly capture a
        // single app's audio on Windows without virtual cables; Chromium's
        // own getDisplayMedia can't do it (crbug.com/40947205).
        if (window.electronAPI?.listAudioProcesses) {
            try {
                const result = await window.electronAPI.listAudioProcesses();
                if (result?.supported && Array.isArray(result.processes) && result.processes.length > 0) {
                    const group = document.createElement('optgroup');
                    group.label = 'Specific app (Windows per-process loopback)';
                    result.processes.forEach((proc) => {
                        if (!proc?.processId) return;
                        const option = document.createElement('option');
                        option.value = `process:${proc.processId}`;
                        const title = String(proc.title || '').trim();
                        option.textContent = title
                            ? `${title} (PID ${proc.processId})`
                            : `PID ${proc.processId}`;
                        group.appendChild(option);
                    });
                    settingSystemSource.appendChild(group);
                }
            } catch (error) {
                console.warn('Failed to list audio processes:', error);
            }
        }

        // Group 4: per-screen desktopCapturer sources (advanced, multi-monitor).
        let desktopSources = [];
        try {
            if (window.electronAPI?.getDesktopSources) {
                desktopSources = await window.electronAPI.getDesktopSources();
            }
        } catch (error) {
            console.warn('Failed to load desktop sources:', error);
        }
        if (Array.isArray(desktopSources) && desktopSources.length > 1) {
            const group = document.createElement('optgroup');
            group.label = 'Per-screen loopback (multi-monitor)';
            desktopSources.forEach((source, index) => {
                if (!source?.id) return;
                const option = document.createElement('option');
                option.value = `screen:${source.id}`;
                option.textContent = source.name || `Screen ${index + 1}`;
                group.appendChild(option);
            });
            settingSystemSource.appendChild(group);
        }

        // Restore selection if the saved value still exists in the dropdown.
        // For "output:" selections, fall back to id-match then label-match —
        // macOS Chromium hides audiooutput labels until a media permission is
        // active in this page session, so on Settings re-open the rebuilt
        // option values can differ from what was saved. Without this tolerance
        // the dropdown silently reverts to default.
        const allValues = Array.from(settingSystemSource.querySelectorAll('option')).map((opt) => opt.value);
        let resolvedValue = '';
        if (allValues.includes(saved)) {
            resolvedValue = saved;
        } else if (saved.startsWith('output:')) {
            const parsedSaved = parseSystemSourceSelection(saved);
            const candidate = allValues.find((value) => {
                if (!value.startsWith('output:')) return false;
                const parsed = parseSystemSourceSelection(value);
                if (parsedSaved.id && parsed.id && parsed.id === parsedSaved.id) return true;
                if (parsedSaved.label && parsed.label && parsed.label === parsedSaved.label) return true;
                return false;
            });
            if (candidate) resolvedValue = candidate;
        }
        settingSystemSource.value = resolvedValue;
    }

    async function refreshAudioDeviceOptions() {
        const devices = await enumerateAllDevices();
        await Promise.all([
            populateMicDeviceOptions(devices),
            populateSystemSourceOptions(devices)
        ]);
    }

    function bindRefreshAudioDevices() {
        if (!refreshAudioDevicesBtn) return;
        refreshAudioDevicesBtn.addEventListener('click', async () => {
            refreshAudioDevicesBtn.disabled = true;
            const previousText = refreshAudioDevicesBtn.textContent;
            refreshAudioDevicesBtn.textContent = '...';
            try {
                await refreshAudioDeviceOptions();
                showFeedback?.('Audio devices refreshed', 'success');
            } catch (error) {
                console.error('Failed to refresh audio devices:', error);
                showFeedback?.('Failed to refresh audio devices', 'error');
            } finally {
                refreshAudioDevicesBtn.textContent = previousText;
                refreshAudioDevicesBtn.disabled = false;
            }
        });
    }

    function bindOpenSoundSettings() {
        if (!openSoundSettingsBtn) return;
        openSoundSettingsBtn.addEventListener('click', () => {
            if (window.electronAPI?.openSoundSettings) {
                window.electronAPI.openSoundSettings().catch((error) => {
                    console.warn('Failed to open sound settings:', error);
                });
            }
        });
    }

    async function openSettings() {
        if (!settingsPanel) return;

        try {
            const settings = await window.electronAPI.getSettings();
            if (settings && !settings.error) {
                applySettingsShortcutConfig?.(settings);

                populateDashscopeAiModelOptions(
                    settings.dashscopeAiModels,
                    settings.dashscopeAiModel || settings.defaultDashscopeAiModel
                );

                populateProgrammingLanguageOptions(
                    settings.programmingLanguages,
                    settings.programmingLanguage || settings.defaultProgrammingLanguage
                );

                const activeAsrProvider = settings.asrProvider || 'paraformer';
                if (settingAsrProvider) settingAsrProvider.value = activeAsrProvider;
                updateAsrProviderVisibility(activeAsrProvider);

                if (settingDashscopeKey) settingDashscopeKey.value = settings.dashscopeApiKey || '';
                if (settingXfyunAppId) settingXfyunAppId.value = settings.xfyunAppId || '';
                if (settingXfyunKey) settingXfyunKey.value = settings.xfyunApiKey || '';
                if (settingResumeText) settingResumeText.value = settings.resumeText || '';
                if (settingJobDescription) settingJobDescription.value = settings.jobDescription || '';
                if (settingInterviewerMode) settingInterviewerMode.value = settings.interviewerMode === 'expert' ? 'expert' : 'fast';
                if (settingWindowOpacity) {
                    settingWindowOpacity.value = normalizeWindowOpacityLevel(settings.windowOpacityLevel);
                }
                updateWindowOpacityValueLabel(settings.windowOpacityLevel);
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }

        setApiKeyFieldVisibility(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope', false);
        setApiKeyFieldVisibility(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei', false);

        await refreshAudioDeviceOptions();

        settingsPanel.classList.remove('hidden');
    }

    function closeSettings() {
        if (settingsPanel) settingsPanel.classList.add('hidden');
        setApiKeyFieldVisibility(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope', false);
        setApiKeyFieldVisibility(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei', false);
    }

    async function saveSettings() {
        try {
            if (!settingProgrammingLanguage || settingProgrammingLanguage.options.length === 0) {
                throw new Error('Programming languages are not configured.');
            }

            const settings = {
                asrProvider: settingAsrProvider ? settingAsrProvider.value : 'paraformer',
                dashscopeApiKey: settingDashscopeKey ? settingDashscopeKey.value.trim() : '',
                dashscopeAiModel: settingDashscopeAiModel ? settingDashscopeAiModel.value : '',
                xfyunAppId: settingXfyunAppId ? settingXfyunAppId.value.trim() : '',
                xfyunApiKey: settingXfyunKey ? settingXfyunKey.value.trim() : '',
                resumeText: settingResumeText ? settingResumeText.value : '',
                jobDescription: settingJobDescription ? settingJobDescription.value : '',
                interviewerMode: settingInterviewerMode && settingInterviewerMode.value === 'expert' ? 'expert' : 'fast',
                programmingLanguage: settingProgrammingLanguage.value,
                windowOpacityLevel: normalizeWindowOpacityLevel(settingWindowOpacity?.value)
            };

            const result = await window.electronAPI.saveSettings(settings);

            if (result.success) {
                const micDeviceId = settingMicDevice ? settingMicDevice.value : '';
                const systemSourceValue = settingSystemSource ? settingSystemSource.value : '';
                setStoredValue(MIC_DEVICE_STORAGE_KEY, micDeviceId);
                setStoredValue(SYSTEM_SOURCE_STORAGE_KEY, systemSourceValue);

                // Auto-save fires on every field change, so we don't pop a
                // toast on success and don't close the panel — both were
                // side-effects of the old click-Save-then-close flow. The
                // user closes the panel explicitly via the close button.
                onSettingsSaved?.({ ...settings, micDeviceId, systemSourceValue });
                return { success: true, settings: { ...settings, micDeviceId, systemSourceValue } };
            }

            showFeedback?.(`Failed to save: ${result.error}`, 'error');
            return { success: false, error: result.error || 'Failed to save settings' };
        } catch (error) {
            console.error('Failed to save settings:', error);
            showFeedback?.('Failed to save settings', 'error');
            return { success: false, error: error.message || 'Failed to save settings' };
        }
    }

    // Auto-save: every field change persists immediately. Selects / range
    // inputs save on `change` (atomic user action, no debounce). Text inputs
    // and textareas debounce on `input` so we don't write on every keystroke;
    // we also save on `change` (fires on blur) to flush whatever's pending.
    //
    // The existing onSettingsSaved callback (wired by the renderer) refreshes
    // API-key availability and UI state, so auto-save side-effects match what
    // the old manual Save button used to do.
    function bindAutoSave() {
        const immediateFields = [
            settingAsrProvider,
            settingDashscopeAiModel,
            settingProgrammingLanguage,
            settingInterviewerMode,
            settingWindowOpacity,
            settingMicDevice,
            settingSystemSource
        ];
        immediateFields.forEach((el) => {
            if (!el) return;
            el.addEventListener('change', () => { saveSettings(); });
        });

        let saveTimer = null;
        const queueSave = () => {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => { saveTimer = null; saveSettings(); }, 600);
        };
        const flushSave = () => {
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            saveSettings();
        };
        const debouncedFields = [
            settingDashscopeKey,
            settingXfyunAppId,
            settingXfyunKey,
            settingResumeText,
            settingJobDescription
        ];
        debouncedFields.forEach((el) => {
            if (!el) return;
            el.addEventListener('input', queueSave);
            el.addEventListener('change', flushSave);
        });
    }

    bindApiKeyVisibilityToggle(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope');
    bindApiKeyVisibilityToggle(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei');
    bindAsrProviderToggle();
    bindRefreshAudioDevices();
    bindOpenSoundSettings();
    bindAutoSave();

    return {
        normalizeWindowOpacityLevel,
        updateWindowOpacityValueLabel,
        openSettings,
        closeSettings,
        saveSettings,
        refreshAudioDeviceOptions,
        getSelectedMicDeviceId,
        getSelectedSystemSourceValue,
        parseSystemSourceSelection
    };
}
