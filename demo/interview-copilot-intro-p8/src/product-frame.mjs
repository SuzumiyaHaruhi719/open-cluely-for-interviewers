import { deriveReplayState } from './replay-state.mjs';
import { advanceFastForward } from './fast-forward.mjs';
import {
  LIVE_CAPTION_INTERVAL_MS,
  advanceLiveCaptionText,
  initialLiveCaptionText,
  reconcileLiveCaptionText
} from './live-caption.mjs';
import {
  deriveSummaryReplayState,
  renderSummaryMarkdown,
  summaryFixture
} from './summary-replay.mjs';
import {
  contextWindow,
  completeCues as cues,
  COMPLETE_DURATION_MS as DEMO_DURATION_MS,
  questionEvent,
  roleConfirmedMs
} from './full-timeline.mjs';

const root = document;
const app = root.querySelector('#product-app');
const audio = root.querySelector('#demo-audio');
const chat = root.querySelector('#chat-messages');
const progress = root.querySelector('#replay-progress');
const fastForwardButton = root.querySelector('#fast-forward');
const fastForwardLabel = root.querySelector('#fast-forward-label');
const headerClock = root.querySelector('#header-clock');
const dockClock = root.querySelector('#dock-clock');
const runtimeState = root.querySelector('#runtime-state');
const runtimeLabel = root.querySelector('#runtime-label');
const candidateChannel = root.querySelector('#candidate-channel');
const interviewerChannel = root.querySelector('#interviewer-channel');
const candidateToggle = root.querySelector('#candidate-toggle');
const interviewerToggle = root.querySelector('#interviewer-toggle');
const manualQuestionButton = root.querySelector('#manual-question');
const contextToggle = root.querySelector('#context-toggle');
const contextDrawer = root.querySelector('#session-context-drawer');
const summaryModal = root.querySelector('#summary-modal');
const summaryPipeline = root.querySelector('#summary-pipeline');
const summaryPhaseLabel = root.querySelector('#summary-phase-label');
const summaryProgressLabel = root.querySelector('#summary-progress-label');
const summaryProgressFill = root.querySelector('#summary-progress-fill');
const summaryReport = root.querySelector('#summary-report');
const summaryStageNodes = [...root.querySelectorAll('[data-summary-stage]')];
const summaryCopyButton = root.querySelector('#summary-copy');
const summaryRegenerateButton = root.querySelector('#summary-regenerate');
const noteInput = root.querySelector('#note-input');
const noteSubmit = root.querySelector('#note-submit');
const questionMarkup = root.querySelector('#question-card-template').innerHTML.trim();

let animationFrame = 0;
let fastForwardFrame = 0;
let fastForwardRun = null;
let summaryReplayFrame = 0;
let summaryReplayStartedAt = null;
let summaryReplayComplete = false;
let lastTimelineSignature = '';
let questionWasVisible = false;
let manualQuestionVisible = false;
let manualContextOpen = null;
let manualSummaryOpen = false;
let summaryDismissedAtCompletion = false;
let interviewerChannelOn = false;
let endedByUser = false;
let clearedBeforeMs = -1;
let noteSequence = 0;
let notes = [];
const liveCaptionTargets = new Map();

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatClock = (timeMs, includeHours = true) => {
  const seconds = Math.max(0, Math.floor(timeMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = [minutes, remainder].map((value) => String(value).padStart(2, '0'));
  if (includeHours) parts.unshift(String(hours).padStart(2, '0'));
  return parts.join(':');
};

const icon = (id) => root.querySelector(`#${id}`)?.innerHTML.trim() ?? '';

function currentTimeMs() {
  return Math.min(DEMO_DURATION_MS, Math.max(0, Math.round(audio.currentTime * 1000)));
}

function cancelFastForward() {
  if (!fastForwardRun) return false;
  cancelAnimationFrame(fastForwardFrame);
  audio.muted = fastForwardRun.wasMuted;
  fastForwardRun = null;
  fastForwardButton.dataset.state = 'idle';
  fastForwardLabel.textContent = '快进至总结';
  return true;
}

function fastForwardStep(nowMs) {
  if (!fastForwardRun) return;
  const next = advanceFastForward({
    fromTimeMs: fastForwardRun.fromTimeMs,
    startedAtMs: fastForwardRun.startedAtMs,
    nowMs,
    durationMs: DEMO_DURATION_MS
  });
  audio.currentTime = next.timeMs / 1000;
  lastTimelineSignature = '';
  render();
  if (next.complete) {
    cancelFastForward();
    render();
    return;
  }
  fastForwardFrame = requestAnimationFrame(fastForwardStep);
}

function startFastForward() {
  if (currentTimeMs() >= DEMO_DURATION_MS) {
    manualSummaryOpen = true;
    summaryDismissedAtCompletion = false;
    render();
    return;
  }
  cancelFastForward();
  audio.pause();
  cancelAnimationFrame(animationFrame);
  fastForwardRun = {
    fromTimeMs: currentTimeMs(),
    startedAtMs: performance.now(),
    wasMuted: audio.muted
  };
  audio.muted = true;
  fastForwardButton.dataset.state = 'active';
  fastForwardLabel.textContent = '60× 快进中';
  fastForwardFrame = requestAnimationFrame(fastForwardStep);
  render();
}

function stateAtCurrentTime() {
  return deriveReplayState({
    timeMs: currentTimeMs(),
    cues,
    questionEvent,
    roleConfirmedMs,
    contextWindow,
    demoDurationMs: DEMO_DURATION_MS
  });
}

function applySummaryReplayFrame(nowMs) {
  if (summaryReplayStartedAt === null) return;
  const state = deriveSummaryReplayState({ elapsedMs: nowMs - summaryReplayStartedAt });
  summaryPipeline.dataset.phase = state.phase;
  summaryPhaseLabel.textContent = state.phaseLabel;
  summaryProgressLabel.textContent = `${Math.round(state.progress * 100)}%`;
  summaryProgressFill.style.width = `${state.progress * 100}%`;
  for (const node of summaryStageNodes) {
    const index = Number(node.dataset.summaryStage);
    node.dataset.state = index < state.stageIndex ? 'done' : index === state.stageIndex ? 'active' : 'pending';
  }
  summaryReport.hidden = state.visibleMarkdown.length === 0;
  if (state.visibleMarkdown) summaryReport.innerHTML = renderSummaryMarkdown(state.visibleMarkdown);
  summaryReplayComplete = state.phase === 'complete';
  summaryCopyButton.disabled = !summaryReplayComplete;
  summaryRegenerateButton.disabled = !summaryReplayComplete;
  cancelAnimationFrame(summaryReplayFrame);
  if (!summaryReplayComplete) summaryReplayFrame = requestAnimationFrame(applySummaryReplayFrame);
}

function startSummaryReplay({ restart = false } = {}) {
  if (summaryReplayStartedAt !== null && !restart) return;
  cancelAnimationFrame(summaryReplayFrame);
  summaryReplayStartedAt = performance.now();
  summaryReplayComplete = false;
  summaryReport.innerHTML = '';
  summaryReport.hidden = true;
  applySummaryReplayFrame(summaryReplayStartedAt);
}

function resetSummaryReplay() {
  cancelAnimationFrame(summaryReplayFrame);
  summaryReplayStartedAt = null;
  summaryReplayComplete = false;
  summaryPipeline.dataset.phase = 'evidence';
  summaryPhaseLabel.textContent = '校验完整证据';
  summaryProgressLabel.textContent = '0%';
  summaryProgressFill.style.width = '0%';
  summaryReport.innerHTML = '';
  summaryReport.hidden = true;
  summaryCopyButton.disabled = true;
  summaryRegenerateButton.disabled = true;
  for (const node of summaryStageNodes) node.dataset.state = 'pending';
}

function rolePresentation(cue, state) {
  if (cue.role === 'candidate' && state.candidateRole === 'pending') {
    return { lane: 'unknown', label: `待确认 · 说话人 ${cue.speakerId}`, iconId: 'icon-unknown' };
  }
  if (cue.role === 'candidate') return { lane: 'candidate', label: '候选人', iconId: 'icon-candidate' };
  if (cue.role === 'interviewer') return { lane: 'interviewer', label: '面试官', iconId: 'icon-interviewer' };
  return { lane: 'unknown', label: `非参与者 · 说话人 ${cue.speakerId}`, iconId: 'icon-unknown' };
}

function roleActions(role) {
  const interviewerActive = role.lane === 'interviewer' ? ' is-active' : '';
  const candidateActive = role.lane === 'candidate' ? ' is-active' : '';
  return `<span class="speaker-role-actions" aria-label="声纹角色">
    <button class="speaker-role-toggle${interviewerActive}" type="button" tabindex="-1">面试官</button>
    <button class="speaker-role-toggle${candidateActive}" type="button" tabindex="-1">候选人</button>
  </span>`;
}

function liveCaptionMarkup(text) {
  const target = String(text ?? '');
  const initial = initialLiveCaptionText(target);
  return `<span data-live-caption="visual" aria-hidden="true">${escapeHtml(initial)}</span><span class="live-caption__sr" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(target)}</span>`;
}

function transcriptRow(cue, state) {
  const role = rolePresentation(cue, state);
  const content = cue.isLive ? liveCaptionMarkup(cue.visibleText) : escapeHtml(cue.visibleText);
  return `<div class="chat-message lane-${role.lane}${cue.isLive ? ' is-live' : ''} has-role-toggle" data-cue-id="${escapeHtml(cue.id)}">
    <time class="transcript-time" datetime="PT${Math.floor(cue.startMs / 1000)}S">${formatClock(cue.startMs)}</time>
    <div class="message-header">
      <span class="message-icon" aria-hidden="true">${icon(role.iconId)}</span>
      <span class="message-label">${cue.isLive ? '输入中…' : escapeHtml(role.label)}</span>
      ${roleActions(role)}
    </div>
    <div class="message-content">${content}</div>
  </div>`;
}

function noteRow(note) {
  return `<div class="chat-message lane-note" data-note-id="${note.id}">
    <time class="transcript-time" datetime="PT${Math.floor(note.startMs / 1000)}S">${formatClock(note.startMs)}</time>
    <div class="message-header">
      <span class="message-icon" aria-hidden="true">${icon('icon-note')}</span>
      <span class="message-label">备注</span>
    </div>
    <div class="message-content">${escapeHtml(note.text)}</div>
  </div>`;
}

function renderTimeline(state, questionJustAppeared = false) {
  const wasNearBottom = chat.scrollHeight - chat.clientHeight - chat.scrollTop <= 64;
  const previousScrollTop = chat.scrollTop;
  const questionVisible = state.questionVisible || manualQuestionVisible;
  const visibleCues = state.visibleCues.filter((cue) => cue.startMs > clearedBeforeMs);
  const events = [
    ...visibleCues.map((cue, order) => ({ kind: 'cue', startMs: cue.startMs, order, cue })),
    ...notes.filter((note) => note.startMs > clearedBeforeMs).map((note, order) => ({ kind: 'note', startMs: note.startMs, order, note }))
  ].sort((left, right) => left.startMs - right.startMs || (left.kind === 'cue' ? -1 : 1) || left.order - right.order);

  let questionInserted = false;
  const rows = [];
  for (const event of events) {
    if (event.kind === 'note') {
      rows.push(noteRow(event.note));
      continue;
    }
    rows.push(transcriptRow(event.cue, state));
    if (questionVisible && event.cue.id === questionEvent.anchorCueId) {
      rows.push(questionMarkup);
      questionInserted = true;
    }
  }
  if (questionVisible && !questionInserted && rows.length > 0) rows.push(questionMarkup);
  chat.innerHTML = rows.join('');
  patchTimelineText(state);
  if (questionJustAppeared) {
    const card = chat.querySelector('.is-question-card');
    if (card) chat.scrollTop = Math.max(0, card.offsetTop - 8);
  }
  else if (wasNearBottom) chat.scrollTop = chat.scrollHeight;
  else chat.scrollTop = previousScrollTop;
}

function timelineStructureSignature(state) {
  const visibleCues = state.visibleCues.filter((cue) => cue.startMs > clearedBeforeMs);
  const visibleNotes = notes.filter((note) => note.startMs > clearedBeforeMs);
  return JSON.stringify([
    state.candidateRole,
    state.questionVisible || manualQuestionVisible,
    clearedBeforeMs,
    visibleCues.map((cue) => [cue.id, cue.role, cue.speakerId, cue.startMs, cue.endMs, cue.isLive]),
    visibleNotes.map((note) => [note.id, note.startMs])
  ]);
}

function patchTimelineText(state) {
  const cueById = new Map(
    state.visibleCues
      .filter((cue) => cue.startMs > clearedBeforeMs)
      .map((cue) => [cue.id, cue])
  );
  const activeLiveCueIds = new Set();

  for (const row of chat.querySelectorAll('.chat-message[data-cue-id]')) {
    const cue = cueById.get(row.dataset.cueId);
    if (!cue) continue;
    const content = row.querySelector('.message-content');
    if (!content) continue;

    if (!cue.isLive) {
      if (content.textContent !== cue.visibleText) content.textContent = cue.visibleText;
      continue;
    }

    activeLiveCueIds.add(cue.id);
    liveCaptionTargets.set(cue.id, cue.visibleText);
    const visual = content.querySelector('[data-live-caption="visual"]');
    const assistive = content.querySelector('.live-caption__sr');
    if (visual) {
      const reconciled = reconcileLiveCaptionText(visual.textContent ?? '', cue.visibleText);
      if (visual.textContent !== reconciled) visual.textContent = reconciled;
    }
    if (assistive && assistive.textContent !== cue.visibleText) assistive.textContent = cue.visibleText;
  }

  for (const cueId of liveCaptionTargets.keys()) {
    if (!activeLiveCueIds.has(cueId)) liveCaptionTargets.delete(cueId);
  }
}

function advanceLiveCaptions() {
  const wasNearBottom = chat.scrollHeight - chat.clientHeight - chat.scrollTop <= 64;
  let revealed = false;
  for (const row of chat.querySelectorAll('.chat-message.is-live[data-cue-id]')) {
    const target = liveCaptionTargets.get(row.dataset.cueId);
    const visual = row.querySelector('[data-live-caption="visual"]');
    if (target === undefined || !visual) continue;
    const next = advanceLiveCaptionText(visual.textContent ?? '', target);
    if (next === visual.textContent) continue;
    visual.textContent = next;
    revealed = true;
  }
  if (revealed && wasNearBottom) chat.scrollTop = chat.scrollHeight;
}

function setChannelState(channel, toggle, on) {
  channel.classList.toggle('is-on', on);
  const status = channel.querySelector('.channel-status');
  status.dataset.state = on ? 'listening' : 'off';
  status.textContent = on ? '录音中' : '关闭';
  toggle.classList.toggle('on', on);
  toggle.textContent = on ? '停止' : '开始';
}

function applyContext(state) {
  const open = manualContextOpen ?? state.contextAutoOpen;
  contextDrawer.dataset.open = open ? 'true' : 'false';
  contextDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  contextDrawer.querySelector('.context-drawer__body').tabIndex = open ? 0 : -1;
  contextToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  contextToggle.setAttribute('aria-label', open ? '关闭会话上下文' : '打开会话上下文');
}

function applySummary(state) {
  const open = manualSummaryOpen || (state.summaryVisible && !summaryDismissedAtCompletion);
  summaryModal.hidden = !open;
  if (open) startSummaryReplay();
}

function updateRuntime(state) {
  const playing = !audio.paused && !audio.ended;
  const fastForwarding = Boolean(fastForwardRun);
  const ended = endedByUser || state.summaryVisible;
  runtimeState.dataset.state = ended ? 'ended' : fastForwarding ? 'connecting' : playing ? 'live' : 'idle';
  runtimeLabel.textContent = ended ? '已结束' : fastForwarding ? '60× 快进中' : playing ? '直播中' : '待录音';
  headerClock.textContent = formatClock(state.timeMs);
  headerClock.dateTime = `PT${Math.floor(state.timeMs / 1000)}S`;
  const elapsedLabel = formatClock(state.timeMs, false);
  const durationLabel = formatClock(DEMO_DURATION_MS, false);
  dockClock.textContent = `${elapsedLabel} / ${durationLabel}`;
  progress.value = String(state.timeMs);
  progress.style.setProperty('--replay-percent', `${(state.timeMs / DEMO_DURATION_MS) * 100}%`);
  progress.setAttribute('aria-valuetext', `${elapsedLabel} / ${durationLabel}`);
  fastForwardButton.disabled = ended;
  fastForwardButton.setAttribute('aria-pressed', fastForwarding ? 'true' : 'false');
  manualQuestionButton.disabled = state.candidateRole !== 'candidate' || ended;
  manualQuestionButton.title = manualQuestionButton.disabled ? '等待候选人回答后可用' : '立即根据候选人证据生成一个专家追问';
  setChannelState(candidateChannel, candidateToggle, playing);
  setChannelState(interviewerChannel, interviewerToggle, interviewerChannelOn || playing);
  app.dataset.monitorState = state.monitorState;
}

function render() {
  const state = stateAtCurrentTime();
  const questionNowVisible = state.questionVisible || manualQuestionVisible;
  const questionJustAppeared = questionNowVisible && !questionWasVisible;
  const signature = timelineStructureSignature(state);
  if (signature !== lastTimelineSignature) {
    renderTimeline(state, questionJustAppeared);
    lastTimelineSignature = signature;
  }
  else patchTimelineText(state);
  questionWasVisible = questionNowVisible;
  updateRuntime(state);
  applyContext(state);
  applySummary(state);
  cancelAnimationFrame(animationFrame);
  if (!audio.paused && !audio.ended) animationFrame = requestAnimationFrame(render);
}

setInterval(advanceLiveCaptions, LIVE_CAPTION_INTERVAL_MS);

async function play() {
  cancelFastForward();
  if (currentTimeMs() >= DEMO_DURATION_MS) {
    audio.currentTime = 0;
    endedByUser = false;
    manualSummaryOpen = false;
    summaryDismissedAtCompletion = false;
    resetSummaryReplay();
  }
  try {
    await audio.play();
    render();
  } catch {
    runtimeState.dataset.state = 'connecting';
    runtimeLabel.textContent = '点击开始播放';
  }
}

function pause() {
  cancelFastForward();
  audio.pause();
  cancelAnimationFrame(animationFrame);
  render();
}

function togglePlayback() {
  if (audio.paused || audio.ended) void play();
  else pause();
}

function seekTo(timeMs) {
  cancelFastForward();
  const target = Math.min(DEMO_DURATION_MS, Math.max(0, Number(timeMs) || 0));
  audio.currentTime = target / 1000;
  endedByUser = false;
  manualSummaryOpen = false;
  summaryDismissedAtCompletion = false;
  resetSummaryReplay();
  lastTimelineSignature = '';
  render();
}

function reset({ autoplay = true } = {}) {
  pause();
  audio.currentTime = 0;
  manualQuestionVisible = false;
  questionWasVisible = false;
  manualContextOpen = null;
  manualSummaryOpen = false;
  summaryDismissedAtCompletion = false;
  resetSummaryReplay();
  interviewerChannelOn = false;
  endedByUser = false;
  clearedBeforeMs = -1;
  notes = [];
  lastTimelineSignature = '';
  render();
  if (autoplay) void play();
}

function closeSummary() {
  manualSummaryOpen = false;
  if (!summaryReplayComplete) resetSummaryReplay();
  if (stateAtCurrentTime().summaryVisible) summaryDismissedAtCompletion = true;
  render();
}

candidateToggle.addEventListener('click', togglePlayback);
interviewerToggle.addEventListener('click', () => {
  interviewerChannelOn = !interviewerChannelOn;
  render();
});
progress.addEventListener('input', () => seekTo(progress.value));
fastForwardButton.addEventListener('click', startFastForward);
root.querySelector('#replay-reset').addEventListener('click', () => reset({ autoplay: true }));

manualQuestionButton.addEventListener('click', () => {
  manualQuestionVisible = true;
  questionWasVisible = false;
  lastTimelineSignature = '';
  render();
  const card = chat.querySelector('.is-question-card');
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

root.querySelector('#clear-transcript').addEventListener('click', () => {
  clearedBeforeMs = currentTimeMs();
  manualQuestionVisible = false;
  notes = [];
  lastTimelineSignature = '';
  render();
});

contextToggle.addEventListener('click', () => {
  const open = contextDrawer.dataset.open === 'true';
  manualContextOpen = !open;
  render();
});
root.querySelector('#context-close').addEventListener('click', () => {
  manualContextOpen = false;
  render();
});

root.querySelector('#summary-toggle').addEventListener('click', () => {
  if (currentTimeMs() < DEMO_DURATION_MS) {
    startFastForward();
    return;
  }
  manualSummaryOpen = true;
  summaryDismissedAtCompletion = false;
  render();
});
root.querySelector('#end-interview').addEventListener('click', () => {
  if (currentTimeMs() < DEMO_DURATION_MS) {
    startFastForward();
    return;
  }
  manualSummaryOpen = true;
  render();
});
root.querySelector('#summary-close').addEventListener('click', closeSummary);
root.querySelector('#summary-done').addEventListener('click', closeSummary);
summaryModal.addEventListener('mousedown', (event) => {
  if (event.target === summaryModal) closeSummary();
});

summaryCopyButton.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(summaryFixture.reportMarkdown);
    button.textContent = '已复制';
  } catch {
    button.textContent = '请手动复制';
  }
  window.setTimeout(() => { button.textContent = '复制'; }, 1600);
});
summaryRegenerateButton.addEventListener('click', () => {
  startSummaryReplay({ restart: true });
});

root.querySelector('#theme-toggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  const button = root.querySelector('#theme-toggle');
  root.querySelector('#theme-icon').innerHTML = icon(dark ? 'icon-moon' : 'icon-sun');
  button.setAttribute('aria-label', dark ? '切换深色模式' : '切换浅色模式');
  button.setAttribute('title', dark ? '切换深色模式' : '切换浅色模式');
});

noteInput.addEventListener('input', () => {
  noteSubmit.disabled = noteInput.value.trim().length === 0;
});
root.querySelector('#note-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = noteInput.value.trim();
  if (!text) return;
  notes.push({ id: ++noteSequence, text, startMs: currentTimeMs() });
  noteInput.value = '';
  noteSubmit.disabled = true;
  lastTimelineSignature = '';
  render();
});

audio.addEventListener('play', render);
audio.addEventListener('pause', render);
audio.addEventListener('timeupdate', render);
audio.addEventListener('seeked', () => {
  lastTimelineSignature = '';
  render();
});
audio.addEventListener('ended', () => {
  cancelAnimationFrame(animationFrame);
  render();
});

window.addEventListener('message', (event) => {
  if (event.data === 'pause-product-frame') pause();
  if (event.data === 'reset-product-frame') reset({ autoplay: false });
});

root.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && fastForwardRun) {
    event.preventDefault();
    cancelFastForward();
    render();
    return;
  }
  if (event.key === 'Escape' && !summaryModal.hidden) {
    event.preventDefault();
    closeSummary();
    return;
  }
  if (event.key === 'Escape' && contextDrawer.dataset.open === 'true') {
    event.preventDefault();
    manualContextOpen = false;
    render();
  }
});

render();
