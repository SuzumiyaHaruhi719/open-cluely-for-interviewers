import { useEffect, useRef, useState } from 'react';

/**
 * Premium in-app confirm / prompt dialogs, reproducing the desktop `.app-modal`
 * markup from history-sidebar.css. These replace the native
 * window.confirm()/prompt() (unstyleable OS dialogs that clash with the dark
 * shell). Promise-free, declarative: the parent renders one of these with an
 * `open` flag and `onConfirm` / `onCancel` callbacks.
 *
 * Dynamic strings render via JSX text nodes (never dangerouslySetInnerHTML), so
 * session titles can't inject markup — matching the desktop's textContent-only
 * posture.
 */

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A yes/no confirmation. Enter confirms, Escape / scrim cancels. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  useModalKeys(open, onConfirm, onCancel);
  const okRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open && okRef.current) {
      okRef.current.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const okClass = `app-modal__btn ${danger ? 'app-modal__btn--danger' : 'app-modal__btn--primary'}`;

  return (
    <div
      className="app-modal"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="app-modal__card">
        <h2 className="app-modal__title">{title}</h2>
        <p className="app-modal__text">{message}</p>
        <div className="app-modal__actions">
          <button
            type="button"
            className="app-modal__btn app-modal__btn--secondary"
            onClick={onCancel}
          >
            取消
          </button>
          <button type="button" className={okClass} onClick={onConfirm} ref={okRef}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PromptModalProps {
  open: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  /** Receives the (untrimmed) input value. */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** A single-text-field prompt. Enter saves the current value, Escape cancels. */
export function PromptModal({
  open,
  title,
  label,
  initialValue = '',
  confirmLabel = '保存',
  onConfirm,
  onCancel
}: PromptModalProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the field to the latest initial value each time the modal opens.
  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [open, initialValue]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open]);

  useModalKeys(
    open,
    () => onConfirm(inputRef.current ? inputRef.current.value : value),
    onCancel
  );

  if (!open) {
    return null;
  }

  return (
    <div
      className="app-modal"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="app-modal__card">
        <h2 className="app-modal__title">{title}</h2>
        <label className="app-modal__field">
          {label ? <span className="app-modal__label">{label}</span> : null}
          <input
            ref={inputRef}
            type="text"
            className="app-modal__input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="app-modal__actions">
          <button
            type="button"
            className="app-modal__btn app-modal__btn--secondary"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="app-modal__btn app-modal__btn--primary"
            onClick={() => onConfirm(value)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Wire Enter → confirm and Escape → cancel while the modal is open. */
function useModalKeys(open: boolean, onConfirm: () => void, onCancel: () => void): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onConfirm, onCancel]);
}
