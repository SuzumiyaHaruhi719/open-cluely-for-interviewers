import { deriveReplayState } from './replay-state.mjs';
import {
  contextWindow,
  cues,
  DEMO_DURATION_MS,
  questionEvent,
  roleConfirmedMs
} from './timeline.mjs';

const root = document;
const app = root.querySelector('#product-app');
const audio = root.querySelector('#demo-audio');
const chat = root.querySelector('#chat-messages');
const progress = root.querySelector('#replay-progress');
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
const noteInput = root.querySelector('#note-input');
const noteSubmit = root.querySelector('#note-submit');
const questionMarkup = root.querySelector('#question-card-template').innerHTML.trim();

let animationFrame = 0;
let lastTimelineSignature = '';
let manualQuestionVisible = false;
let manualContextOpen = null;
let manualSummaryOpen = false;
let summaryDismissedAtCompletion = false;
let interviewerChannelOn = false;
let endedByUser = false;
let clearedBeforeMs = -1;
let noteSequence = 0;
let notes = [];

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

function rolePresentation(cue, state) {
  if (cue.role === 'candidate' && state.candidateRole === 'pending') {
    return { lane: 'unknown', label: `待确认 · 说话人 ${cue.speakerId}`, iconId: 'icon-unknown' };
  }
  if (cue.role === 'candidate') return { lane: 'candidate', label: '候选人', iconId: 'icon-candidate' };
  return { lane: 'interviewer', label: '面试官', iconId: 'icon-interviewer' };
}

function roleActions(role) {
  const interviewerActive = role.lane === 'interviewer' ? ' is-active' : '';
  const candidateActive = role.lane === 'candidate' ? ' is-active' : '';
  return `<span class="speaker-role-actions" aria-label="声纹角色">
    <button class="speaker-role-toggle${interviewerActive}" type="button" tabindex="-1">面试官</button>
    <button class="speaker-role-toggle${candidateActive}" type="button" tabindex="-1">候选人</button>
  </span>`;
}

function transcriptRow(cue, state) {
  const role = rolePresentation(cue, state);
  return `<div class="chat-message lane-${role.lane}${cue.isLive ? ' is-live' : ''} has-role-toggle" data-cue-id="${escapeHtml(cue.id)}">
    <time class="transcript-time" datetime="PT${Math.floor(cue.startMs / 1000)}S">${formatClock(cue.startMs)}</time>
    <div class="message-header">
      <span class="message-icon" aria-hidden="true">${icon(role.iconId)}</span>
      <span class="message-label">${cue.isLive ? '输入中…' : escapeHtml(role.label)}</span>
      ${roleActions(role)}
    </div>
    <div class="message-content">${escapeHtml(cue.visibleText)}</div>
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

function renderTimeline(state) {
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
  if (wasNearBottom) chat.scrollTop = chat.scrollHeight;
  else chat.scrollTop = previousScrollTop;
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
}

function updateRuntime(state) {
  const playing = !audio.paused && !audio.ended;
  const ended = endedByUser || state.summaryVisible;
  runtimeState.dataset.state = ended ? 'ended' : playing ? 'live' : 'idle';
  runtimeLabel.textContent = ended ? '已结束' : playing ? '直播中' : '待录音';
  headerClock.textContent = formatClock(state.timeMs);
  headerClock.dateTime = `PT${Math.floor(state.timeMs / 1000)}S`;
  dockClock.textContent = `${formatClock(state.timeMs, false)} / ${formatClock(DEMO_DURATION_MS, false)}`;
  progress.value = String(state.timeMs);
  manualQuestionButton.disabled = state.candidateRole !== 'candidate' || ended;
  manualQuestionButton.title = manualQuestionButton.disabled ? '等待候选人回答后可用' : '立即根据候选人证据生成一个专家追问';
  setChannelState(candidateChannel, candidateToggle, playing);
  setChannelState(interviewerChannel, interviewerToggle, interviewerChannelOn || playing);
  app.dataset.monitorState = state.monitorState;
}

function render() {
  const state = stateAtCurrentTime();
  const signature = [
    state.candidateRole,
    state.questionVisible || manualQuestionVisible,
    clearedBeforeMs,
    notes.length,
    ...state.visibleCues.map((cue) => `${cue.id}:${cue.visibleText.length}:${cue.isLive}`)
  ].join('|');
  if (signature !== lastTimelineSignature) {
    renderTimeline(state);
    lastTimelineSignature = signature;
  }
  updateRuntime(state);
  applyContext(state);
  applySummary(state);
  cancelAnimationFrame(animationFrame);
  if (!audio.paused && !audio.ended) animationFrame = requestAnimationFrame(render);
}

async function play() {
  if (audio.ended || currentTimeMs() >= DEMO_DURATION_MS) {
    audio.currentTime = 0;
    endedByUser = false;
    manualSummaryOpen = false;
    summaryDismissedAtCompletion = false;
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
  audio.pause();
  cancelAnimationFrame(animationFrame);
  render();
}

function togglePlayback() {
  if (audio.paused || audio.ended) void play();
  else pause();
}

function seekTo(timeMs) {
  const target = Math.min(DEMO_DURATION_MS, Math.max(0, Number(timeMs) || 0));
  audio.currentTime = target / 1000;
  endedByUser = false;
  manualSummaryOpen = false;
  summaryDismissedAtCompletion = false;
  lastTimelineSignature = '';
  render();
}

function reset({ autoplay = true } = {}) {
  pause();
  audio.currentTime = 0;
  manualQuestionVisible = false;
  manualContextOpen = null;
  manualSummaryOpen = false;
  summaryDismissedAtCompletion = false;
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
  if (stateAtCurrentTime().summaryVisible) summaryDismissedAtCompletion = true;
  render();
}

candidateToggle.addEventListener('click', togglePlayback);
interviewerToggle.addEventListener('click', () => {
  interviewerChannelOn = !interviewerChannelOn;
  render();
});
progress.addEventListener('input', () => seekTo(progress.value));
root.querySelector('#replay-reset').addEventListener('click', () => reset({ autoplay: true }));

manualQuestionButton.addEventListener('click', () => {
  manualQuestionVisible = true;
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
  manualSummaryOpen = true;
  summaryDismissedAtCompletion = false;
  render();
});
root.querySelector('#end-interview').addEventListener('click', () => {
  pause();
  endedByUser = true;
  manualSummaryOpen = true;
  render();
});
root.querySelector('#summary-close').addEventListener('click', closeSummary);
root.querySelector('#summary-done').addEventListener('click', closeSummary);
summaryModal.addEventListener('mousedown', (event) => {
  if (event.target === summaryModal) closeSummary();
});

root.querySelector('#summary-copy').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const text = root.querySelector('#summary-report').innerText;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = '已复制';
  } catch {
    button.textContent = '请手动复制';
  }
  window.setTimeout(() => { button.textContent = '复制'; }, 1600);
});
root.querySelector('#summary-regenerate').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.textContent = '已根据当前证据更新';
  window.setTimeout(() => { button.textContent = '重新生成'; }, 1600);
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
