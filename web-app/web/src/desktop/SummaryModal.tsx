import { Fragment, useEffect, useRef, useState } from 'react';
import type { SummaryState } from '../lib/useCopilotSocket';

/** Format elapsed seconds as mm:ss. */
function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface SummaryModalProps {
  open: boolean;
  /** The interview-summary state from the socket (status + report text + error). */
  summary: SummaryState;
  /** Re-run the summary (mints a fresh request). */
  onRegenerate: () => void;
  onClose: () => void;
}

/**
 * The interview-summary modal (DeepSeek v4 pro). Mirrors the `.app-modal` scrim +
 * card structure with GLP tokens, adding a scrollable report body. While the
 * report is being produced it shows a spinner (the server is one-shot, so the
 * whole report lands at once on `summary-done`). Buttons: 复制 (clipboard) /
 * 重新生成 (re-run) / 关闭 (close). Bilingual labels.
 *
 * The report is lightweight Markdown — rendered with a tiny inline renderer
 * (## headings, **bold**, inline `code`, - bullets, 1. numbered lists, > quote)
 * via safe React text nodes (NEVER dangerouslySetInnerHTML), so model output
 * can't inject markup. No heavy markdown dependency is pulled in. The empty-
 * transcript case (`summary.empty`) renders a distinct notice, not a fake report.
 */
export function SummaryModal({ open, summary, onRegenerate, onClose }: SummaryModalProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  // Tick every second while streaming/loading to update elapsed display.
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<number | null>(null);
  const isGenerating = summary.status === 'loading' || summary.status === 'streaming';

  useEffect(() => {
    if (isGenerating) {
      tickRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    } else {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [isGenerating]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Reset the transient "copied" flag whenever the modal closes.
  useEffect(() => {
    if (!open) {
      setCopied(false);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  const isLoading = summary.status === 'loading';
  const isStreaming = summary.status === 'streaming';
  const hasText = summary.text.trim().length > 0;
  // The empty-transcript notice (server set `empty`) is a NOTICE, not a report —
  // render it distinctly so it never looks like a real evaluation. #8
  const isEmptyNotice = summary.status === 'done' && summary.empty;

  const elapsedMs = summary.startedAt !== null ? now - summary.startedAt : 0;
  const elapsedStr = fmtElapsed(elapsedMs);

  const onCopy = (): void => {
    const text = summary.text;
    if (!text) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current !== null) {
          window.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          copyTimerRef.current = null;
        }, 1800);
      })
      .catch(() => {
        /* clipboard denied — silent (the report is still on screen to copy manually). */
      });
  };

  return (
    <div
      className="summary-modal"
      role="dialog"
      aria-modal="true"
      aria-label="面试总结"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="summary-modal__card">
        <header className="summary-modal__header">
          <h2 className="summary-modal__title">面试总结</h2>
          <button
            type="button"
            className="summary-modal__close"
            aria-label="关闭"
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 1 0-1.42 1.42L10.59 12l-4.9 4.89a1 1 0 0 0 1.42 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.42L13.41 12l4.9-4.89a1 1 0 0 0 0-1.4Z" />
            </svg>
          </button>
        </header>

        <div className="summary-modal__body">
          {/* Progress bar shown while loading (spinner phase) or streaming (live text). */}
          {isGenerating ? (
            <div className="summary-modal__progress-bar-wrap" aria-live="polite">
              <div className="summary-modal__progress-bar">
                <div
                  className="summary-modal__progress-bar-fill"
                  style={{ width: isStreaming ? '80%' : '20%' }}
                />
              </div>
              <div className="summary-modal__progress-meta">
                <span className="summary-modal__progress-elapsed">⏱ {elapsedStr}</span>
                {summary.tokens > 0 ? (
                  <span className="summary-modal__progress-tokens">
                    {summary.tokens.toLocaleString()} 令牌
                  </span>
                ) : null}
                <span className="summary-modal__progress-label">
                  {isStreaming ? '正在生成…' : '正在生成评估报告…'}
                </span>
              </div>
            </div>
          ) : null}
          {/* Spinner-only phase: no text yet. */}
          {isLoading && !hasText ? (
            <div className="summary-modal__loading">
              <span className="summary-modal__spinner" aria-hidden="true" />
            </div>
          ) : summary.status === 'error' ? (
            <>
              <p className="summary-modal__error">
                生成总结失败
                {summary.error ? `: ${summary.error}` : '.'}
              </p>
              {summary.debugEvents.length > 0 ? (
                <SummaryDebugTimeline events={summary.debugEvents} />
              ) : null}
            </>
          ) : isEmptyNotice ? (
            <p className="summary-modal__notice">
              {summary.text.trim().length > 0
                ? summary.text
                : '还没有可总结的面试内容。'}
            </p>
          ) : hasText ? (
            <SummaryReport text={summary.text} />
          ) : (
            <p className="summary-modal__empty">
              还没有总结内容。点击“重新生成”开始。
            </p>
          )}
        </div>

        <footer className="summary-modal__actions">
          <button
            type="button"
            className="summary-modal__btn summary-modal__btn--secondary"
            onClick={onCopy}
            disabled={!hasText}
            title="复制报告到剪贴板"
          >
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            className="summary-modal__btn summary-modal__btn--secondary"
            onClick={onRegenerate}
            disabled={isGenerating}
            title="重新生成总结"
          >
            {isGenerating ? '生成中…' : '重新生成'}
          </button>
          <button
            type="button"
            className="summary-modal__btn summary-modal__btn--primary"
            onClick={onClose}
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

function SummaryDebugTimeline({ events }: { events: SummaryState['debugEvents'] }) {
  const visible = events.slice(-24);
  const baseAt = visible[0]?.at ?? Date.now();
  return (
    <section className="summary-modal__debug" aria-label="总结调试时间线">
      <h3 className="summary-modal__debug-title">调试时间线</h3>
      <ol className="summary-modal__debug-list">
        {visible.map((event, index) => (
          <li className="summary-modal__debug-row" key={`${event.at}-${event.source}-${event.stage}-${index}`}>
            <span className="summary-modal__debug-time">{fmtElapsed(Math.max(0, event.at - baseAt))}</span>
            <span className="summary-modal__debug-source">{event.source}</span>
            <span className="summary-modal__debug-stage">{event.stage}</span>
            <span className="summary-modal__debug-detail">{formatDebugDetails(event)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatDebugDetails(event: SummaryState['debugEvents'][number]): string {
  const parts: string[] = [];
  if (event.model) parts.push(`model=${event.model}`);
  if (typeof event.status === 'number') parts.push(`status=${event.status}`);
  if (event.eventType) parts.push(`event=${event.eventType}`);
  if (typeof event.inputChars === 'number') parts.push(`inputChars=${event.inputChars}`);
  if (typeof event.chunkChars === 'number') parts.push(`chunkChars=${event.chunkChars}`);
  if (typeof event.accumulatedChars === 'number') parts.push(`accumulatedChars=${event.accumulatedChars}`);
  if (typeof event.inputTokens === 'number') parts.push(`inputTokens=${event.inputTokens}`);
  if (typeof event.outputTokens === 'number') parts.push(`outputTokens=${event.outputTokens}`);
  if (typeof event.elapsedMs === 'number') parts.push(`elapsedMs=${event.elapsedMs}`);
  if (event.reason) parts.push(`reason=${event.reason}`);
  if (event.error) parts.push(`error=${event.error}`);
  return parts.join(' ');
}

/**
 * A minimal, safe Markdown-ish renderer for the report: `## ` / `### ` headings,
 * `- ` / `* ` bullets, `1.` numbered lists, `> ` blockquotes, inline `**bold**`,
 * and inline `` `code` ``. Everything else is a paragraph. All content renders as
 * React text nodes (no HTML injection — never dangerouslySetInnerHTML).
 */
function SummaryReport({ text }: { text: string }) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');

  const blocks: React.ReactNode[] = [];
  // Two independent list accumulators so a `-` bullet run and a `1.` numbered run
  // never merge into one list. Each flushes when a non-matching line is seen.
  let bullets: string[] = [];
  let ordered: string[] = [];

  const flushBullets = (key: string): void => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul className="summary-md__list" key={key}>
        {items.map((item, i) => (
          <li className="summary-md__li" key={i}>
            {renderInline(item)}
          </li>
        ))}
      </ul>
    );
  };

  const flushOrdered = (key: string): void => {
    if (ordered.length === 0) return;
    const items = ordered;
    ordered = [];
    blocks.push(
      <ol className="summary-md__list summary-md__list--ordered" key={key}>
        {items.map((item, i) => (
          <li className="summary-md__li" key={i}>
            {renderInline(item)}
          </li>
        ))}
      </ol>
    );
  };

  const flushLists = (key: string): void => {
    flushBullets(`${key}-ul`);
    flushOrdered(`${key}-ol`);
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const key = `b-${index}`;

    const h3 = /^###\s+(.*)$/.exec(line);
    const h2 = /^##\s+(.*)$/.exec(line);
    const h1 = /^#\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    // A numbered list item: `1.` / `2)` etc. The marker is dropped (the <ol>
    // renders its own numbering).
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (bullet) {
      // A bullet run ends any pending ordered run.
      flushOrdered(`${key}-ol`);
      bullets.push(bullet[1]);
      return;
    }
    if (number) {
      // A numbered run ends any pending bullet run.
      flushBullets(`${key}-ul`);
      ordered.push(number[1]);
      return;
    }
    flushLists(key);

    if (h3) {
      blocks.push(
        <h4 className="summary-md__h summary-md__h3" key={key}>
          {renderInline(h3[1])}
        </h4>
      );
    } else if (h2) {
      blocks.push(
        <h3 className="summary-md__h summary-md__h2" key={key}>
          {renderInline(h2[1])}
        </h3>
      );
    } else if (h1) {
      blocks.push(
        <h3 className="summary-md__h summary-md__h2" key={key}>
          {renderInline(h1[1])}
        </h3>
      );
    } else if (quote) {
      blocks.push(
        <blockquote className="summary-md__quote" key={key}>
          {renderInline(quote[1])}
        </blockquote>
      );
    } else if (line.trim().length === 0) {
      // Blank line — paragraph break; skip (the gap comes from block margins).
    } else {
      blocks.push(
        <p className="summary-md__p" key={key}>
          {renderInline(line)}
        </p>
      );
    }
  });
  flushLists('b-tail');

  return <div className="summary-md">{blocks}</div>;
}

/**
 * Render inline `**bold**` (→ <strong>) and `` `code` `` (→ <code>) segments;
 * everything else stays plain text. Split on both delimiters in one pass so they
 * compose within a line. SAFE: only React text nodes / elements, no raw HTML.
 */
function renderInline(text: string): React.ReactNode {
  // The capture groups keep the delimiters so each piece can be classified.
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      return <strong key={i}>{bold[1]}</strong>;
    }
    const code = /^`([^`]+)`$/.exec(part);
    if (code) {
      return (
        <code className="summary-md__code" key={i}>
          {code[1]}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
