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
    label: 'Fast',
    attr: 'fast',
    desc: 'Low-latency 2-stage follow-ups · default'
  },
  expert: {
    label: 'Expert 1.0',
    attr: 'expert',
    desc: '7-block 深链 · 独立排序 · 最稳 (~30–38s)'
  },
  expert2: {
    label: 'Expert 2.0',
    attr: 'expert2',
    desc: '合并 DE · 少一次调用 · 更快 (~23s)'
  },
  customize: {
    label: 'Customize',
    attr: 'customize',
    desc: 'Build your own block pipeline · drag & connect'
  }
};

export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: OutputLanguage; label: string }> = [
  { value: '', label: '自动（跟随对话语言）' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' }
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
    return { state: 'live', label: 'Live' };
  }
  if (status === 'connecting' || status === 'reconnecting') {
    return { state: 'connecting', label: 'Connecting' };
  }
  return { state: 'idle', label: 'Idle' };
}
