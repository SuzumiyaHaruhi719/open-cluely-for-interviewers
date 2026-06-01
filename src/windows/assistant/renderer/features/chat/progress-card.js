// Chat-stream progress card for the interviewer Expert follow-up chain.
// Starts indeterminate ("生成追问中…"); the first Expert progress event upgrades
// it to a determinate, weighted bar. Fast mode sends no progress events, so the
// card stays indeterminate until finish/fail. Owns the phase labels + weights
// (UI concerns); the orchestrator only emits phase ids + index/total + status.

const PHASES = [
    { id: 'answer', label: '拆解回答、梳理上下文…', weight: 0.15 },
    { id: 'gaps',   label: '查找证据缺口…',         weight: 0.12 },
    { id: 'pool',   label: '生成候选问题…',         weight: 0.18 },
    { id: 'rank',   label: '排序打分（深度推理）…', weight: 0.35 },
    { id: 'safety', label: '安全审查…',             weight: 0.10 },
    { id: 'render', label: '整理成稿…',             weight: 0.10 }
];

// Cumulative [start, end] fraction (0..1) for each phase, in declared order.
const BOUNDS = (() => {
    let acc = 0;
    const map = {};
    for (const p of PHASES) {
        const start = acc;
        acc += p.weight;
        map[p.id] = { start, end: acc, label: p.label };
    }
    return map;
})();

const CREEP_CEILING = 0.92; // fraction of the way to segment end the creep targets

export function createProgressCard({ chatMessagesElement, isAutoScrollEnabled = () => true }) {
    let activeRequestId = null;
    let cardEl = null;
    let fillEl = null;
    let labelEl = null;
    let tokensEl = null;
    let timerEl = null;
    let timerStart = 0;
    let timerId = null;
    let totalInput = 0;
    let totalOutput = 0;
    let rafId = null;
    let creepFrom = 0;   // fraction
    let creepTo = 0;     // fraction
    let creepStart = 0;  // ms timestamp
    let creepDurationMs = 0;

    function nearBottom() {
        if (!chatMessagesElement) return true;
        const d = chatMessagesElement.scrollHeight - chatMessagesElement.clientHeight - chatMessagesElement.scrollTop;
        return d <= 28;
    }

    function setFill(fraction) {
        if (!fillEl) return;
        const pct = Math.max(0, Math.min(100, fraction * 100));
        fillEl.style.width = `${pct}%`;
    }

    function stopCreep() {
        if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    // Ease the fill from creepFrom toward creepTo over creepDurationMs, then hold.
    function creepTick(now) {
        const t = Math.min(1, (now - creepStart) / creepDurationMs);
        // easeOutCubic so it decelerates as it approaches the ceiling.
        const eased = 1 - Math.pow(1 - t, 3);
        setFill(creepFrom + (creepTo - creepFrom) * eased);
        if (t < 1) {
            rafId = requestAnimationFrame(creepTick);
        } else {
            rafId = null;
        }
    }

    function startCreep(from, to, durationMs) {
        stopCreep();
        creepFrom = from;
        creepTo = to;
        creepStart = performance.now();
        creepDurationMs = Math.max(200, durationMs);
        rafId = requestAnimationFrame(creepTick);
    }

    function stopTimer() { if (timerId != null) { clearInterval(timerId); timerId = null; } }
    function updateTimer() {
        if (!timerEl) return;
        timerEl.textContent = `⏱ ${((performance.now() - timerStart) / 1000).toFixed(1)}s`;
    }

    function updateTokens() {
        if (!tokensEl) return;
        const total = totalInput + totalOutput;
        if (total <= 0) {
            tokensEl.textContent = '';
            return;
        }
        tokensEl.textContent = `${total.toLocaleString()} tok`;
        tokensEl.title = `输入 ${totalInput.toLocaleString()} · 输出 ${totalOutput.toLocaleString()} tokens`;
    }

    function remove() {
        stopCreep();
        stopTimer();
        if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
        cardEl = null; fillEl = null; labelEl = null; tokensEl = null; timerEl = null; activeRequestId = null;
        totalInput = 0; totalOutput = 0;
    }

    function start({ requestId } = {}) {
        remove(); // clear any stale card
        activeRequestId = requestId != null ? String(requestId) : null;
        totalInput = 0;
        totalOutput = 0;

        const shouldScroll = nearBottom();
        cardEl = document.createElement('div');
        cardEl.className = 'chat-message interviewer-coach-message lane-ai chat-progress-card is-indeterminate';

        // Head row: phase label (left) + live timer & running token spend (right).
        const head = document.createElement('div');
        head.className = 'chat-progress__head';
        labelEl = document.createElement('div');
        labelEl.className = 'chat-progress__label';
        labelEl.textContent = '生成追问中…';
        const meta = document.createElement('div');
        meta.className = 'chat-progress__meta';
        timerEl = document.createElement('div');
        timerEl.className = 'chat-progress__timer';
        timerEl.textContent = '⏱ 0.0s';
        tokensEl = document.createElement('div');
        tokensEl.className = 'chat-progress__tokens';
        tokensEl.textContent = '';
        meta.append(timerEl, tokensEl);
        head.append(labelEl, meta);
        // Live elapsed timer — ticks until finish/fail.
        timerStart = performance.now();
        stopTimer();
        timerId = setInterval(updateTimer, 100);

        const bar = document.createElement('div');
        bar.className = 'chat-progress__bar';
        fillEl = document.createElement('div');
        fillEl.className = 'chat-progress__fill';
        bar.appendChild(fillEl);

        cardEl.append(head, bar);
        chatMessagesElement.appendChild(cardEl);
        if (shouldScroll && isAutoScrollEnabled()) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }
    }

    function advance(evt = {}) {
        if (!cardEl) return;
        const reqId = evt.requestId != null ? String(evt.requestId) : null;
        if (activeRequestId != null && reqId != null && reqId !== activeRequestId) return; // stale
        const bound = BOUNDS[evt.phase];
        if (!bound) return;

        // First real event upgrades from indeterminate to determinate.
        cardEl.classList.remove('is-indeterminate');

        // Accumulate token spend as each phase completes (real-time-ish: token
        // usage is only known when a block returns).
        if (evt.tokens) {
            totalInput += Number(evt.tokens.input) || 0;
            totalOutput += Number(evt.tokens.output) || 0;
            updateTokens();
        }

        if (evt.status === 'start') {
            // Show which model this phase runs on (e.g. "排序打分 · deepseek-v4-flash").
            labelEl.textContent = evt.model ? `${bound.label} · ${evt.model}` : bound.label;
            // Creep across most of this segment over an estimated time; a slow
            // phase (rank/E) keeps inching forward instead of dead-stopping.
            const ceiling = bound.start + (bound.end - bound.start) * CREEP_CEILING;
            const estMs = Math.max(1200, (bound.end - bound.start) * 60000); // weight×60s heuristic
            startCreep(bound.start, ceiling, estMs);
        } else if (evt.status === 'done') {
            stopCreep();
            setFill(bound.end); // snap to segment end
        }
    }

    function finish(requestId) {
        if (!cardEl) return;
        if (requestId != null && activeRequestId != null && String(requestId) !== activeRequestId) return;
        stopCreep();
        setFill(1);
        remove();
    }

    function fail(requestId) {
        if (!cardEl) return;
        if (requestId != null && activeRequestId != null && String(requestId) !== activeRequestId) return;
        stopCreep();
        remove();
    }

    return { start, advance, finish, fail };
}
