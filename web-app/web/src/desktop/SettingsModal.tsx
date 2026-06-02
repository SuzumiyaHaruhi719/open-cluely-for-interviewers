import { useEffect, useState } from 'react';
import type { InterviewerMode, OutputLanguage } from '@open-cluely/contract';
import { INTERVIEWER_MODES } from '@open-cluely/contract';
import { MODE_META, LANGUAGE_OPTIONS } from './helpers';
import { CloseIcon } from './icons';
import { SHORTCUTS } from './shortcuts';
import { useMicDevices } from './useMicDevices';
import {
  MAX_OPACITY_STEP,
  MIN_OPACITY_STEP,
  type AppSettings
} from './useAppSettings';

interface SettingsModalProps {
  open: boolean;
  mode: InterviewerMode;
  outputLanguage: OutputLanguage;
  settings: AppSettings;
  onClose: () => void;
  onModeChange: (mode: InterviewerMode) => void;
  onLanguageChange: (language: OutputLanguage) => void;
  onAiModelChange: (value: string) => void;
  onAsrProviderChange: (value: string) => void;
  onOpacityChange: (step: number) => void;
  /** Open the full-window Pipeline Studio (Customize-mode node editor). */
  onOpenStudio: () => void;
}

/** Matches SETTINGS_CLOSE_MS on the desktop: hold the exit anim, then unmount. */
const CLOSE_ANIM_MS = 200;

const AI_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro · 推理最深' },
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash · 最快' },
  { value: 'qwen3-vl-plus', label: 'qwen3-vl-plus · 截图分析' }
];

const ASR_PROVIDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'paraformer', label: 'DashScope Paraformer (recommended)' },
  { value: 'xfyun', label: 'Xunfei RTASR (科大讯飞)' },
  { value: 'volc', label: 'Doubao streaming (豆包 / 火山引擎)' }
];

/**
 * Auto-saving settings modal, 1:1 with the desktop `.settings-panel` >
 * `.settings-dialog`. Open/close use the copied scrim + dialog spring/exit
 * animations (`.hidden` / `.is-closing`).
 *
 * Wired for the web:
 *  - Interviewer mode + output language → sendConfigure (via the shell).
 *  - AI model + ASR provider → persisted to localStorage (UI continuity only;
 *    server behaviour is fixed for this deployment, noted inline).
 *  - Window opacity → applied to `.app-shell` (works on the web) + persisted.
 *  - Mic device → enumerated via navigator.mediaDevices; system audio →
 *    getDisplayMedia info; shortcuts → static read-only list.
 *  - API key → read-only/informational (the key is server-side env).
 */
export function SettingsModal({
  open,
  mode,
  outputLanguage,
  settings,
  onClose,
  onModeChange,
  onLanguageChange,
  onAiModelChange,
  onAsrProviderChange,
  onOpacityChange,
  onOpenStudio
}: SettingsModalProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const { devices } = useMicDevices(open);
  const [micDeviceId, setMicDeviceId] = useState('');

  // Mount on open; on close, play the exit animation before unmounting.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) {
      return;
    }
    setClosing(true);
    const handle = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_ANIM_MS);
    return () => window.clearTimeout(handle);
  }, [open, mounted]);

  // Escape closes the modal while it is open.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!mounted) {
    return null;
  }

  const panelClass = `settings-panel${closing ? ' is-closing' : ''}`;
  const opacityValue = `${settings.opacityStep}/${MAX_OPACITY_STEP}`;

  return (
    <div
      id="settings-panel"
      className={panelClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(e) => {
        // Click on the scrim (not the dialog) closes — like the desktop.
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="settings-dialog">
        <div className="settings-header">
          <h2 id="settings-title" className="settings-title">
            Settings
          </h2>
          <span
            id="settings-status"
            className="settings-status"
            data-state="idle"
            role="status"
            aria-live="polite"
          />
          <button
            id="close-settings"
            className="settings-close"
            type="button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section settings-section--mode">
            <h3 className="settings-section__title">Interviewer mode</h3>
            <div
              className="mode-segmented"
              id="setting-interviewer-mode"
              role="radiogroup"
              aria-label="Interviewer mode"
            >
              {INTERVIEWER_MODES.map((value) => {
                const meta = MODE_META[value];
                const active = value === mode;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`mode-segmented__btn${active ? ' is-active' : ''}`}
                    data-mode={meta.attr}
                    role="radio"
                    aria-checked={active}
                    onClick={() => onModeChange(value)}
                  >
                    <span className="mode-segmented__glow" aria-hidden="true" />
                    <span className="mode-segmented__top">
                      <span className="mode-segmented__dot" aria-hidden="true" />
                      <span className="mode-segmented__label">{meta.label}</span>
                    </span>
                    <span className="mode-segmented__desc">{meta.desc}</span>
                  </button>
                );
              })}
            </div>

            {mode === 'customize' ? (
              <div className="customize-row" id="customize-row">
                <div className="customize-block">
                  <div className="customize-block__label">① 选一个面试模板</div>
                  <div
                    className="customize-templates"
                    id="customize-templates"
                    role="listbox"
                    aria-label="面试模板"
                  >
                    <button type="button" className="customize-card" role="option" aria-selected="false">
                      <span className="customize-card__top">
                        资深后端
                        <span className="customize-card__badge">内置</span>
                      </span>
                      <span className="customize-card__desc">分布式系统 · 深链追问</span>
                    </button>
                    <button type="button" className="customize-card" role="option" aria-selected="false">
                      <span className="customize-card__top">
                        产品经理
                        <span className="customize-card__badge">内置</span>
                      </span>
                      <span className="customize-card__desc">指标驱动 · 取舍判断</span>
                    </button>
                  </div>
                </div>
                <div className="customize-block customize-block--advanced">
                  <button
                    type="button"
                    id="open-pipeline-studio"
                    className="action-btn action-btn--ghost"
                    title="Open the node editor"
                    onClick={onOpenStudio}
                  >
                    ⚙ 高级编辑（节点编辑器）
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">API key</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-dashscope-key">
                DashScope key
              </label>
              <div className="settings-key-row">
                <input
                  type="text"
                  id="setting-dashscope-key"
                  className="settings-input settings-input--mono"
                  value="Managed by the server"
                  readOnly
                  aria-readonly="true"
                />
              </div>
              <p className="settings-field__desc">
                This deployment uses a server-side key (environment variable). The browser never
                sees or sends it.
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">AI 模型（Fast 模式）</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-dashscope-ai-model">
                Fast 模式 / 通用 AI 模型
              </label>
              <select
                id="setting-dashscope-ai-model"
                className="settings-select"
                value={settings.aiModel}
                onChange={(e) => onAiModelChange(e.target.value)}
              >
                {AI_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                Saved in this browser for continuity. Server model selection is fixed for this
                deployment, so this does not change replies for now.
              </p>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-output-language">
                Generate Q 输出语言
              </label>
              <select
                id="setting-output-language"
                className="settings-select"
                value={outputLanguage}
                onChange={(e) => onLanguageChange(e.target.value as OutputLanguage)}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value || 'auto'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                最终追问输出的语言。技术名词、工具/产品名、缩写与候选人原话引用保持原样。
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Speech recognition</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-asr-provider">
                Provider
              </label>
              <select
                id="setting-asr-provider"
                className="settings-select"
                value={settings.asrProvider}
                onChange={(e) => onAsrProviderChange(e.target.value)}
              >
                {ASR_PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                Saved in this browser. The server streams via{' '}
                <code>paraformer-realtime-8k-v2</code> regardless of this selection for now.
              </p>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-mic-device">
                Microphone (your voice)
              </label>
              <select
                id="setting-mic-device"
                className="settings-select"
                value={micDeviceId}
                onChange={(e) => setMicDeviceId(e.target.value)}
              >
                <option value="">System default microphone</option>
                {devices.map((device) => (
                  <option key={device.deviceId || device.label} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                Device labels appear after you grant microphone permission once.
              </p>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-system-source">
                System audio (candidate's voice)
              </label>
              <select id="setting-system-source" className="settings-select" defaultValue="tab" disabled>
                <option value="tab">Browser tab share (getDisplayMedia)</option>
              </select>
              <p className="settings-field__desc">
                On the web, candidate audio comes from a shared browser tab/window picked when you
                start the computer-audio channel.
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Appearance</h3>
            <div className="settings-field">
              <span className="settings-field__label" id="setting-window-opacity-label">
                Window opacity
              </span>
              <div className="settings-range-row">
                <input
                  type="range"
                  id="setting-window-opacity"
                  className="settings-range"
                  min={MIN_OPACITY_STEP}
                  max={MAX_OPACITY_STEP}
                  step={1}
                  value={settings.opacityStep}
                  aria-labelledby="setting-window-opacity-label"
                  onChange={(e) => onOpacityChange(Number(e.target.value))}
                />
                <span id="setting-window-opacity-value" className="settings-range-value">
                  {opacityValue}
                </span>
              </div>
            </div>
            <div className="settings-field">
              <span className="settings-field__label">Keyboard shortcuts</span>
              <div id="settings-shortcuts-list" className="settings-shortcuts-list">
                {SHORTCUTS.map((shortcut) => (
                  <div className="settings-shortcut-row" key={shortcut.id}>
                    <div className="settings-shortcut-meta">
                      <div className="settings-shortcut-text">
                        <span className="settings-shortcut-button" title={shortcut.description}>
                          {shortcut.label}
                        </span>
                        <span className="settings-shortcut-description">{shortcut.description}</span>
                      </div>
                    </div>
                    <span className="settings-shortcut-key">{shortcut.keys}</span>
                  </div>
                ))}
              </div>
              <p className="settings-field__desc">Read-only reference.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
