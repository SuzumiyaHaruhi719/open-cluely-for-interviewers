import { useEffect, useState } from 'react';
import type { CopilotProgress } from '../lib/useCopilotSocket';

interface ProgressCardProps {
  progress: CopilotProgress | null;
  /** Cumulative tokens (input + output) so far; only shown when > 0. */
  tokens?: number;
  fallbackLabel?: string;
}

/**
 * Friendly, non-technical labels for the pipeline's internal phase keys. An HR
 * interviewer sees these instead of raw block names like "answer"/"gaps". An
 * unknown phase falls back to its raw key so we never hide progress.
 */
const PHASE_LABELS: Record<string, string> = {
  answer: '分析候选人回答',
  gaps: '定位待追问的薄弱点',
  pool: '生成候选追问',
  rank: '打分与排序',
  safety: '合规检查',
  render: '整理追问',
  fast: '生成追问中'
};

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

/** Elapsed-time formatter mirroring QuestionCard: sub-second in ms, else "X.X s". */
function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

const TICK_MS = 100;

/**
 * Transient analyze-progress card rendered into the transcript stream while a
 * follow-up chain runs. Matches the desktop `.chat-progress-card`: an indigo
 * lane with a determinate bar (when phase total is known) or the indeterminate
 * shimmer (Fast mode / before the first phase event arrives).
 *
 * The meta row shows, for a non-technical interviewer: the friendly phase label
 * (with the phase count when known), a live elapsed timer ticking from mount,
 * and the cumulative token count once any phase reports tokens. The raw model
 * name is intentionally not surfaced here.
 */
export function ProgressCard({
  progress,
  tokens = 0,
  fallbackLabel = 'Analyzing answer…'
}: ProgressCardProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  // Tick a live elapsed timer from mount; cleared on unmount (the card only
  // lives for the duration of a single in-flight request).
  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const hasTotal = progress !== null && progress.total > 0;
  const completed =
    progress === null ? 0 : progress.status === 'done' ? progress.index + 1 : progress.index;
  const pct = hasTotal ? Math.min(100, Math.round((completed / progress!.total) * 100)) : 0;
  const label = progress?.phase ? phaseLabel(progress.phase) : fallbackLabel;

  return (
    <div
      className={`chat-message chat-progress-card${hasTotal ? '' : ' is-indeterminate'}`}
      role="status"
      aria-live="polite"
    >
      <div className="chat-progress__head">
        <span className="chat-progress__label">
          {label}
          {hasTotal ? ` (${completed}/${progress!.total})` : ''}
        </span>
        <div className="chat-progress__meta">
          <span className="chat-progress__timer">{formatElapsed(elapsedMs)}</span>
          {tokens > 0 ? (
            <span className="chat-progress__tokens">{tokens.toLocaleString()} tokens</span>
          ) : null}
        </div>
      </div>
      <div className="chat-progress__bar">
        <div
          className="chat-progress__fill"
          style={hasTotal ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}
