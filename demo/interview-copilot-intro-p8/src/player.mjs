import { deriveReplayState } from './replay-state.mjs';

const formatTime = (timeMs) => {
  const seconds = Math.max(0, Math.floor(timeMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function rolePresentation(cue, state) {
  if (cue.role === 'candidate' && state.candidateRole === 'pending') {
    return { role: 'pending', icon: '?', label: `待确认 · 说话人 ${cue.speakerId}` };
  }
  if (cue.role === 'candidate') return { role: 'candidate', icon: '●', label: '候选人' };
  return { role: 'interviewer', icon: '●', label: '面试官' };
}

function transcriptRow(cue, state) {
  const role = rolePresentation(cue, state);
  const interviewerSelected = role.role === 'interviewer' ? 'is-selected' : '';
  const candidateSelected = role.role === 'candidate' ? 'is-selected' : '';
  return `
    <article class="transcript-row ${cue.isLive ? 'is-live' : ''}" data-role="${role.role}" data-cue-id="${cue.id}">
      <time>${formatTime(cue.startMs)}</time>
      <div class="transcript-line"><span class="role-icon">${role.icon}</span></div>
      <div class="transcript-body">
        <div class="transcript-label"><strong>${role.label}</strong><span class="role-pill interviewer ${interviewerSelected}">面试官</span><span class="role-pill candidate ${candidateSelected}">候选人</span></div>
        <p>${escapeHtml(cue.visibleText)}${cue.isLive ? '<i class="live-caret"></i>' : ''}</p>
      </div>
    </article>`;
}

function questionCard(questionEvent) {
  return `
    <article class="question-card" data-question-anchor="${questionEvent.anchorCueId}">
      <time>${formatTime(questionEvent.revealMs)}</time>
      <div class="question-line"><span>✦</span></div>
      <div class="question-body">
        <div class="question-label"><strong>AI 追问</strong><span>自动</span><span>专家</span><em>${(questionEvent.latencyMs / 1000).toFixed(1)} s</em></div>
        <p>${escapeHtml(questionEvent.text)}</p>
        <div class="question-evidence"><b>候选人证据</b><span>平台从“全”建立使用惯性，但何时、如何升级到“优”仍缺少判断标准。</span></div>
        <footer><span>专家</span><span>${questionEvent.tokens.toLocaleString('zh-CN')} 词元</span><span>${(questionEvent.latencyMs / 1000).toFixed(1)} s</span></footer>
      </div>
    </article>`;
}

export function renderTimeline(container, state, questionEvent) {
  const wasNearBottom = container.scrollHeight - container.clientHeight - container.scrollTop <= 48;
  const previousScrollTop = container.scrollTop;
  const rows = [];
  for (const cue of state.visibleCues) {
    rows.push(transcriptRow(cue, state));
    if (state.questionVisible && cue.id === questionEvent.anchorCueId) rows.push(questionCard(questionEvent));
  }
  container.innerHTML = rows.length
    ? rows.join('')
    : '<div class="replay-empty"><span>声纹与字幕会按原始录音时间出现在这里</span></div>';
  if (wasNearBottom) container.scrollTop = container.scrollHeight;
  else container.scrollTop = previousScrollTop;
}

function statusCopy(state) {
  if (state.monitorState === 'question-ready') return ['专家追问已就绪', '已确认候选人 · 问题已进入时间线'];
  if (state.monitorState === 'generating') return ['发现证据缺口 · 专家生成中', '已确认候选人 · 生成专家追问'];
  if (state.monitorState === 'monitoring') return ['监听候选人证据', '已确认候选人 · 自动监控中'];
  return ['真实产品数据回放', '候选人声纹采样中'];
}

export function createReplayPlayer({ root, audio, timeline, onStarted = () => {} }) {
  const startOverlay = root.querySelector('#replay-start');
  const startButton = root.querySelector('#replay-start-button');
  const playButton = root.querySelector('#replay-play');
  const muteButton = root.querySelector('#replay-mute');
  const progress = root.querySelector('#replay-progress');
  const timelineRoot = root.querySelector('#replay-timeline');
  const status = root.querySelector('#replay-status');
  const roleMonitor = root.querySelector('#role-monitor');
  const clock = root.querySelector('#replay-clock');
  const time = root.querySelector('#replay-time');
  let frame = 0;
  let started = false;
  let audioBroken = false;
  let fallbackActive = false;
  let fallbackElapsedMs = 0;
  let fallbackStartedAt = 0;
  let lastSignature = '';

  const fallbackTime = () => fallbackElapsedMs + (fallbackActive ? performance.now() - fallbackStartedAt : 0);
  const masterTime = () => Math.min(
    timeline.DEMO_DURATION_MS,
    Math.round(fallbackActive || audioBroken ? fallbackTime() : audio.currentTime * 1000)
  );

  function schedule() {
    cancelAnimationFrame(frame);
    if ((!audio.paused && !audio.ended && !audioBroken) || fallbackActive) frame = requestAnimationFrame(render);
  }

  function render() {
    const state = deriveReplayState({ timeMs: masterTime(), ...timeline });
    const signature = `${state.candidateRole}:${state.monitorState}:${state.questionVisible}:${state.visibleCues.map((cue) => `${cue.id}:${cue.visibleText.length}`).join('|')}`;
    if (signature !== lastSignature) {
      renderTimeline(timelineRoot, state, timeline.questionEvent);
      lastSignature = signature;
    }
    const [statusText, monitorText] = statusCopy(state);
    status.textContent = statusText;
    roleMonitor.textContent = monitorText;
    root.dataset.monitorState = state.monitorState;
    clock.textContent = formatTime(state.timeMs);
    time.textContent = `${formatTime(state.timeMs)} / ${formatTime(timeline.DEMO_DURATION_MS)}`;
    progress.value = String(Math.min(timeline.DEMO_DURATION_MS, state.timeMs));
    playButton.textContent = ((!audio.paused && !audioBroken) || fallbackActive) ? 'Ⅱ' : '▶';
    playButton.setAttribute('aria-label', ((!audio.paused && !audioBroken) || fallbackActive) ? '暂停' : '播放');
    if (fallbackActive && state.timeMs >= timeline.DEMO_DURATION_MS) pause();
    schedule();
  }

  function markStarted() {
    if (!started) {
      started = true;
      onStarted();
    }
    startOverlay.classList.add('is-hidden');
  }

  function pauseFallback() {
    if (!fallbackActive) return;
    fallbackElapsedMs = Math.min(timeline.DEMO_DURATION_MS, fallbackTime());
    fallbackActive = false;
  }

  function startFallback() {
    markStarted();
    fallbackStartedAt = performance.now();
    fallbackActive = true;
    render();
  }

  async function play() {
    if (audioBroken) {
      startFallback();
      return;
    }
    pauseFallback();
    try {
      await audio.play();
      markStarted();
      render();
    } catch {
      startOverlay.classList.remove('is-hidden');
      startOverlay.classList.add('needs-gesture');
      startOverlay.querySelector('strong').textContent = '浏览器需要再次确认播放';
      startButton.textContent = '点击播放声音';
      status.textContent = '等待播放许可';
      render();
    }
  }

  function pause() {
    audio.pause();
    pauseFallback();
    cancelAnimationFrame(frame);
    render();
  }

  function toggle() {
    if (fallbackActive || (!audioBroken && !audio.paused)) pause();
    else void play();
  }

  function seek(deltaMs) {
    const target = Math.max(0, Math.min(timeline.DEMO_DURATION_MS, masterTime() + deltaMs));
    if (audioBroken) {
      fallbackElapsedMs = target;
      fallbackStartedAt = performance.now();
    } else {
      audio.currentTime = target / 1000;
    }
    lastSignature = '';
    render();
  }

  function seekTo(valueMs) {
    const target = Math.max(0, Math.min(timeline.DEMO_DURATION_MS, Number(valueMs) || 0));
    if (audioBroken) {
      fallbackElapsedMs = target;
      fallbackStartedAt = performance.now();
    } else audio.currentTime = target / 1000;
    lastSignature = '';
    render();
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    muteButton.textContent = audio.muted ? '已静音' : '声音';
    muteButton.classList.toggle('is-muted', audio.muted);
  }

  function reset({ autoplay = false } = {}) {
    pause();
    audio.currentTime = 0;
    fallbackElapsedMs = 0;
    lastSignature = '';
    startOverlay.classList.toggle('is-hidden', autoplay);
    render();
    if (autoplay) void play();
  }

  function handleAudioError() {
    audioBroken = true;
    pauseFallback();
    status.textContent = '音频未能加载，可继续查看演示';
    roleMonitor.textContent = '字幕与追问仍可按时间回放';
    startOverlay.classList.remove('is-hidden');
    startOverlay.classList.add('audio-fallback');
    startOverlay.querySelector('strong').textContent = '音频未能加载';
    startButton.textContent = '静音查看 1 分 40 秒演示';
    startOverlay.querySelector('small').textContent = '点击后从头播放字幕与追问';
    render();
  }

  startButton.addEventListener('click', () => void play());
  playButton.addEventListener('click', toggle);
  muteButton.addEventListener('click', toggleMute);
  root.querySelector('#replay-reset').addEventListener('click', () => reset({ autoplay: true }));
  progress.addEventListener('input', () => {
    markStarted();
    seekTo(progress.value);
  });
  audio.addEventListener('play', render);
  audio.addEventListener('pause', render);
  audio.addEventListener('timeupdate', render);
  audio.addEventListener('seeked', () => { lastSignature = ''; render(); });
  audio.addEventListener('ended', render);
  audio.addEventListener('error', handleAudioError);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  render();

  return {
    play,
    pause,
    toggle,
    seek,
    seekTo,
    toggleMute,
    reset,
    isStarted: () => started,
    isPlaying: () => fallbackActive || (!audioBroken && !audio.paused)
  };
}
