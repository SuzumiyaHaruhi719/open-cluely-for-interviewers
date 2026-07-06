import type { InterviewerMode, OutputLanguage } from '@open-cluely/contract';
import type { SocketStatus } from '../lib/useCopilotSocket';

/** Topbar mode pill label + the `data-mode` attribute the copied CSS keys off. */
export interface ModeMeta {
  /** Human label shown in #mode-indicator and the segmented control. */
  label: string;
  /** Value for the `data-mode` attribute (fast | expert | expert2 | customize). */
  attr: InterviewerMode;
  /** Sub-description shown under each segmented button (verbatim from desktop). */
  desc: string;
}

export const MODE_META: Record<InterviewerMode, ModeMeta> = {
  fast: {
    label: '快速',
    attr: 'fast',
    desc: '低延迟两段式追问 · 默认'
  },
  expert: {
    label: '专家 1.0',
    attr: 'expert',
    desc: '7-block 深链 · 独立排序 · 最稳 (~30–38s)'
  },
  expert2: {
    label: '专家 2.0',
    attr: 'expert2',
    desc: '合并 DE · 少一次调用 · 更快 (~23s)'
  },
  customize: {
    label: '自定义',
    attr: 'customize',
    desc: '拖拽连线，搭建自己的追问流程'
  }
};

export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: OutputLanguage; label: string }> = [
  { value: '', label: '自动（跟随对话语言）' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' }
];

/** Pad to two digits without locale surprises. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format an elapsed millisecond count as mm:ss (or h:mm:ss past an hour) for the
 * topbar timer. Negative inputs clamp to 0.
 */
export function formatTimer(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** REC pill `data-state` + label, derived from the socket + any live capture. */
export interface RecMeta {
  state: 'idle' | 'connecting' | 'live';
  label: string;
}

export function recMeta(status: SocketStatus, capturing: boolean): RecMeta {
  if (capturing) {
    return { state: 'live', label: '实时' };
  }
  if (status === 'connecting' || status === 'reconnecting') {
    return { state: 'connecting', label: '连接中' };
  }
  return { state: 'idle', label: '空闲' };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Relative time for a history row, ported from the desktop history-sidebar.js:
 * "just now" under a minute, then Nm / Nh / Nd ago, falling back to a short
 * absolute date past a week. `now` is injectable for deterministic tests.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / MINUTE_MS);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(diff / HOUR_MS);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(diff / DAY_MS);
  if (diff < WEEK_MS) {
    return `${days} 天前`;
  }
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
