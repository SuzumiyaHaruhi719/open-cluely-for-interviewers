import { MicIcon, MobileIcon, PanelIcon } from './icons';

interface TitleBarProps {
  railCollapsed: boolean;
  onToggleRail: () => void;
}

/**
 * Title bar for the web edition. The brand mark + the rail toggle are functional.
 * The desktop-only window controls (minimise / close) are omitted — a browser tab
 * can't minimise or close itself. The mobile pill stays an inert "desktop only".
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
      </div>
    </header>
  );
}
