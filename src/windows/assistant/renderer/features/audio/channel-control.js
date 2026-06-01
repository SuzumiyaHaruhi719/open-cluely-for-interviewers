// Dual-channel audio controls: two independent "boxes", one per capture
// source — Computer audio (system = candidate's voice, teal) and Microphone
// (mic = you, amber). Each box renders a colored header, a device <select>, an
// on/off toggle, a status pill, and a live RMS level meter. The two boxes are
// fully independent: both can be ON at once.
//
// This component owns NO capture logic. Toggling a box calls
// transcriptionManager.ensureSourceRunning(source, on); selecting a device
// writes the SAME localStorage keys the transcription-manager reads
// (open-cluely.audioDevice.mic / .system) so the existing capture path picks
// the device up on next start. Status is read back from the live
// transcriptionManager.sourceStatuses object; level comes from
// audioPipeline.setLevelListener.

const MIC_DEVICE_STORAGE_KEY = 'open-cluely.audioDevice.mic';
const SYSTEM_SOURCE_STORAGE_KEY = 'open-cluely.audioDevice.system';

// How often we reconcile each box's pill/toggle with the transcription
// manager's live status object. The manager mutates sourceStatuses in place
// (loading → listening → off/error) from async events and backend pushes we
// don't get a callback for, so a light poll keeps the UI honest.
const STATUS_SYNC_INTERVAL_MS = 250;

// Level-meter smoothing. Raw RMS is jumpy; we ease the displayed value toward
// each new sample so the bar reads like a VU meter rather than a strobe.
const LEVEL_SMOOTHING = 0.4;
// RMS rarely approaches 1.0 for speech, so scale it up for a livelier meter
// while clamping to the 0..1 the bar transform expects.
const LEVEL_DISPLAY_GAIN = 2.4;

const STATUS_LABELS = {
    off: 'Off',
    connecting: 'Connecting',
    listening: 'Listening',
    error: 'Error'
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgIcon(paths) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    paths.forEach((spec) => {
        const el = document.createElementNS(SVG_NS, spec.tag);
        Object.entries(spec.attrs).forEach(([key, value]) => el.setAttribute(key, value));
        svg.appendChild(el);
    });
    return svg;
}

// Lucide "monitor" — Computer audio.
function createMonitorIcon() {
    return createSvgIcon([
        { tag: 'rect', attrs: { x: '2', y: '3', width: '20', height: '14', rx: '2' } },
        { tag: 'line', attrs: { x1: '8', y1: '21', x2: '16', y2: '21' } },
        { tag: 'line', attrs: { x1: '12', y1: '17', x2: '12', y2: '21' } }
    ]);
}

// Lucide "mic" — Microphone.
function createMicIcon() {
    return createSvgIcon([
        { tag: 'path', attrs: { d: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z' } },
        { tag: 'path', attrs: { d: 'M19 10v2a7 7 0 0 1-14 0v-2' } },
        { tag: 'line', attrs: { x1: '12', y1: '19', x2: '12', y2: '22' } }
    ]);
}

function setStoredValue(key, value) {
    try {
        if (value) {
            localStorage.setItem(key, value);
        } else {
            localStorage.removeItem(key);
        }
    } catch (_) {
        // localStorage may be unavailable; selection simply won't persist.
    }
}

function getStoredValue(key) {
    try {
        return localStorage.getItem(key) || '';
    } catch (_) {
        return '';
    }
}

// Build a single channel box into rootEl. Returns a controller the parent uses
// to refresh devices, sync status, push a level sample, and tear down.
function createChannelBox({
    rootEl,
    source,
    title,
    accentVar,
    createIcon,
    transcriptionManager,
    populateDevices,
    onDeviceChange
}) {
    rootEl.classList.add('channel-box');
    rootEl.style.setProperty('--channel-accent', accentVar);
    rootEl.dataset.source = source;
    rootEl.innerHTML = '';

    const selectId = `channel-device-${source}`;

    // Header: accent icon + label, status pill on the right.
    const header = document.createElement('div');
    header.className = 'channel-header';

    const heading = document.createElement('div');
    heading.className = 'channel-heading';
    heading.appendChild(createIcon());
    const titleEl = document.createElement('span');
    titleEl.className = 'channel-title';
    titleEl.textContent = title;
    heading.appendChild(titleEl);
    header.appendChild(heading);

    const statusPill = document.createElement('span');
    statusPill.className = 'channel-status';
    statusPill.dataset.state = 'off';
    statusPill.textContent = STATUS_LABELS.off;
    statusPill.setAttribute('role', 'status');
    statusPill.setAttribute('aria-live', 'polite');
    header.appendChild(statusPill);

    rootEl.appendChild(header);

    // Device row: labelled select + on/off toggle.
    const deviceRow = document.createElement('div');
    deviceRow.className = 'channel-device-row';

    const label = document.createElement('label');
    label.className = 'channel-device-label';
    label.setAttribute('for', selectId);
    label.textContent = `${title} device`;
    deviceRow.appendChild(label);

    const select = document.createElement('select');
    select.className = 'channel-device-select';
    select.id = selectId;
    deviceRow.appendChild(select);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'channel-toggle';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', `Turn ${title} on`);
    toggle.textContent = 'Off';
    deviceRow.appendChild(toggle);

    rootEl.appendChild(deviceRow);

    // Level meter: a single scaleX-driven bar (no layout thrash).
    const meter = document.createElement('div');
    meter.className = 'channel-meter';
    meter.setAttribute('aria-hidden', 'true');
    const meterFill = document.createElement('div');
    meterFill.className = 'channel-meter-fill';
    meter.appendChild(meterFill);
    rootEl.appendChild(meter);

    let displayedLevel = 0;
    let isBusy = false;

    function currentStatus() {
        // sourceStatuses is the live object from the transcription source
        // state — reading it reflects loading/listening/off/error pushed from
        // async events without us owning any of that logic.
        const statuses = transcriptionManager?.sourceStatuses;
        return (statuses && statuses[source]) || 'off';
    }

    // Treat both 'connecting' and our local in-flight flag as the
    // "connecting" presentation, since ensureSourceRunning awaits before the
    // status object flips and we want immediate feedback on click.
    function effectiveStatus() {
        const status = currentStatus();
        if (status === 'off' && isBusy) {
            return 'connecting';
        }
        return status;
    }

    function paint() {
        const status = effectiveStatus();
        const isOn = status === 'listening';
        const isConnecting = status === 'connecting';

        statusPill.dataset.state = status;
        statusPill.textContent = STATUS_LABELS[status] || STATUS_LABELS.off;

        toggle.classList.toggle('on', isOn);
        toggle.classList.toggle('connecting', isConnecting);
        toggle.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        toggle.setAttribute('aria-label', `Turn ${title} ${isOn ? 'off' : 'on'}`);
        toggle.textContent = isConnecting ? '…' : (isOn ? 'On' : 'Off');

        rootEl.classList.toggle('is-on', isOn);
        rootEl.classList.toggle('is-connecting', isConnecting);
    }

    async function setRunning(shouldRun) {
        if (isBusy) return;
        if (typeof transcriptionManager?.ensureSourceRunning !== 'function') return;
        isBusy = true;
        paint();
        try {
            await transcriptionManager.ensureSourceRunning(source, shouldRun);
        } catch (error) {
            // ensureSourceRunning logs to the monitor internally; we just
            // restore the visual state from the resulting status.
            console.error(`Channel ${source} toggle failed:`, error);
        } finally {
            isBusy = false;
            paint();
        }
    }

    function handleToggleClick() {
        const isOn = currentStatus() === 'listening';
        setRunning(!isOn);
    }

    function handleDeviceChange() {
        onDeviceChange(select.value);
    }

    toggle.addEventListener('click', handleToggleClick);
    select.addEventListener('change', handleDeviceChange);

    function setLevel(level) {
        const target = Math.max(0, Math.min(1, level * LEVEL_DISPLAY_GAIN));
        displayedLevel = displayedLevel + (target - displayedLevel) * LEVEL_SMOOTHING;
        // Only show motion while listening; otherwise rest at zero.
        const visible = currentStatus() === 'listening' ? displayedLevel : 0;
        meterFill.style.transform = `scaleX(${visible.toFixed(3)})`;
    }

    function decayLevel() {
        // Called on the status tick so the bar eases back to 0 when the
        // source is off / not receiving frames.
        if (currentStatus() !== 'listening' && displayedLevel > 0.001) {
            displayedLevel *= 0.6;
            meterFill.style.transform = `scaleX(${displayedLevel.toFixed(3)})`;
        }
    }

    async function refreshDevices() {
        await populateDevices(select);
    }

    function destroy() {
        toggle.removeEventListener('click', handleToggleClick);
        select.removeEventListener('change', handleDeviceChange);
        rootEl.innerHTML = '';
    }

    paint();

    return { paint, decayLevel, setLevel, refreshDevices, destroy };
}

// Detect virtual loopback inputs (Stereo Mix / VB-Cable / BlackHole / etc.) so
// the computer-audio box can offer them as direct capture targets, matching
// the system-source picker's "input:" encoding.
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

async function enumerateDevicesSafe() {
    try {
        if (navigator.mediaDevices?.enumerateDevices) {
            return await navigator.mediaDevices.enumerateDevices();
        }
    } catch (error) {
        console.warn('Failed to enumerate audio devices:', error);
    }
    return [];
}

function appendOption(select, value, text, { disabled = false } = {}) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    if (disabled) option.disabled = true;
    select.appendChild(option);
}

export function createChannelControls({
    computerRootEl,
    micRootEl,
    transcriptionManager,
    audioPipeline,
    getDesktopSources
}) {
    const resolveDesktopSources = typeof getDesktopSources === 'function'
        ? getDesktopSources
        : async () => [];

    // ---- device population (writes the same localStorage keys the
    // ---- transcription-manager reads) ----------------------------------

    async function populateMicDevices(select) {
        const saved = getStoredValue(MIC_DEVICE_STORAGE_KEY);
        const devices = await enumerateDevicesSafe();
        select.innerHTML = '';
        appendOption(select, '', 'System default microphone');

        const seen = new Set();
        const audioInputs = devices.filter((d) => d.kind === 'audioinput');
        audioInputs.forEach((device, index) => {
            if (!device.deviceId || device.deviceId === 'default' || device.deviceId === 'communications') {
                return;
            }
            if (seen.has(device.deviceId)) return;
            seen.add(device.deviceId);
            appendOption(select, device.deviceId, device.label || `Microphone ${index + 1}`);
        });

        if (audioInputs.length === 0) {
            appendOption(select, '', 'No microphones detected — check OS permissions', { disabled: true });
        }

        select.value = saved && seen.has(saved) ? saved : '';
    }

    async function populateSystemDevices(select) {
        const saved = getStoredValue(SYSTEM_SOURCE_STORAGE_KEY);
        const devices = await enumerateDevicesSafe();
        select.innerHTML = '';
        appendOption(select, '', 'Default loopback (recommended)');

        // Virtual loopback inputs — directly capturable via getUserMedia;
        // encoded as input:<deviceId> per the system-source convention.
        const loopbackInputs = devices
            .filter((d) => d.kind === 'audioinput' && d.deviceId && isLikelyLoopbackInput(d.label));
        loopbackInputs.forEach((device) => {
            appendOption(select, `input:${device.deviceId}`, device.label || 'Loopback input');
        });

        // Per-screen desktopCapturer sources — encoded as screen:<id>.
        let desktopSources = [];
        try {
            desktopSources = await resolveDesktopSources();
        } catch (error) {
            console.warn('Failed to load desktop sources:', error);
        }
        if (Array.isArray(desktopSources)) {
            desktopSources.forEach((src, index) => {
                if (!src?.id) return;
                appendOption(select, `screen:${src.id}`, src.name || `Screen ${index + 1}`);
            });
        }

        // Restore the saved selection only if it still exists in the rebuilt
        // option set; otherwise fall back to default loopback.
        const values = Array.from(select.options).map((opt) => opt.value);
        select.value = values.includes(saved) ? saved : '';
    }

    // ---- boxes ----------------------------------------------------------
    // boxBySource keys controllers by capture source so the shared level
    // listener and status loop can address each meter directly.
    const boxBySource = {};

    if (computerRootEl) {
        boxBySource.system = createChannelBox({
            rootEl: computerRootEl,
            source: 'system',
            title: 'Computer audio',
            accentVar: 'var(--candidate)',
            createIcon: createMonitorIcon,
            transcriptionManager,
            populateDevices: populateSystemDevices,
            onDeviceChange: (value) => setStoredValue(SYSTEM_SOURCE_STORAGE_KEY, value)
        });
    }

    if (micRootEl) {
        boxBySource.mic = createChannelBox({
            rootEl: micRootEl,
            source: 'mic',
            title: 'Microphone',
            accentVar: 'var(--interviewer)',
            createIcon: createMicIcon,
            transcriptionManager,
            populateDevices: populateMicDevices,
            onDeviceChange: (value) => setStoredValue(MIC_DEVICE_STORAGE_KEY, value)
        });
    }

    const boxes = Object.values(boxBySource);

    // ---- single shared level subscription -------------------------------
    // audio-pipeline exposes ONE listener slot; we own it and fan out to the
    // matching box by source.
    if (audioPipeline && typeof audioPipeline.setLevelListener === 'function') {
        audioPipeline.setLevelListener(({ source, level }) => {
            const box = boxBySource[source === 'system' ? 'system' : 'mic'];
            if (box) box.setLevel(level);
        });
    }

    // ---- status reconciliation loop -------------------------------------
    const statusTimer = setInterval(() => {
        boxes.forEach((box) => {
            box.paint();
            box.decayLevel();
        });
    }, STATUS_SYNC_INTERVAL_MS);

    async function refreshDevices() {
        await Promise.all(boxes.map((box) => box.refreshDevices()));
    }

    function destroy() {
        clearInterval(statusTimer);
        if (audioPipeline && typeof audioPipeline.setLevelListener === 'function') {
            audioPipeline.setLevelListener(null);
        }
        boxes.forEach((box) => box.destroy());
    }

    // Initial device population (fire-and-forget; refreshDevices can be
    // called again by the orchestrator after permissions are granted).
    refreshDevices().catch((error) => {
        console.warn('Initial channel device population failed:', error);
    });

    return { refreshDevices, destroy };
}
