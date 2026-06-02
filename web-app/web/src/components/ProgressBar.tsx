import type { CopilotProgress } from '../lib/useCopilotSocket';

interface ProgressBarProps {
  progress: CopilotProgress | null;
  /** Shown when analyzing but no progress event has arrived yet. */
  fallbackLabel?: string;
}

/**
 * Drives a determinate progress bar from `progress` events. When `total` is
 * known we show index/total; otherwise we fall back to an indeterminate sweep.
 */
export function ProgressBar({ progress, fallbackLabel = 'Working…' }: ProgressBarProps) {
  const hasTotal = progress !== null && progress.total > 0;
  const completed =
    progress === null ? 0 : progress.status === 'done' ? progress.index + 1 : progress.index;
  const pct = hasTotal ? Math.min(100, Math.round((completed / progress!.total) * 100)) : 0;
  const phase = progress?.phase ?? fallbackLabel;

  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress-head">
        <span className="progress-phase">
          <span className="spinner" aria-hidden="true" />
          {phase}
        </span>
        {hasTotal ? (
          <span>
            {completed}/{progress!.total}
          </span>
        ) : null}
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill${hasTotal ? '' : ' is-indeterminate'}`}
          style={hasTotal ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}
