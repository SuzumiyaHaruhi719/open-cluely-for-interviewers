import { useEffect } from 'react';
import type { SessionContextState } from '@open-cluely/contract';
import { Brain } from '@phosphor-icons/react/Brain';
import { X } from '@phosphor-icons/react/X';
import { SessionContextPanel, type SessionContextNote } from './SessionContextPanel';

interface SessionContextDrawerProps {
  open: boolean;
  state: SessionContextState | null;
  notes?: readonly SessionContextNote[];
  startedAtMs?: number | null;
  onClose: () => void;
}

/** Single-purpose drawer for the server's continuously consolidated context. */
export function SessionContextDrawer({
  open,
  state,
  notes = [],
  startedAtMs = null,
  onClose
}: SessionContextDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <aside
      id="session-context-drawer"
      className="context-drawer"
      data-open={open ? 'true' : 'false'}
      aria-hidden={!open}
      aria-label="会话上下文"
    >
      <header className="context-drawer__header">
        <span className="context-drawer__heading-icon" aria-hidden="true">
          <Brain size={20} />
        </span>
        <div>
          <h2>会话上下文</h2>
          <p>自动整理当前证据</p>
        </div>
        <button
          className="context-drawer__close"
          type="button"
          aria-label="关闭会话上下文"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div
        className="context-drawer__body"
        role="region"
        aria-label="自动会话上下文内容"
        tabIndex={open ? 0 : -1}
      >
        <SessionContextPanel state={state} notes={notes} startedAtMs={startedAtMs} />
      </div>
    </aside>
  );
}
