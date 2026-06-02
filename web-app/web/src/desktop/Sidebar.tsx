import { useState } from 'react';
import type { AppView } from './types';
import type { SessionSummary } from '../lib/api';
import { PlusIcon, GearIcon, HistoryEmptyIcon, PencilIcon, TrashIcon } from './icons';
import { formatRelativeTime } from './helpers';
import { ConfirmModal, PromptModal } from './AppModal';

interface SidebarProps {
  view: AppView;
  onSelectView: (view: AppView) => void;
  /** Opens the interview-type picker (handled by the shell). */
  onNewInterview: () => void;
  onOpenSettings: () => void;
  sessions: SessionSummary[];
  activeId: string | null;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
}

/**
 * History sidebar, structurally matching the desktop `.sidebar`:
 *   .history-new-btn  →  "New interview" (opens the interview-type picker)
 *   #session-list .history-list  →  Views nav group + the "Recent" history list
 *   .sidebar__footer  →  Settings button
 *
 * The "Recent" group reproduces the desktop `.history-row` markup (title,
 * relative time, message count, active state) with inline rename + delete
 * actions that open the styled `.app-modal` prompt / confirm dialogs (never
 * window.prompt / window.confirm).
 */
export function Sidebar({
  view,
  onSelectView,
  onNewInterview,
  onOpenSettings,
  sessions,
  activeId,
  onSelectSession,
  onRenameSession,
  onDeleteSession
}: SidebarProps) {
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);

  const confirmRename = (value: string): void => {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) {
      return;
    }
    const trimmed = value.trim();
    if (trimmed && trimmed !== target.title) {
      onRenameSession(target.id, trimmed);
    }
  };

  const confirmDelete = (): void => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target) {
      onDeleteSession(target.id);
    }
  };

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
          {sessions.length === 0 ? (
            <div className="history-empty">
              <span className="history-empty__icon" aria-hidden="true">
                <HistoryEmptyIcon size={32} />
              </span>
              <p className="history-empty__text">No interviews yet</p>
              <p className="history-empty__hint">
                Start a new interview and your sessions will show up here.
              </p>
            </div>
          ) : (
            sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                onSelect={() => onSelectSession(session.id)}
                onRename={() => setRenameTarget(session)}
                onDelete={() => setDeleteTarget(session)}
              />
            ))
          )}
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

      <PromptModal
        open={renameTarget !== null}
        title="Rename interview"
        label="Interview name"
        initialValue={renameTarget?.title ?? ''}
        confirmLabel="Save"
        onConfirm={confirmRename}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete interview"
        message={`Delete "${deleteTarget?.title || 'this interview'}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}

interface SessionRowProps {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** One `.history-row` with inline rename/delete actions revealed on hover. */
function SessionRow({ session, active, onSelect, onRename, onDelete }: SessionRowProps) {
  const title = session.title || 'Untitled interview';
  const stamp = formatRelativeTime(session.updatedAt || session.createdAt);
  const count = session.messageCount;

  return (
    <div
      className={`history-row${active ? ' is-active' : ''}`}
      data-session-id={session.id}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="history-row__main">
        <span className="history-row__title" title={title}>
          {title}
        </span>
        <span className="history-row__time">
          {stamp}
          {count > 0 ? ` · ${count} ${count === 1 ? 'msg' : 'msgs'}` : ''}
        </span>
      </span>
      <div className="history-row__actions">
        <button
          type="button"
          className="history-row__action"
          title="Rename"
          aria-label="Rename interview"
          onClick={(event) => {
            event.stopPropagation();
            onRename();
          }}
        >
          <PencilIcon size={14} />
        </button>
        <button
          type="button"
          className="history-row__action history-row__action--danger"
          title="Delete"
          aria-label="Delete interview"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
}
