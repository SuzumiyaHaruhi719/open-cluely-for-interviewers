import type { CopilotProgress } from '../lib/useCopilotSocket';

interface ProgressCardProps {
  progress: CopilotProgress | null;
  fallbackLabel?: string;
}

/**
 * Transient analyze-progress card rendered into the transcript stream while a
 * follow-up chain runs. Matches the desktop `.chat-progress-card`: an indigo
 * lane with a determinate bar (when phase total is known) or the indeterminate
 * shimmer (Fast mode / before the first phase event arrives).
 */
export function ProgressCard({ progress, fallbackLabel = 'Analyzing answer…' }: ProgressCardProps) {
  const hasTotal = progress !== null && progress.total > 0;
  const completed =
    progress === null ? 0 : progress.status === 'done' ? progress.index + 1 : progress.index;
  const pct = hasTotal ? Math.min(100, Math.round((completed / progress!.total) * 100)) : 0;
  const phase = progress?.phase ?? fallbackLabel;

  return (
    <div
      className={`chat-message chat-progress-card${hasTotal ? '' : ' is-indeterminate'}`}
      role="status"
      aria-live="polite"
    >
      <div className="chat-progress__head">
        <span className="chat-progress__label">{phase}</span>
        <div className="chat-progress__meta">
          {hasTotal ? (
            <span className="chat-progress__timer">
              {completed}/{progress!.total}
            </span>
          ) : null}
          {progress?.model ? <span className="chat-progress__tokens">{progress.model}</span> : null}
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
