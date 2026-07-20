import { useEffect, useState } from 'react';
import { CloseIcon } from './icons';
import { useMicDevices } from './useMicDevices';
import type {
  AppSettings,
  SummaryModel
} from './useAppSettings';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onMicDeviceChange: (deviceId: string) => void;
  micDeviceDisabled: boolean;
  onSummaryModelChange: (value: SummaryModel) => void;
}

const CLOSE_ANIM_MS = 200;

const SUMMARY_MODEL_OPTIONS: ReadonlyArray<{ value: SummaryModel; label: string }> = [
  { value: 'deepseek-v4-pro', label: 'DeepSeek v4 Pro · 深度评估' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek v4 Flash · 快速评估' }
];

/** Compact, auto-saving settings containing only observable interviewer choices. */
export function SettingsModal({
  open,
  settings,
  onClose,
  onMicDeviceChange,
  micDeviceDisabled,
  onSummaryModelChange
}: SettingsModalProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const { devices } = useMicDevices(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const handle = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_ANIM_MS);
    return () => window.clearTimeout(handle);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      id="settings-panel"
      className={`settings-panel${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-dialog settings-dialog--compact">
        <div className="settings-header">
          <div className="settings-header__copy">
            <h2 id="settings-title" className="settings-title">
              设置
            </h2>
            <p className="settings-subtitle">只保留会真实影响面试的选项</p>
          </div>
          <span className="settings-policy-badge">专家 · 中文</span>
          <button
            id="close-settings"
            className="settings-close"
            type="button"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="settings-body settings-body--compact">
          <section className="settings-section settings-section--card" aria-labelledby="audio-settings-title">
            <div className="settings-section__head">
              <div>
                <h3 id="audio-settings-title" className="settings-section__title">
                  音频
                </h3>
                <p className="settings-section__hint">选择本次面试使用的麦克风</p>
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-mic-device">
                麦克风
              </label>
              <select
                id="setting-mic-device"
                className="settings-select"
                value={settings.micDeviceId}
                disabled={micDeviceDisabled}
                onChange={(event) => onMicDeviceChange(event.target.value)}
              >
                <option value="">系统默认麦克风</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              {micDeviceDisabled ? (
                <span className="settings-field__desc">停止录音后可切换设备</span>
              ) : null}
            </div>
          </section>

          <section className="settings-section settings-section--card" aria-labelledby="report-settings-title">
            <div className="settings-section__head">
              <div>
                <h3 id="report-settings-title" className="settings-section__title">
                  面试评估
                </h3>
                <p className="settings-section__hint">仅影响结束后的评估报告</p>
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-summary-model">
                评估报告模型
              </label>
              <select
                id="setting-summary-model"
                className="settings-select"
                value={settings.summaryModel}
                onChange={(event) => onSummaryModelChange(event.target.value as SummaryModel)}
              >
                {SUMMARY_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
