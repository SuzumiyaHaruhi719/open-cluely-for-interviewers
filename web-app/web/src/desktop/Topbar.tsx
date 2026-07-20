import { useEffect, useRef, useState } from 'react';
import type { InterviewerMode } from '@open-cluely/contract';
import { MODE_META, recMeta } from './helpers';
import type { SocketStatus } from '../lib/useCopilotSocket';
import { useTheme } from '../lib/useTheme';
import { CameraIcon, KebabIcon } from './icons';

/** Sun mark — shown in DARK mode (click switches to light). */
function SunIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

/** Moon mark — shown in LIGHT mode (click switches to dark). */
function MoonIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

interface TopbarProps {
  title: string;
  mode: InterviewerMode;
  status: SocketStatus;
  capturing: boolean;
  timer: string;
  isLive: boolean;
  screenshotCount: number;
  canAnalyze: boolean;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onClearSession: () => void;
  /** Open the interview-summary modal + kick off a DeepSeek v4 pro evaluation. */
  onSummarize: () => void;
}

/**
 * Live-interview topbar, 1:1 with the desktop `.topbar`. The mode/REC/ASR pills
 * reflect real state (mode from config; REC derived from capture + socket; ASR
 * is the fixed Doubao Seed 2.0 product policy). "Generate Q" runs a manual
 * copilot analysis. The screenshot action stays a faithful-but-inert stub (image
 * capture is out of scope; title="Coming soon").
 */
export function Topbar({
  title,
  mode,
  status,
  capturing,
  timer,
  isLive,
  screenshotCount,
  canAnalyze,
  isAnalyzing,
  onAnalyze,
  onClearSession,
  onSummarize
}: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();
  const modeMeta = MODE_META[mode];
  const rec = recMeta(status, capturing);

  // Close the more-menu on outside click / Escape, like the desktop.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div id="topbar" className={`topbar${isLive ? ' is-live' : ''}`}>
      <div className="topbar__lead">
        <span id="session-title" className="topbar__title">
          {title}
        </span>
        <span className="status-dot" aria-hidden="true" />
        <span className="timer">{timer}</span>
      </div>

      <div className="topbar__meta">
        <span
          id="mode-indicator"
          className="mode-indicator"
          data-mode={modeMeta.attr}
          title="面试模式"
        >
          <span className="mode-indicator__dot" aria-hidden="true" />
          <span id="mode-indicator-label" className="mode-indicator__label">
            {modeMeta.label}
          </span>
        </span>
        <span
          id="rec-indicator"
          className="rec-indicator"
          data-state={rec.state}
          role="status"
          aria-live="polite"
        >
          <span className="rec-indicator__dot" aria-hidden="true" />
          <span id="rec-indicator-label" className="rec-indicator__label">
            {rec.label}
          </span>
        </span>
        <span
          id="asr-indicator"
          className="mode-indicator"
          data-asr="volc"
          title="语音转文字引擎"
        >
          <span className="mode-indicator__dot" aria-hidden="true" />
          <span id="asr-indicator-label" className="mode-indicator__label">
            豆包 2.0
          </span>
        </span>
        <span className="screenshot-count" id="screenshot-count" title="已截屏数量">
          {screenshotCount}
        </span>
      </div>

      <div className="topbar__actions action-buttons">
        <button
          className="glp-theme-toggle action-btn icon-btn"
          type="button"
          aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>
        <button
          id="screenshot-btn"
          className="action-btn icon-btn"
          type="button"
          aria-label="截屏"
          title="即将推出"
          disabled
        >
          <CameraIcon size={14} />
        </button>
        <button
          id="summarize-btn"
          className="action-btn"
          type="button"
          onClick={onSummarize}
          title="生成面试评估总结"
        >
          总结面试
        </button>
        <button
          id="generate-question-btn"
          className="action-btn"
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze}
          title="生成追问"
        >
          {isAnalyzing ? '分析中…' : '生成追问'}
        </button>

        <div className="more-menu" id="more-menu" ref={menuRef}>
          <button
            id="more-menu-btn"
            className="action-btn icon-btn"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="更多操作"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <KebabIcon size={16} />
          </button>
          <div
            id="more-menu-panel"
            className={`more-menu-panel${menuOpen ? '' : ' hidden'}`}
            role="menu"
          >
            <button
              id="clear-btn"
              className="more-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onClearSession();
              }}
            >
              清空会话
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
