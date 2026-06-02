import { useEffect, useRef, useState } from 'react';
import type { InterviewerMode } from '@open-cluely/contract';
import { MODE_META, recMeta } from './helpers';
import type { SocketStatus } from '../lib/useCopilotSocket';
import { CameraIcon, KebabIcon } from './icons';

/** ASR engine pill label + `data-asr` attribute (CSS colours each provider). */
const ASR_META: Record<string, { label: string; attr: string }> = {
  paraformer: { label: 'Paraformer', attr: 'paraformer' },
  volc: { label: 'Doubao', attr: 'volc' },
  xfyun: { label: 'Xunfei', attr: 'xfyun' }
};

interface TopbarProps {
  title: string;
  mode: InterviewerMode;
  /** Active speech-to-text provider (drives the #asr-indicator pill). */
  asrProvider: string;
  status: SocketStatus;
  capturing: boolean;
  timer: string;
  isLive: boolean;
  screenshotCount: number;
  canAnalyze: boolean;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onClearSession: () => void;
  /** Ask the assistant a free-form question (legacy results panel). */
  onAskAi: () => void;
  /** Generate meeting notes from the current transcript. */
  onMeetingNotes: () => void;
  /** Generate insights from the current transcript. */
  onInsights: () => void;
  /** Disable the assistant actions while a request is in flight / unavailable. */
  assistantBusy: boolean;
  /** Autonomous question generation on/off (the Auto pill state). */
  autoGenerate: boolean;
  /** Toggle autonomous question generation. */
  onToggleAuto: () => void;
}

/**
 * Live-interview topbar, 1:1 with the desktop `.topbar`. The mode/REC/ASR pills
 * reflect real state (mode from config; REC derived from capture + socket; ASR
 * shows the active provider — Paraformer or Doubao — from settings). "Generate Q"
 * runs a copilot analysis
 * (follow-up question); "Ask AI" + the meeting-notes / insights menu items call
 * the assistant HTTP endpoints and surface replies in the results panel. The
 * screenshot + Screen AI actions stay faithful-but-inert stubs (image capture
 * is out of scope; title="Coming soon").
 */
export function Topbar({
  title,
  mode,
  asrProvider,
  status,
  capturing,
  timer,
  isLive,
  screenshotCount,
  canAnalyze,
  isAnalyzing,
  onAnalyze,
  onClearSession,
  onAskAi,
  onMeetingNotes,
  onInsights,
  assistantBusy,
  autoGenerate,
  onToggleAuto
}: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modeMeta = MODE_META[mode];
  const rec = recMeta(status, capturing);
  const asrMeta = ASR_META[asrProvider] ?? ASR_META.paraformer;

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

  const askLabel = assistantBusy ? 'Asking…' : 'Ask AI';

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
          title="Interviewer mode"
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
          data-asr={asrMeta.attr}
          title="Speech-to-text engine"
        >
          <span className="mode-indicator__dot" aria-hidden="true" />
          <span id="asr-indicator-label" className="mode-indicator__label">
            {asrMeta.label}
          </span>
        </span>
        <button
          id="auto-indicator"
          className="mode-indicator auto-indicator"
          type="button"
          data-auto={autoGenerate ? 'on' : 'off'}
          aria-pressed={autoGenerate}
          onClick={onToggleAuto}
          title={
            autoGenerate
              ? 'Auto question generation ON — the copilot fires from the live conversation. Click to turn off.'
              : 'Auto question generation OFF — only manual Generate Q. Click to turn on.'
          }
        >
          <span className="mode-indicator__dot" aria-hidden="true" />
          <span className="mode-indicator__label">Auto</span>
        </button>
        <span className="screenshot-count" id="screenshot-count" title="Screenshots captured">
          {screenshotCount}
        </span>
      </div>

      <div className="topbar__actions action-buttons">
        <button
          id="screenshot-btn"
          className="action-btn icon-btn"
          type="button"
          aria-label="Take screenshot"
          title="Coming soon"
          disabled
        >
          <CameraIcon size={14} />
        </button>
        <button
          id="analyze-btn"
          className="action-btn primary-btn"
          type="button"
          onClick={onAskAi}
          disabled={assistantBusy}
          title="Ask the assistant a free-form question"
        >
          {askLabel}
        </button>
        <button
          id="screen-ai-btn"
          className="action-btn"
          type="button"
          title="Coming soon"
          disabled
        >
          Screen AI
        </button>
        <button
          id="generate-question-btn"
          className="action-btn"
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze}
          title="Generate a follow-up question"
        >
          {isAnalyzing ? 'Analyzing…' : 'Generate Q'}
        </button>

        <div className="more-menu" id="more-menu" ref={menuRef}>
          <button
            id="more-menu-btn"
            className="action-btn icon-btn"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More actions"
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
              id="notes-btn"
              className="more-menu-item"
              type="button"
              role="menuitem"
              disabled={assistantBusy}
              onClick={() => {
                setMenuOpen(false);
                onMeetingNotes();
              }}
            >
              Meeting notes
            </button>
            <button
              id="insights-btn"
              className="more-menu-item"
              type="button"
              role="menuitem"
              disabled={assistantBusy}
              onClick={() => {
                setMenuOpen(false);
                onInsights();
              }}
            >
              Insights
            </button>
            <div className="more-menu-separator" role="separator" />
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
              Clear session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
