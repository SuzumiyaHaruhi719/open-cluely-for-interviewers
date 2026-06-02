import { useEffect, useState } from 'react';
import type { InterviewerMode, OutputLanguage } from '@open-cluely/contract';
import { INTERVIEWER_MODES } from '@open-cluely/contract';
import { MODE_META, LANGUAGE_OPTIONS } from './helpers';
import { CloseIcon } from './icons';

interface SettingsModalProps {
  open: boolean;
  mode: InterviewerMode;
  outputLanguage: OutputLanguage;
  onClose: () => void;
  onModeChange: (mode: InterviewerMode) => void;
  onLanguageChange: (language: OutputLanguage) => void;
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
 * Wired: the `.mode-segmented` control (→ sendConfigure({ mode }), reflected in
 * the topbar #mode-indicator) and the output-language select
 * (→ sendConfigure({ outputLanguage })). The API key, AI-model, ASR-provider,
 * mic/system device and appearance fields are faithful-but-visual for now.
 */
export function SettingsModal({
  open,
  mode,
  outputLanguage,
  onClose,
  onModeChange,
  onLanguageChange
}: SettingsModalProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

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
          <span id="settings-status" className="settings-status" data-state="idle" role="status" aria-live="polite" />
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
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">API key</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-dashscope-key">
                DashScope key
              </label>
              <div className="settings-key-row">
                <input
                  type="password"
                  id="setting-dashscope-key"
                  className="settings-input settings-input--mono"
                  placeholder="sk-..."
                />
                <button type="button" className="settings-key-toggle" aria-pressed="false" title="Coming soon">
                  Show
                </button>
              </div>
              <p className="settings-field__desc">
                One key drives AI, Paraformer ASR, and the interviewer copilot. Get it at{' '}
                <code>dashscope.console.aliyun.com</code>.
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">AI 模型（Fast 模式）</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-dashscope-ai-model">
                Fast 模式 / 通用 AI 模型
              </label>
              <select id="setting-dashscope-ai-model" className="settings-select" defaultValue="deepseek-v4-pro">
                {AI_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
              <select id="setting-asr-provider" className="settings-select" defaultValue="paraformer">
                {ASR_PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                Streams via <code>paraformer-realtime-8k-v2</code> using the DashScope key above.
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
                  min={1}
                  max={10}
                  step={1}
                  defaultValue={10}
                  aria-labelledby="setting-window-opacity-label"
                  title="Coming soon"
                />
                <span id="setting-window-opacity-value" className="settings-range-value">
                  10/10
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
