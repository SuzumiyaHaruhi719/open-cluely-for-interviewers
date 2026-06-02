import type { AppView } from './types';
import { PlusIcon, GearIcon, HistoryEmptyIcon } from './icons';

interface SidebarProps {
  view: AppView;
  onSelectView: (view: AppView) => void;
  onNewInterview: () => void;
  onOpenSettings: () => void;
}

/**
 * History sidebar, structurally matching the desktop `.sidebar`:
 *   .history-new-btn  →  "New interview"
 *   #session-list .history-list  →  history rows (empty-state stub for now)
 *   .sidebar__footer  →  Settings button
 *
 * The web-only view switch (Live ↔ Question Bank) rides in a compact nav group
 * at the top of the list, restyled with the desktop tokens via .history-row.
 */
export function Sidebar({ view, onSelectView, onNewInterview, onOpenSettings }: SidebarProps) {
  return (
    <aside id="sidebar" className="sidebar">
      <button
        id="btn-new-interview"
        className="history-new-btn"
        type="button"
        onClick={onNewInterview}
      >
        <span className="history-new-btn__icon" aria-hidden="true">
          <PlusIcon size={16} />
        </span>
        <span className="history-new-btn__label">New interview</span>
      </button>

      <div id="session-list" className="history-list" role="list" aria-label="Interview history">
        <div className="history-group">
          <div className="history-group__label">Views</div>
          <button
            type="button"
            className={`history-row${view === 'copilot' ? ' is-active' : ''}`}
            role="listitem"
            aria-current={view === 'copilot' ? 'page' : undefined}
            onClick={() => onSelectView('copilot')}
          >
            <span className="history-row__main">
              <span className="history-row__title">Live copilot</span>
              <span className="history-row__time">Realtime interview</span>
            </span>
          </button>
          <button
            type="button"
            className={`history-row${view === 'bank' ? ' is-active' : ''}`}
            role="listitem"
            aria-current={view === 'bank' ? 'page' : undefined}
            onClick={() => onSelectView('bank')}
          >
            <span className="history-row__main">
              <span className="history-row__title">Question bank</span>
              <span className="history-row__time">Browse · semantic search</span>
            </span>
          </button>
        </div>

        <div className="history-group">
          <div className="history-group__label">Recent</div>
          <div className="history-empty">
            <span className="history-empty__icon" aria-hidden="true">
              <HistoryEmptyIcon size={32} />
            </span>
            <p className="history-empty__text">No interviews yet</p>
            <p className="history-empty__hint">
              Start a new interview and your sessions will show up here.
            </p>
          </div>
        </div>
      </div>

      <div className="sidebar__footer">
        <button
          id="btn-settings"
          className="sidebar__settings-btn"
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <GearIcon size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
