import { Fragment, useEffect, useRef, useState } from 'react';
import type { SummaryState } from '../lib/useCopilotSocket';

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
 * (## headings, **bold**, - bullets, > blockquote) via safe React text nodes
 * (NEVER dangerouslySetInnerHTML), so model output can't inject markup. No heavy
 * markdown dependency is pulled in.
 */
export function SummaryModal({ open, summary, onRegenerate, onClose }: SummaryModalProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

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

  const isLoading = summary.status === 'streaming';
  const hasText = summary.text.trim().length > 0;

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
      aria-label="面试总结 / Interview summary"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="summary-modal__card">
        <header className="summary-modal__header">
          <h2 className="summary-modal__title">面试总结 · Interview summary</h2>
          <button
            type="button"
            className="summary-modal__close"
            aria-label="关闭 / Close"
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 1 0-1.42 1.42L10.59 12l-4.9 4.89a1 1 0 0 0 1.42 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.42L13.41 12l4.9-4.89a1 1 0 0 0 0-1.4Z" />
            </svg>
          </button>
        </header>

        <div className="summary-modal__body">
          {isLoading && !hasText ? (
            <div className="summary-modal__loading">
              <span className="summary-modal__spinner" aria-hidden="true" />
              <p className="summary-modal__loading-text">
                正在生成评估报告… · Generating evaluation report…
              </p>
            </div>
          ) : summary.status === 'error' ? (
            <p className="summary-modal__error">
              生成失败 · Failed to generate summary
              {summary.error ? `: ${summary.error}` : '.'}
            </p>
          ) : hasText ? (
            <SummaryReport text={summary.text} />
          ) : (
            <p className="summary-modal__empty">
              还没有总结内容。点击"重新生成"开始。 · No summary yet — click Regenerate to start.
            </p>
          )}
          {isLoading && hasText ? (
            <p className="summary-modal__loading-text summary-modal__loading-text--inline">
              正在生成… · Generating…
            </p>
          ) : null}
        </div>

        <footer className="summary-modal__actions">
          <button
            type="button"
            className="summary-modal__btn summary-modal__btn--secondary"
            onClick={onCopy}
            disabled={!hasText}
            title="复制报告到剪贴板 / Copy report to clipboard"
          >
            {copied ? '已复制 · Copied' : '复制 · Copy'}
          </button>
          <button
            type="button"
            className="summary-modal__btn summary-modal__btn--secondary"
            onClick={onRegenerate}
            disabled={isLoading}
            title="重新生成总结 / Regenerate the summary"
          >
            {isLoading ? '生成中… · Generating…' : '重新生成 · Regenerate'}
          </button>
          <button
            type="button"
            className="summary-modal__btn summary-modal__btn--primary"
            onClick={onClose}
          >
            关闭 · Close
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * A minimal, safe Markdown-ish renderer for the report: `## ` / `### ` headings,
 * `- ` / `* ` bullets, `> ` blockquotes, and inline `**bold**`. Everything else
 * is a paragraph. All content renders as React text nodes (no HTML injection).
 */
function SummaryReport({ text }: { text: string }) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');

  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

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

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const key = `b-${index}`;

    const h3 = /^###\s+(.*)$/.exec(line);
    const h2 = /^##\s+(.*)$/.exec(line);
    const h1 = /^#\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flushBullets(`${key}-ul`);

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
  flushBullets('b-tail-ul');

  return <div className="summary-md">{blocks}</div>;
}

/** Render inline `**bold**` segments as <strong>; everything else stays plain text. */
function renderInline(text: string): React.ReactNode {
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      return <strong key={i}>{bold[1]}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
