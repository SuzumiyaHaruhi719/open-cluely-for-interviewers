import type { AppView } from './types';
import { PlusIcon, GearIcon } from './icons';

interface SidebarProps {
  view: AppView;
  onSelectView: (view: AppView) => void;
  /** Opens the interview-type picker (handled by the shell). */
  onNewInterview: () => void;
  onOpenSettings: () => void;
}

/**
 * App sidebar, structurally matching the desktop `.sidebar`:
 *   .history-new-btn  →  "New interview" (resets state + re-opens the picker)
 *   #session-list .history-list  →  Views nav group (Live copilot · Question bank)
 *   .sidebar__footer  →  Settings button
 *
 * Interviews are ephemeral — there is no persisted history list. Every app open
 * is a fresh in-memory interview, so the sidebar carries only navigation.
 */
export function Sidebar({
  view,
  onSelectView,
  onNewInterview,
  onOpenSettings
}: SidebarProps) {
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
        <span className="history-new-btn__label">新建面试</span>
      </button>

      <div id="session-list" className="history-list" role="list" aria-label="导航">
        <div className="history-group">
          <div className="history-group__label">视图</div>
          <button
            type="button"
            className={`history-row${view === 'copilot' ? ' is-active' : ''}`}
            role="listitem"
            aria-current={view === 'copilot' ? 'page' : undefined}
            onClick={() => onSelectView('copilot')}
          >
            <span className="history-row__main">
              <span className="history-row__title">实时助手</span>
              <span className="history-row__time">实时面试</span>
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
              <span className="history-row__title">题库</span>
              <span className="history-row__time">浏览 · 语义搜索</span>
            </span>
          </button>
        </div>
      </div>

      <div className="sidebar__footer">
        <button
          id="btn-settings"
          className="sidebar__settings-btn"
          type="button"
          aria-label="设置"
          onClick={onOpenSettings}
        >
          <GearIcon size={15} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
