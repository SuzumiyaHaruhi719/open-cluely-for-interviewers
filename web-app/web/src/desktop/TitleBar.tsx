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
  const railLabel = railCollapsed ? '展开右侧栏' : '收起右侧栏';

  return (
    <header id="titlebar" className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__logo" aria-hidden="true">
          <MicIcon size={14} />
        </span>
        <span className="titlebar__title">面试官助手</span>
      </div>

      <div className="titlebar__status">
        <button
          id="mobile-server-pill"
          className="mobile-server-pill off"
          type="button"
          title="移动端伴侣仅桌面版可用"
          disabled
        >
          <MobileIcon size={11} />
          <span id="mobile-server-pill-label">移动端</span>
        </button>
      </div>

      <div className="titlebar__controls">
        <button
          id="toggle-rail-btn"
          className="titlebar__btn"
          type="button"
          aria-label={railLabel}
          aria-controls="right-rail"
          aria-expanded={!railCollapsed}
          title={railLabel}
          onClick={onToggleRail}
        >
          <PanelIcon size={14} />
        </button>
      </div>
    </header>
  );
}
