import { PlainText } from './PlainText';

interface ResultsPanelProps {
  open: boolean;
  title: string;
  /** The assistant reply text; rendered safely as paragraphs. */
  text: string;
  /** Shown in place of the reply while the request is in flight. */
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

/**
 * The legacy results panel, 1:1 with the desktop `#results-panel`
 * (.results-panel > .results-header + .results-content > .result-text). A
 * floating glass card that surfaces an Ask AI / Meeting notes / Insights reply
 * and can be closed. Styled entirely by the copied styles.css.
 */
export function ResultsPanel({ open, title, text, loading, error, onClose }: ResultsPanelProps) {
  const panelClass = `results-panel${open ? '' : ' hidden'}`;

  return (
    <div id="results-panel" className={panelClass} role="dialog" aria-label={title}>
      <div className="results-header">
        <div className="results-title">
          <span>{title}</span>
        </div>
        <div className="results-actions">
          <button
            id="close-results"
            className="close-btn"
            type="button"
            aria-label="Close response"
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 1 0-1.42 1.42L10.59 12l-4.9 4.89a1 1 0 0 0 1.42 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.42L13.41 12l4.9-4.89a1 1 0 0 0 0-1.4Z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="results-content">
        <div id="result-text" className="result-text">
          {loading ? (
            'Thinking…'
          ) : error ? (
            error
          ) : (
            <PlainText text={text} />
          )}
        </div>
      </div>
    </div>
  );
}
