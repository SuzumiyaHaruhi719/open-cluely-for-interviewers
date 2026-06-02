import { useEffect, useState } from 'react';
import type { InterviewerMode, OutputLanguage } from '@open-cluely/contract';
import { INTERVIEWER_MODES } from '@open-cluely/contract';
import { MODE_META, LANGUAGE_OPTIONS } from './helpers';
import { CloseIcon } from './icons';
import { SHORTCUTS } from './shortcuts';
import { useMicDevices } from './useMicDevices';
import { useCustomizePipelines } from './useCustomizePipelines';
import {
  MAX_OPACITY_STEP,
  MIN_OPACITY_STEP,
  type AppSettings,
  type VolcSettings
} from './useAppSettings';

interface SettingsModalProps {
  open: boolean;
  mode: InterviewerMode;
  outputLanguage: OutputLanguage;
  settings: AppSettings;
  /** The Customize pipeline the session currently runs (marks the active card). */
  activePipelineId: string | null;
  onClose: () => void;
  onModeChange: (mode: InterviewerMode) => void;
  onLanguageChange: (language: OutputLanguage) => void;
  onAiModelChange: (value: string) => void;
  onAsrProviderChange: (value: string) => void;
  /** Merge-patch the Doubao/Volc credential fields (revealed when provider = volc). */
  onVolcSettingsChange: (patch: Partial<VolcSettings>) => void;
  onOpacityChange: (step: number) => void;
  /** Pick a saved/builtin pipeline as the active Customize pipeline. */
  onSelectPipeline: (id: string) => void;
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
  activePipelineId,
  onClose,
  onModeChange,
  onLanguageChange,
  onAiModelChange,
  onAsrProviderChange,
  onVolcSettingsChange,
  onOpacityChange,
  onSelectPipeline,
  onOpenStudio
}: SettingsModalProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const { devices } = useMicDevices(open);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');

  // Customize-row gallery + AI generator. Only fetches while the modal is open in
  // Customize mode (the row itself is only rendered then).
  const customize = useCustomizePipelines(open && mode === 'customize');

  const onGeneratePipeline = async (): Promise<void> => {
    const id = await customize.generate(aiPrompt);
    if (id) {
      onSelectPipeline(id);
      setAiPrompt('');
    }
  };

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
                    {customize.loading && customize.pipelines.length === 0 ? (
                      <p className="settings-field__desc">加载模板中…</p>
                    ) : null}
                    {customize.pipelines.map((pipeline) => {
                      const isActive = pipeline.id === activePipelineId;
                      const badgeLabel = pipeline.builtin ? '模板' : '自定义';
                      const badgeClass = `customize-card__badge${
                        pipeline.builtin ? '' : ' customize-card__badge--user'
                      }`;
                      return (
                        <button
                          key={pipeline.id}
                          type="button"
                          className={`customize-card${isActive ? ' customize-card--active' : ''}`}
                          role="option"
                          aria-selected={isActive}
                          data-id={pipeline.id}
                          data-name={pipeline.name}
                          onClick={() => onSelectPipeline(pipeline.id)}
                        >
                          <span className="customize-card__top">
                            {pipeline.name}
                            <span className={badgeClass}>{badgeLabel}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="customize-block">
                  <div className="customize-block__label">② 或者用一句话让 AI 生成</div>
                  <div className="customize-ai">
                    <input
                      type="text"
                      id="customize-ai-input"
                      className="settings-input"
                      placeholder="例如：招一个能扛事、会带团队的资深后端，重点看线上事故判断"
                      value={aiPrompt}
                      disabled={customize.generating}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void onGeneratePipeline();
                        }
                      }}
                    />
                    <button
                      type="button"
                      id="customize-ai-generate"
                      className="action-btn"
                      disabled={customize.generating}
                      onClick={() => void onGeneratePipeline()}
                    >
                      {customize.generating ? '生成中…' : 'AI 生成'}
                    </button>
                  </div>
                  <div className="customize-ai__hint" id="customize-ai-hint">
                    {customize.hint}
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
                Saved in this browser and applied live. <code>Paraformer</code> uses the
                server&apos;s DashScope key. <code>Doubao (豆包)</code> streams via Volcengine and
                needs the credentials below. <code>Xunfei</code> is not wired yet.
              </p>
            </div>

            {settings.asrProvider === 'volc' ? (
              <div id="settings-volc-creds" className="settings-field">
                <label className="settings-field__label" htmlFor="setting-volc-app-id">
                  Doubao APP ID
                </label>
                <input
                  type="text"
                  id="setting-volc-app-id"
                  className="settings-input settings-input--mono"
                  value={settings.volcAppId}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="X-Api-App-Key"
                  onChange={(e) => onVolcSettingsChange({ volcAppId: e.target.value })}
                />
                <label
                  className="settings-field__label"
                  htmlFor="setting-volc-access-token"
                  style={{ marginTop: 8 }}
                >
                  Doubao Access Token
                </label>
                <input
                  type="password"
                  id="setting-volc-access-token"
                  className="settings-input settings-input--mono"
                  value={settings.volcAccessToken}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="X-Api-Access-Key"
                  onChange={(e) => onVolcSettingsChange({ volcAccessToken: e.target.value })}
                />
                <label
                  className="settings-field__label"
                  htmlFor="setting-volc-model"
                  style={{ marginTop: 8 }}
                >
                  Model (optional)
                </label>
                <input
                  type="text"
                  id="setting-volc-model"
                  className="settings-input settings-input--mono"
                  value={settings.volcModel}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="bigmodel"
                  onChange={(e) => onVolcSettingsChange({ volcModel: e.target.value })}
                />
                <label
                  className="settings-field__label"
                  htmlFor="setting-volc-resource-id"
                  style={{ marginTop: 8 }}
                >
                  Resource ID (optional)
                </label>
                <input
                  type="text"
                  id="setting-volc-resource-id"
                  className="settings-input settings-input--mono"
                  value={settings.volcResourceId}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="volc.bigasr.sauc.duration"
                  onChange={(e) => onVolcSettingsChange({ volcResourceId: e.target.value })}
                />
                <p className="settings-field__desc">
                  Sent to the server, which opens the Doubao connection on your behalf — the browser
                  never connects to Volcengine directly, and the server never logs these. Stored in
                  this browser only. Live transcription starts once both APP ID and Access Token are
                  filled in.
                </p>
              </div>
            ) : null}

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
