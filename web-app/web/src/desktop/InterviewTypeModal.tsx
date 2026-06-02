import { useEffect, useState } from 'react';
import type { InterviewSample } from './interviewSamples';
import { INTERVIEW_SAMPLES } from './interviewSamples';
import { CloseIcon } from './icons';

export type InterviewType = 'online' | 'offline';

export interface InterviewTypeChoice {
  interviewType: InterviewType;
  sample: InterviewSample | null;
}

interface InterviewTypeModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires when a format card is clicked; carries the chosen sample (if any). */
  onPick: (choice: InterviewTypeChoice) => void;
}

/**
 * New-interview type picker, 1:1 with the desktop `#interview-type-modal`
 * (interview-type.css). Two large cards — 线上 Online (candidate/teal) and 线下
 * Offline (interviewer/amber) — plus an optional sample-transcript select.
 * Clicking a card fires `onPick` immediately (no intermediate "selected"
 * state), exactly like the desktop.
 */
export function InterviewTypeModal({ open, onClose, onPick }: InterviewTypeModalProps) {
  const [sampleId, setSampleId] = useState('');

  // Reset the sample choice whenever the modal re-opens.
  useEffect(() => {
    if (open) {
      setSampleId('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const choose = (interviewType: InterviewType): void => {
    const sample = INTERVIEW_SAMPLES.find((s) => s.id === sampleId) ?? null;
    onPick({ interviewType, sample });
  };

  const modalClass = `interview-type-modal${open ? '' : ' hidden'}`;

  return (
    <div
      id="interview-type-modal"
      className={modalClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="interview-type-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="interview-type-card-wrap" role="document">
        <div className="interview-type-head">
          <h2 id="interview-type-title" className="interview-type-title">
            开始新面试 / New interview
          </h2>
          <p className="interview-type-subtitle">选择面试形式 · Choose the interview format</p>
          <button
            id="interview-type-close"
            className="interview-type-close"
            type="button"
            aria-label="Cancel"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="interview-type-options" role="group" aria-label="Interview format">
          <button
            className="interview-type-option"
            type="button"
            data-interview-type="online"
            data-accent="candidate"
            onClick={() => choose('online')}
          >
            <span className="interview-type-option__icon" aria-hidden="true">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </span>
            <span className="interview-type-option__body">
              <span className="interview-type-option__title">线上面试 / Online</span>
              <span className="interview-type-option__desc">
                远程面试 · 电脑音频(候选人) + 麦克风(你)
              </span>
            </span>
          </button>

          <button
            className="interview-type-option"
            type="button"
            data-interview-type="offline"
            data-accent="interviewer"
            onClick={() => choose('offline')}
          >
            <span className="interview-type-option__icon" aria-hidden="true">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </span>
            <span className="interview-type-option__body">
              <span className="interview-type-option__title">线下面试 / Offline</span>
              <span className="interview-type-option__desc">现场面试 · 仅房间麦克风 + 简历</span>
            </span>
          </button>
        </div>

        <div className="interview-type-sample">
          <label className="interview-type-sample__label" htmlFor="interview-sample-select">
            样本 / Sample transcript (可选)
          </label>
          <select
            id="interview-sample-select"
            className="settings-input"
            value={sampleId}
            onChange={(e) => setSampleId(e.target.value)}
          >
            <option value="">空白 / Blank (no transcript)</option>
            {INTERVIEW_SAMPLES.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.name}
              </option>
            ))}
          </select>
          <p className="interview-type-sample__desc">
            选一个样本会预填简历/JD + 一段对话，方便直接试 Generate Q。
          </p>
        </div>
      </div>
    </div>
  );
}
