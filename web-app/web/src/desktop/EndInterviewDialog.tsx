import { useEffect, useRef } from 'react';
import { WarningCircle } from '@phosphor-icons/react/WarningCircle';

interface EndInterviewDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Destructive confirmation that deliberately focuses the reversible action. */
export function EndInterviewDialog({ open, onCancel, onConfirm }: EndInterviewDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancelRef.current) {
        event.preventDefault();
        confirmRef.current?.focus();
      } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
        event.preventDefault();
        cancelRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="end-interview-dialog"
      data-testid="end-interview-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="end-interview-dialog__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-interview-dialog-title"
        aria-describedby="end-interview-dialog-description"
      >
        <span className="end-interview-dialog__icon" aria-hidden="true">
          <WarningCircle size={24} weight="fill" data-icon-library="phosphor" />
        </span>
        <div className="end-interview-dialog__copy">
          <h2 id="end-interview-dialog-title">结束本次面试？</h2>
          <p id="end-interview-dialog-description">
            确认后将停止音频采集并返回开始前准备页面。
          </p>
        </div>
        <div className="end-interview-dialog__actions">
          <button
            ref={cancelRef}
            className="end-interview-dialog__cancel"
            type="button"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            className="end-interview-dialog__confirm"
            type="button"
            onClick={onConfirm}
          >
            确认结束
          </button>
        </div>
      </section>
    </div>
  );
}
