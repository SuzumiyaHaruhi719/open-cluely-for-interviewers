// Settings panel manager — AUTO-SAVE.
//
// There is no manual Save button: every field persists on change. Selects,
// toggles and the opacity range save on `change` (an atomic user action, no
// debounce). Text inputs and textareas debounce on `input` (~500ms) so we
// don't write on every keystroke, and also flush on `change` (fires on blur).
//
// A subtle aria-live "Saved ✓" pip confirms each write. The onSettingsSaved
// callback still fires after every successful save so the renderer can refresh
// API-key availability / UI state — the same side-effects the old click-Save
// flow produced.
//
// SEAM — offline ASR provider (Volcengine / 火山引擎):
//   The offline interview path currently runs on the existing mic→Paraformer
//   pipeline. Once the Volcengine creds below (volcAppId / volcAccessToken /
//   volcResourceId) are set, offline ASR should switch to a 'volcengine'
//   provider (a future ASR-router change). These fields only capture + persist
//   the creds; no client connects to Volcengine yet.
//
// Field groups (each dep is optional; a missing element is skipped):
//   - API keys:        DashScope key, Xfyun app-id + key (masked, show/hide)
//   - Volcengine ASR:  volc app-id + access-token (masked, show/hide) + resource-id
//   - ASR provider:    paraformer | xfyun  (toggles the provider sub-groups)
//   - AI model:        DashScope model select
//   - Interviewer mode: fast | expert
//   - Programming lang: select
//   - Audio devices:   mic + system source (reuses the preserved helpers)
//   - Stealth:         hide-from-screen-capture toggle (via setStealth)
//   - Window opacity:  1..10 range
//
// PRESERVED EXPORTS (do not rename or change signatures):
//   - localStorage keys MIC_DEVICE_STORAGE_KEY / SYSTEM_SOURCE_STORAGE_KEY
//   - getSelectedMicDeviceId, getSelectedSystemSourceValue,
//     parseSystemSourceSelection  (module-level named exports)
//   - populateSystemSourceOptions — kept as a factory-internal helper (it
//     closes over settingSystemSource) AND re-exposed on the returned manager
//     object, preserving its original name and one-arg(devices) behavior.

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export const MIC_DEVICE_STORAGE_KEY = 'open-cluely.audioDevice.mic';
export const SYSTEM_SOURCE_STORAGE_KEY = 'open-cluely.audioDevice.system';

// Debounce window for text/textarea inputs. Selects/toggles bypass this and
// save immediately on `change`.
const TEXT_INPUT_SAVE_DEBOUNCE_MS = 500;
// How long the "Saved ✓" pip stays visible after a successful write.
const SAVED_PIP_VISIBLE_MS = 1600;
// Settings close exit-animation duration. MUST match the `.is-closing` exit
// keyframes in settings.css (--dur-2 ≈ 180ms); 200 gives the animation room to
// finish before the panel is display:none'd.
const SETTINGS_CLOSE_MS = 200;

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
    // Optional new deps (all guarded — manager works if any are absent):
    settingStealthToggle,    // checkbox: hide-from-screen-capture
    settingsStatusIndicator, // element where "Saving…/Saved ✓" is announced
    saveBtn,                 // legacy manual Save button — auto-save makes it
                             // redundant; if present we repurpose it to flush.
    applySettingsShortcutConfig,
    showFeedback,
    onSettingsSaved,
    setStealth               // (enabled) => void|Promise — toggle stealth
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

    // ---- "Saving… / Saved ✓" status indicator -------------------------------
    // Subtle, aria-live. We never surface a toast for routine auto-saves (that
    // belonged to the old manual flow); the pip is the sole confirmation. We
    // do still call showFeedback on *errors* so a failed save is loud.
    let savedPipTimer = null;

    function setStatusIndicator(state) {
        // state: 'idle' | 'saving' | 'saved' | 'error'
        if (!settingsStatusIndicator) return;
        if (savedPipTimer) {
            clearTimeout(savedPipTimer);
            savedPipTimer = null;
        }
        settingsStatusIndicator.dataset.state = state;
        if (state === 'saving') {
            settingsStatusIndicator.textContent = '保存中…';
        } else if (state === 'saved') {
            settingsStatusIndicator.textContent = '已保存 ✓';
            savedPipTimer = setTimeout(() => {
                savedPipTimer = null;
                setStatusIndicator('idle');
            }, SAVED_PIP_VISIBLE_MS);
        } else if (state === 'error') {
            settingsStatusIndicator.textContent = '保存失败';
        } else {
            settingsStatusIndicator.textContent = '';
        }
    }

    function setApiKeyFieldVisibility(inputElement, toggleButton, providerName, visible) {
        if (!inputElement || !toggleButton) return;
        const shouldShow = Boolean(visible);
        inputElement.type = shouldShow ? 'text' : 'password';
        toggleButton.textContent = shouldShow ? '隐藏' : '显示';
        toggleButton.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
        toggleButton.setAttribute(
            'aria-label',
            `${shouldShow ? '隐藏' : '显示'} ${providerName} API key`
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
            throw new Error('DashScope AI 模型未配置。');
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
        defaultOption.textContent = '系统默认麦克风';
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
            option.textContent = device.label || `麦克风 ${index + 1}`;
            settingMicDevice.appendChild(option);
        });

        settingMicDevice.value = savedDeviceId && seenIds.has(savedDeviceId) ? savedDeviceId : '';

        if (audioInputs.length === 0) {
            const helper = document.createElement('option');
            helper.value = '';
            helper.disabled = true;
            helper.textContent = '未检测到麦克风 — 请检查系统权限';
            settingMicDevice.appendChild(helper);
        } else if (audioInputs.some((device) => !device.label)) {
            const helper = document.createElement('option');
            helper.value = '';
            helper.disabled = true;
            helper.textContent = '(开启一次麦克风采集后即可显示设备名称)';
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
            ? 'macOS 默认输出回环（需 BlackHole 或聚合设备）'
            : 'Windows 默认回环（推荐）';
        settingSystemSource.appendChild(defaultOption);

        const audioOutputs = (devices || []).filter((device) => device.kind === 'audiooutput');
        const audioInputs = (devices || []).filter((device) => device.kind === 'audioinput');
        const loopbackInputs = audioInputs.filter((device) => isLikelyLoopbackInput(device.label));

        // Group 1: virtual loopback inputs — these CAN be directly captured via
        // getUserMedia and are the most reliable way to pick a specific source.
        if (loopbackInputs.length > 0) {
            const group = document.createElement('optgroup');
            group.label = '虚拟回环（可直接采集）';
            loopbackInputs.forEach((device) => {
                if (!device.deviceId) return;
                const option = document.createElement('option');
                option.value = `input:${device.deviceId}`;
                option.textContent = device.label || '回环输入';
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
                ? '系统音频输出（设为 macOS 默认输出 — 通过 BlackHole 采集）'
                : '系统音频输出（设为 Windows 默认输出后采集）';
            const labelledOutputs = audioOutputs.filter((device) => device.deviceId && device.deviceId !== 'default');
            labelledOutputs.forEach((device, index) => {
                const option = document.createElement('option');
                const label = device.label || `输出 ${index + 1}`;
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
                option.textContent = '(开启一次音频后即可显示输出名称)';
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
                    group.label = '指定应用（Windows 进程级回环）';
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
            group.label = '按屏幕回环（多显示器）';
            desktopSources.forEach((source, index) => {
                if (!source?.id) return;
                const option = document.createElement('option');
                option.value = `screen:${source.id}`;
                option.textContent = source.name || `屏幕 ${index + 1}`;
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
                showFeedback?.('音频设备已刷新', 'success');
            } catch (error) {
                console.error('Failed to refresh audio devices:', error);
                showFeedback?.('刷新音频设备失败', 'error');
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

    // Stealth reads from its own IPC path, not save-settings: it toggles via
    // setStealth → toggleStealth IPC (which also flips setContentProtection live).
    // save-settings round-trips the *existing* hideFromScreenCapture value, so it
    // must not own the toggle.
    function bindStealthControl() {
        if (!settingStealthToggle) return;
        settingStealthToggle.addEventListener('change', () => {
            const enabled = Boolean(settingStealthToggle.checked);
            try {
                const maybePromise = setStealth?.(enabled);
                if (maybePromise && typeof maybePromise.catch === 'function') {
                    maybePromise.catch((error) => {
                        console.error('Failed to toggle stealth:', error);
                    });
                }
            } catch (error) {
                console.error('Failed to toggle stealth:', error);
            }
            setStatusIndicator('saved');
        });
    }

    // Interviewer mode is a segmented two-button toggle (Fast / Expert), NOT a
    // <select>. `settingInterviewerMode` is the container; the active button
    // carries .is-active + aria-checked. These helpers read / set / bind it.
    function getInterviewerMode() {
        if (!settingInterviewerMode) return 'fast';
        const active = settingInterviewerMode.querySelector('.mode-segmented__btn.is-active');
        const m = active && active.dataset.mode;
        return ['expert', 'expert2', 'customize'].includes(m) ? m : 'fast';
    }

    function setInterviewerMode(mode) {
        if (!settingInterviewerMode) return;
        const normalized = ['expert', 'expert2', 'customize'].includes(mode) ? mode : 'fast';
        settingInterviewerMode.querySelectorAll('.mode-segmented__btn').forEach((btn) => {
            const isActive = btn.dataset.mode === normalized;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });
    }

    function bindInterviewerModeToggle() {
        if (!settingInterviewerMode) return;
        settingInterviewerMode.querySelectorAll('.mode-segmented__btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                setInterviewerMode(btn.dataset.mode);
                saveSettings();
            });
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

                if (settingOutputLanguage) {
                    const ol = String(settings.outputLanguage || '').toLowerCase();
                    settingOutputLanguage.value = (ol === 'zh' || ol === 'en') ? ol : '';
                }

                const activeAsrProvider = settings.asrProvider || 'paraformer';
                if (settingAsrProvider) settingAsrProvider.value = activeAsrProvider;
                updateAsrProviderVisibility(activeAsrProvider);

                if (settingDashscopeKey) settingDashscopeKey.value = settings.dashscopeApiKey || '';
                if (settingXfyunAppId) settingXfyunAppId.value = settings.xfyunAppId || '';
                if (settingXfyunKey) settingXfyunKey.value = settings.xfyunApiKey || '';
                if (settingVolcAppId) settingVolcAppId.value = settings.volcAppId || '';
                if (settingVolcAccessToken) settingVolcAccessToken.value = settings.volcAccessToken || '';
                if (settingVolcResourceId) settingVolcResourceId.value = settings.volcResourceId || '';
                if (settingResumeText) settingResumeText.value = settings.resumeText || '';
                if (settingJobDescription) settingJobDescription.value = settings.jobDescription || '';
                setInterviewerMode(settings.interviewerMode);
                if (settingWindowOpacity) {
                    settingWindowOpacity.value = normalizeWindowOpacityLevel(settings.windowOpacityLevel);
                }
                updateWindowOpacityValueLabel(settings.windowOpacityLevel);

                // Stealth reflects the live environment flag.
                if (settingStealthToggle) {
                    settingStealthToggle.checked = Boolean(settings.hideFromScreenCapture);
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }

        setApiKeyFieldVisibility(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope', false);
        setApiKeyFieldVisibility(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei', false);
        setApiKeyFieldVisibility(settingVolcAccessToken, toggleVolcAccessTokenVisibilityBtn, 'Volcengine', false);
        setStatusIndicator('idle');

        // Show the panel IMMEDIATELY. Audio-device enumeration is deferred and
        // intentionally NOT awaited: listAudioProcesses spawns the loopback
        // sidecar .exe and getDesktopSources enumerates screens — both are slow
        // (often >1s with HDR/dxgi retries), and awaiting them here made the
        // panel appear only AFTER they finished (the "opens slowly" lag). The
        // device dropdowns now fill in a beat later, in the background.
        settingsPanel.classList.remove('is-closing');
        settingsPanel.classList.remove('hidden');

        refreshAudioDeviceOptions().catch((error) => {
            console.warn('Audio device enumeration failed:', error);
        });
    }

    // Closing plays an exit animation (scrim fades + dialog scales/drops away)
    // before the panel is display:none'd. .is-closing triggers the exit
    // keyframes; we hide only after they finish (SETTINGS_CLOSE_MS matches the
    // CSS exit duration). Previously the panel just snapped shut with no motion.
    let closeTimer = null;
    function closeSettings() {
        setApiKeyFieldVisibility(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope', false);
        setApiKeyFieldVisibility(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei', false);
        setApiKeyFieldVisibility(settingVolcAccessToken, toggleVolcAccessTokenVisibilityBtn, 'Volcengine', false);
        if (!settingsPanel || settingsPanel.classList.contains('hidden')) return;
        if (closeTimer) clearTimeout(closeTimer);
        settingsPanel.classList.add('is-closing');
        closeTimer = setTimeout(() => {
            closeTimer = null;
            settingsPanel.classList.add('hidden');
            settingsPanel.classList.remove('is-closing');
        }, SETTINGS_CLOSE_MS);
    }

    async function saveSettings() {
        setStatusIndicator('saving');
        try {
            const settings = {
                asrProvider: settingAsrProvider ? settingAsrProvider.value : 'paraformer',
                dashscopeApiKey: settingDashscopeKey ? settingDashscopeKey.value.trim() : '',
                dashscopeAiModel: settingDashscopeAiModel ? settingDashscopeAiModel.value : '',
                xfyunAppId: settingXfyunAppId ? settingXfyunAppId.value.trim() : '',
                xfyunApiKey: settingXfyunKey ? settingXfyunKey.value.trim() : '',
                volcAppId: settingVolcAppId ? settingVolcAppId.value.trim() : '',
                volcAccessToken: settingVolcAccessToken ? settingVolcAccessToken.value.trim() : '',
                volcResourceId: settingVolcResourceId ? settingVolcResourceId.value.trim() : '',
                interviewerMode: getInterviewerMode(),
                outputLanguage: settingOutputLanguage ? settingOutputLanguage.value : '',
                windowOpacityLevel: normalizeWindowOpacityLevel(settingWindowOpacity?.value)
            };
            // resumeText / jobDescription are no longer owned by Settings — they
            // belong to the active interview (resume via the rail dropzone, JD via
            // the rail input). Only include them if a legacy field still exists,
            // so auto-save can never clobber the per-interview values.
            if (settingResumeText) settings.resumeText = settingResumeText.value;
            if (settingJobDescription) settings.jobDescription = settingJobDescription.value;

            const result = await window.electronAPI.saveSettings(settings);

            if (result.success) {
                const micDeviceId = settingMicDevice ? settingMicDevice.value : '';
                const systemSourceValue = settingSystemSource ? settingSystemSource.value : '';
                setStoredValue(MIC_DEVICE_STORAGE_KEY, micDeviceId);
                setStoredValue(SYSTEM_SOURCE_STORAGE_KEY, systemSourceValue);

                // Auto-save fires on every field change, so we don't pop a
                // toast on success and don't close the panel — both were
                // side-effects of the old click-Save-then-close flow. The
                // user closes the panel explicitly via the close button. The
                // "Saved ✓" pip is the confirmation instead.
                setStatusIndicator('saved');
                onSettingsSaved?.({ ...settings, micDeviceId, systemSourceValue });
                return { success: true, settings: { ...settings, micDeviceId, systemSourceValue } };
            }

            setStatusIndicator('error');
            showFeedback?.(`保存失败：${result.error}`, 'error');
            return { success: false, error: result.error || '保存设置失败' };
        } catch (error) {
            console.error('Failed to save settings:', error);
            setStatusIndicator('error');
            showFeedback?.('保存设置失败', 'error');
            return { success: false, error: error.message || '保存设置失败' };
        }
    }

    // Auto-save: every field change persists immediately. Selects / range
    // inputs save on `change` (atomic user action, no debounce). Text inputs
    // and textareas debounce on `input` so we don't write on every keystroke;
    // we also save on `change` (fires on blur) to flush whatever's pending.
    //
    // Stealth is intentionally NOT in these lists — it persists through its own
    // IPC (see bindStealthControl) and must not be written through save-settings.
    //
    // The existing onSettingsSaved callback (wired by the renderer) refreshes
    // API-key availability and UI state, so auto-save side-effects match what
    // the old manual Save button used to do.
    let saveTimer = null;

    function flushSave() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        saveSettings();
    }

    function queueSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            saveSettings();
        }, TEXT_INPUT_SAVE_DEBOUNCE_MS);
    }

    function bindAutoSave() {
        const immediateFields = [
            settingAsrProvider,
            settingDashscopeAiModel,
            settingOutputLanguage,
            settingWindowOpacity,
            settingMicDevice,
            settingSystemSource
        ];
        immediateFields.forEach((el) => {
            if (!el) return;
            el.addEventListener('change', () => { saveSettings(); });
        });

        const debouncedFields = [
            settingDashscopeKey,
            settingXfyunAppId,
            settingXfyunKey,
            settingVolcAppId,
            settingVolcAccessToken,
            settingVolcResourceId,
            settingResumeText,
            settingJobDescription
        ];
        debouncedFields.forEach((el) => {
            if (!el) return;
            el.addEventListener('input', queueSave);
            el.addEventListener('change', flushSave);
        });
    }

    // The manual Save button is removed from the UI; auto-save is the sole
    // persistence mechanism. If a legacy button element is still wired in, we
    // repurpose its click to flush any pending debounced write (and add an
    // accessible hint) rather than leaving a dead control.
    function bindLegacySaveButton() {
        if (!saveBtn) return;
        saveBtn.addEventListener('click', (event) => {
            event?.preventDefault?.();
            flushSave();
        });
    }

    bindApiKeyVisibilityToggle(settingDashscopeKey, toggleDashscopeKeyVisibilityBtn, 'DashScope');
    bindApiKeyVisibilityToggle(settingXfyunKey, toggleXfyunKeyVisibilityBtn, 'Xunfei');
    bindApiKeyVisibilityToggle(settingVolcAccessToken, toggleVolcAccessTokenVisibilityBtn, 'Volcengine');
    bindAsrProviderToggle();
    bindInterviewerModeToggle();
    bindRefreshAudioDevices();
    bindOpenSoundSettings();
    bindStealthControl();
    bindAutoSave();
    bindLegacySaveButton();

    return {
        normalizeWindowOpacityLevel,
        updateWindowOpacityValueLabel,
        setStatusIndicator,
        openSettings,
        closeSettings,
        saveSettings,
        refreshAudioDeviceOptions,
        populateSystemSourceOptions,
        getSelectedMicDeviceId,
        getSelectedSystemSourceValue,
        parseSystemSourceSelection
    };
}
