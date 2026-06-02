import { MicIcon, MobileIcon, PanelIcon, MinimizeIcon, CloseIcon } from './icons';

interface TitleBarProps {
  railCollapsed: boolean;
  onToggleRail: () => void;
}

/**
 * Frameless title bar, 1:1 with the desktop `.titlebar`. The brand mark + the
 * rail toggle are functional; the mobile pill and min/close buttons are
 * faithful-but-inert in a browser tab (a tab can't minimise/close itself), so
 * they carry a "Coming soon" / not-available title.
 */
export function TitleBar({ railCollapsed, onToggleRail }: TitleBarProps) {
  return (
    <header id="titlebar" className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__logo" aria-hidden="true">
          <MicIcon size={14} />
        </span>
        <span className="titlebar__title">Interviewer Copilot</span>
      </div>

      <div className="titlebar__status">
        <button
          id="mobile-server-pill"
          className="mobile-server-pill off"
          type="button"
          title="Mobile companion — desktop only"
          disabled
        >
          <MobileIcon size={11} />
          <span id="mobile-server-pill-label">Mobile</span>
        </button>
      </div>

      <div className="titlebar__controls">
        <button
          id="toggle-rail-btn"
          className="titlebar__btn"
          type="button"
          aria-label="Toggle right panel"
          aria-pressed={railCollapsed}
          title="Collapse / expand the right panel"
          onClick={onToggleRail}
        >
          <PanelIcon size={14} />
        </button>
        <button
          id="btn-min"
          className="titlebar__btn"
          type="button"
          aria-label="Minimize"
          title="Minimize — desktop only"
          disabled
        >
          <MinimizeIcon size={12} />
        </button>
        <button
          id="btn-close"
          className="titlebar__btn titlebar__btn--danger"
          type="button"
          aria-label="Close"
          title="Close — desktop only"
          disabled
        >
          <CloseIcon size={13} />
        </button>
      </div>
    </header>
  );
}
