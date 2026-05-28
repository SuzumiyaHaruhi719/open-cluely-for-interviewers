function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export const MIC_DEVICE_STORAGE_KEY = 'open-cluely.audioDevice.mic';
export const SYSTEM_SOURCE_STORAGE_KEY = 'open-cluely.audioDevice.system';

export function getSelectedMicDeviceId() {
    try {
        return localStorage.getItem(MIC_DEVICE_STORAGE_KEY) || '';
    } catch (_) {
        return '';
    }
}

export function getSelectedSystemSourceId() {
    try {
        return localStorage.getItem(SYSTEM_SOURCE_STORAGE_KEY) || '';
    } catch (_) {
        return '';
    }
}

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
    settingAiProvider,
    dashscopeSettingsGroup,
    ollamaSettingsGroup,
    settingDashscopeAiModel,
    settingProgrammingLanguage,
    settingOllamaBaseUrl,
    settingOllamaModel,
    settingOllamaModelSelect,
    fetchOllamaModelsBtn,
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
    settingWindowOpacity,
    settingWindowOpacityValue,
    settingMicDevice,
    settingSystemSource,
    refreshAudioDevicesBtn,
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
        if (!settingWindowOpacityValue) {
            return;
        }

        const opacityLevel = normalizeWindowOpacityLevel(value);
        settingWindowOpacityValue.textContent = `${opacityLevel}/10`;
    }

    function setApiKeyFieldVisibility(inputElement, toggleButton, providerName, visible) {
        if (!inputElement || !toggleButton) {
            return;
        }

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
        if (!inputElement || !toggleButton) {
            return;
        }

        setApiKeyFieldVisibility(inputElement, toggleButton, providerName, false);
        toggleButton.addEventListener('click', () => {
            const nextVisible = inputElement.type !== 'text';
            setApiKeyFieldVisibility(inputElement, toggleButton, providerName, nextVisible);
        });
    }

    function updateProviderVisibility(provider) {
        if (dashscopeSettingsGroup) {
            dashscopeSettingsGroup.classList.toggle('hidden', provider !== 'dashscope');
        }
        if (ollamaSettingsGroup) {
            ollamaSettingsGroup.classList.toggle('hidden', provider !== 'ollama');
        }
    }

    function updateAsrProviderVisibility(provider) {
        if (paraformerSettingsGroup) {
            paraformerSettingsGroup.classList.toggle('hidden', provider !== 'paraformer');
        }
        if (xfyunSettingsGroup) {
            xfyunSettingsGroup.classList.toggle('hidden', provider !== 'xfyun');
        }
    }

    function bindProviderToggle() {
        if (settingAiProvider) {
            settingAiProvider.addEventListener('change', () => {
                updateProviderVisibility(settingAiProvider.value);
            });
        }

        if (settingAsrProvider) {
            settingAsrProvider.addEventListener('change', () => {
                updateAsrProviderVisibility(settingAsrProvider.value);
            });
        }
    }

    async function fetchOllamaModels() {
        if (!settingOllamaBaseUrl || !settingOllamaModelSelect) {
            return;
        }

        const baseUrl = settingOllamaBaseUrl.value.trim() || 'http://localhost:11434';

        try {
            if (fetchOllamaModelsBtn) {
                fetchOllamaModelsBtn.textContent = '...';
                fetchOllamaModelsBtn.disabled = true;
            }

            const response = await fetch(`${baseUrl}/api/tags`);
            if (!response.ok) {
                throw new Error(`Ollama API returned ${response.status}`);
            }

            const data = await response.json();
            const models = Array.isArray(data.models) ? data.models : [];

            if (models.length === 0) {
                showFeedback?.('No models found. Pull a model first with: ollama pull <model>', 'error');
                return;
            }

            settingOllamaModelSelect.innerHTML = '';
            models.forEach((model) => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = model.name;
                settingOllamaModelSelect.appendChild(option);
            });

            const currentModel = settingOllamaModel ? settingOllamaModel.value.trim() : '';
            const modelNames = models.map((m) => m.name);
            if (currentModel && modelNames.includes(currentModel)) {
                settingOllamaModelSelect.value = currentModel;
            }

            settingOllamaModelSelect.classList.remove('hidden');

            settingOllamaModelSelect.addEventListener('change', () => {
                if (settingOllamaModel) {
                    settingOllamaModel.value = settingOllamaModelSelect.value;
                }
            }, { once: false });

            showFeedback?.(`Found ${models.length} model(s). Select one from the dropdown.`, 'success');
        } catch (error) {
            console.error('Failed to fetch Ollama models:', error);
            showFeedback?.(`Could not reach Ollama at ${baseUrl}. Is it running?`, 'error');
        } finally {
            if (fetchOllamaModelsBtn) {
                fetchOllamaModelsBtn.textContent = 'Fetch';
                fetchOllamaModelsBtn.disabled = false;
            }
        }
    }

    function bindFetchOllamaModels() {
        if (!fetchOllamaModelsBtn) {
            return;
        }

        fetchOllamaModelsBtn.addEventListener('click', () => {
            fetchOllamaModels();
        });
    }

    function populateDashscopeAiModelOptions(models, selectedModel) {
        if (!settingDashscopeAiModel) {
            return;
        }

        settingDashscopeAiModel.innerHTML = '';

        const configuredModels = Array.isArray(models) ? models : [];
        if (configuredModels.length === 0) {
            throw new Error('DashScope AI models are not configured.');
        }

        configuredModels.forEach((modelName) => {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            settingDashscopeAiModel.appendChild(option);
        });

        settingDashscopeAiModel.value = configuredModels.includes(selectedModel)
            ? selectedModel
            : configuredModels[0];
    }

    async function populateMicDeviceOptions() {
        if (!settingMicDevice) {
            return;
        }

        const savedDeviceId = getSelectedMicDeviceId();
        settingMicDevice.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'System default microphone';
        settingMicDevice.appendChild(defaultOption);

        let devices = [];
        try {
            // enumerateDevices() only returns device labels after the page has
            // been granted mic permission at least once. Without it, you'd see
            // anonymous "Microphone" entries that aren't distinguishable.
            if (navigator.mediaDevices?.enumerateDevices) {
                devices = await navigator.mediaDevices.enumerateDevices();
            }
        } catch (error) {
            console.warn('Failed to enumerate audio devices:', error);
            showFeedback?.('Could not enumerate audio devices. Start a mic capture once to grant permission.', 'error');
        }

        const audioInputs = devices.filter((device) => device.kind === 'audioinput');
        const seenIds = new Set();

        audioInputs.forEach((device, index) => {
            if (!device.deviceId || device.deviceId === 'default' || device.deviceId === 'communications') {
                return;
            }
            if (seenIds.has(device.deviceId)) {
                return;
            }
            seenIds.add(device.deviceId);

            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Microphone ${index + 1}`;
            settingMicDevice.appendChild(option);
        });

        if (savedDeviceId && seenIds.has(savedDeviceId)) {
            settingMicDevice.value = savedDeviceId;
        } else {
            settingMicDevice.value = '';
        }

        if (audioInputs.length === 0) {
            const helperOption = document.createElement('option');
            helperOption.value = '';
            helperOption.disabled = true;
            helperOption.textContent = 'No microphones detected — check OS permissions';
            settingMicDevice.appendChild(helperOption);
        } else if (audioInputs.some((device) => !device.label)) {
            const helperOption = document.createElement('option');
            helperOption.value = '';
            helperOption.disabled = true;
            helperOption.textContent = '(Start mic capture once to reveal device names)';
            settingMicDevice.appendChild(helperOption);
        }
    }

    async function populateSystemSourceOptions() {
        if (!settingSystemSource) {
            return;
        }

        const savedSourceId = getSelectedSystemSourceId();
        settingSystemSource.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'First available screen (default)';
        settingSystemSource.appendChild(defaultOption);

        let sources = [];
        try {
            if (window.electronAPI?.getDesktopSources) {
                sources = await window.electronAPI.getDesktopSources();
            }
        } catch (error) {
            console.warn('Failed to load desktop sources:', error);
        }

        const seenIds = new Set();
        (Array.isArray(sources) ? sources : []).forEach((source, index) => {
            if (!source?.id || seenIds.has(source.id)) {
                return;
            }
            seenIds.add(source.id);

            const option = document.createElement('option');
            option.value = source.id;
            option.textContent = source.name || `Screen ${index + 1}`;
            settingSystemSource.appendChild(option);
        });

        if (savedSourceId && seenIds.has(savedSourceId)) {
            settingSystemSource.value = savedSourceId;
        } else {
            settingSystemSource.value = '';
        }
    }

    async function refreshAudioDeviceOptions() {
        await Promise.all([
            populateMicDeviceOptions(),
            populateSystemSourceOptions()
        ]);
    }

    function bindRefreshAudioDevices() {
        if (!refreshAudioDevicesBtn) {
            return;
        }

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

    function populateProgrammingLanguageOptions(languages, selectedLanguage) {
        if (!settingProgrammingLanguage) {
            return;
        }

        settingProgrammingLanguage.innerHTML = '';

        const configuredLanguages = Array.isArray(languages) ? languages : [];
        if (configuredLanguages.length === 0) {
            throw new Error('Programming languages are not configured.');
        }

        configuredLanguages.forEach((languageName) => {
            const option = document.createElement('option');
            option.value = languageName;
            option.textContent = languageName;
            settingProgrammingLanguage.appendChild(option);
        });

        settingProgrammingLanguage.value = configuredLanguages.includes(selectedLanguage)
            ? selectedLanguage
            : configuredLanguages[0];
    }

    async function openSettings() {
        if (!settingsPanel) {
            return;
        }

        try {
            const settings = await window.electronAPI.getSettings();
            if (settings && !settings.error) {
                applySettingsShortcutConfig?.(settings);

                const activeProvider = settings.aiProvider || 'dashscope';
                if (settingAiProvider) {
                    settingAiProvider.value = activeProvider;
                }
                updateProviderVisibility(activeProvider);

                populateDashscopeAiModelOptions(
                    settings.dashscopeAiModels,
                    settings.dashscopeAiModel || settings.defaultDashscopeAiModel
                );

                if (settingOllamaBaseUrl) settingOllamaBaseUrl.value = settings.ollamaBaseUrl || 'http://localhost:11434';
                if (settingOllamaModel) settingOllamaModel.value = settings.ollamaModel || 'llama3.2';
                if (settingOllamaModelSelect) settingOllamaModelSelect.classList.add('hidden');

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
        if (settingsPanel) {
            settingsPanel.classList.add('hidden');
        }

        setApiKeyFieldVisibility(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope', false);
        setApiKeyFieldVisibility(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei', false);
    }

    async function saveSettings() {
        try {
            const aiProvider = settingAiProvider ? settingAiProvider.value : 'dashscope';

            if (!settingProgrammingLanguage || settingProgrammingLanguage.options.length === 0) {
                throw new Error('Programming languages are not configured.');
            }

            const settings = {
                aiProvider,
                asrProvider: settingAsrProvider ? settingAsrProvider.value : 'paraformer',
                dashscopeApiKey: settingDashscopeKey ? settingDashscopeKey.value.trim() : '',
                dashscopeAiModel: settingDashscopeAiModel ? settingDashscopeAiModel.value : '',
                xfyunAppId: settingXfyunAppId ? settingXfyunAppId.value.trim() : '',
                xfyunApiKey: settingXfyunKey ? settingXfyunKey.value.trim() : '',
                resumeText: settingResumeText ? settingResumeText.value : '',
                jobDescription: settingJobDescription ? settingJobDescription.value : '',
                ollamaBaseUrl: settingOllamaBaseUrl ? settingOllamaBaseUrl.value.trim() : '',
                ollamaModel: settingOllamaModel ? settingOllamaModel.value.trim() : '',
                programmingLanguage: settingProgrammingLanguage.value,
                windowOpacityLevel: normalizeWindowOpacityLevel(settingWindowOpacity?.value)
            };

            const result = await window.electronAPI.saveSettings(settings);

            if (result.success) {
                const micDeviceId = settingMicDevice ? settingMicDevice.value : '';
                const systemSourceId = settingSystemSource ? settingSystemSource.value : '';
                setStoredValue(MIC_DEVICE_STORAGE_KEY, micDeviceId);
                setStoredValue(SYSTEM_SOURCE_STORAGE_KEY, systemSourceId);

                showFeedback?.('Settings saved. AI changes apply now; ASR provider and audio devices apply on next start.', 'success');
                onSettingsSaved?.({ ...settings, micDeviceId, systemSourceId });
                closeSettings();
                return { success: true, settings: { ...settings, micDeviceId, systemSourceId } };
            }

            showFeedback?.(`Failed to save: ${result.error}`, 'error');
            return { success: false, error: result.error || 'Failed to save settings' };
        } catch (error) {
            console.error('Failed to save settings:', error);
            showFeedback?.('Failed to save settings', 'error');
            return { success: false, error: error.message || 'Failed to save settings' };
        }
    }

    bindApiKeyVisibilityToggle(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope');
    bindApiKeyVisibilityToggle(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei');
    bindProviderToggle();
    bindFetchOllamaModels();
    bindRefreshAudioDevices();

    return {
        normalizeWindowOpacityLevel,
        updateWindowOpacityValueLabel,
        openSettings,
        closeSettings,
        saveSettings,
        refreshAudioDeviceOptions,
        getSelectedMicDeviceId,
        getSelectedSystemSourceId
    };
}
