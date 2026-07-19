import { useEffect, useState } from 'react';
import { CloseIcon } from './icons';
import { useMicDevices } from './useMicDevices';
import type {
  AppSettings,
  AutoMode,
  SummaryModel,
  UserAsrProvider
} from './useAppSettings';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onAsrProviderChange: (value: UserAsrProvider) => void;
  onMicDeviceChange: (deviceId: string) => void;
  micDeviceDisabled: boolean;
  onAutoGenerateChange: (enabled: boolean) => void;
  onAutoModeChange: (mode: AutoMode) => void;
  onAutoIntervalChange: (seconds: number) => void;
  onSummaryModelChange: (value: SummaryModel) => void;
}

const CLOSE_ANIM_MS = 200;

const ASR_PROVIDER_OPTIONS: ReadonlyArray<{ value: UserAsrProvider; label: string }> = [
  { value: 'xfyun', label: '讯飞实时转写 · 原生说话人分离（默认）' },
  { value: 'volc', label: '豆包流式语音 2.0 · 服务端配置' }
];

const SUMMARY_MODEL_OPTIONS: ReadonlyArray<{ value: SummaryModel; label: string }> = [
  { value: 'deepseek-v4-pro', label: 'DeepSeek v4 Pro · 深度评估' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek v4 Flash · 快速评估' }
];

const AUTO_INTERVAL_OPTIONS = [15, 30, 45, 60, 90] as const;

/** Compact, auto-saving settings containing only observable interviewer choices. */
export function SettingsModal({
  open,
  settings,
  onClose,
  onAsrProviderChange,
  onMicDeviceChange,
  micDeviceDisabled,
  onAutoGenerateChange,
  onAutoModeChange,
  onAutoIntervalChange,
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
                  音频与识别
                </h3>
                <p className="settings-section__hint">识别引擎在下一次连接时生效</p>
              </div>
              <span className="settings-section__state">服务端凭证</span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-asr-provider">
                语音识别
              </label>
              <select
                id="setting-asr-provider"
                className="settings-select"
                value={settings.asrProvider}
                onChange={(event) => onAsrProviderChange(event.target.value as UserAsrProvider)}
              >
                {ASR_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                {import.meta.env.MODE === 'test' ? (
                  <option value="sim" hidden aria-hidden="true">
                    自动化测试模拟
                  </option>
                ) : null}
              </select>
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

          <section className="settings-section settings-section--card" aria-labelledby="expert-settings-title">
            <div className="settings-section__head">
              <div>
                <h3 id="expert-settings-title" className="settings-section__title">
                  专家追问
                </h3>
                <p className="settings-section__hint">固定使用 DeepSeek v4 Flash，目标 10 秒内</p>
              </div>
            </div>

            <div className="settings-toggle-row">
              <span className="settings-toggle-row__text">
                <span className="settings-field__label">自动追问</span>
                <span className="settings-field__desc">根据候选人的新证据自动发现追问点</span>
              </span>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  aria-label="自动追问"
                  checked={settings.autoGenerate}
                  onChange={(event) => onAutoGenerateChange(event.target.checked)}
                />
                <span className="settings-switch__track" aria-hidden="true" />
              </label>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-auto-mode">
                触发方式
              </label>
              <select
                id="setting-auto-mode"
                className="settings-select"
                value={settings.autoMode}
                disabled={!settings.autoGenerate}
                onChange={(event) => onAutoModeChange(event.target.value as AutoMode)}
              >
                <option value="agent">AI 判断 · 推荐</option>
                <option value="interval">固定间隔</option>
              </select>
            </div>

            {settings.autoMode === 'interval' ? (
              <div className="settings-field">
                <label className="settings-field__label" htmlFor="setting-auto-interval">
                  自动追问间隔
                </label>
                <select
                  id="setting-auto-interval"
                  className="settings-select"
                  value={String(settings.autoIntervalSec)}
                  disabled={!settings.autoGenerate}
                  onChange={(event) => onAutoIntervalChange(Number(event.target.value))}
                >
                  {AUTO_INTERVAL_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} 秒
                    </option>
                  ))}
                </select>
                <span className="settings-field__desc">{`每 ${settings.autoIntervalSec} 秒检查一次候选人新回答`}</span>
              </div>
            ) : null}
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
