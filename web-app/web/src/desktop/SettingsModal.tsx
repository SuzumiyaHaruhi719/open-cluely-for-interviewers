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
  type AutoMode,
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
  /** Change the report-generation model (Feature 2). */
  onSummaryModelChange: (value: string) => void;
  /** Change the summary prompt mode: 'default' or 'custom' (Feature 3). */
  onSummaryPromptModeChange: (mode: 'default' | 'custom') => void;
  /** Update the custom summary prompt text (Feature 3). */
  onSummaryPromptTextChange: (text: string) => void;
  onAsrProviderChange: (value: string) => void;
  /** Set the autonomous follow-up trigger mode (AI monitor vs fixed 30s). */
  onAutoModeChange: (mode: AutoMode) => void;
  /** Set the interval-mode cooldown in SECONDS (pushed as autoIntervalMs). */
  onAutoIntervalChange: (sec: number) => void;
  /** Merge-patch the Doubao/Volc credential fields (revealed when provider = volc). */
  onVolcSettingsChange: (patch: Partial<VolcSettings>) => void;
  /** Set the offline FunASR streaming-SPK WS URL (used for 线下 / offline interviews). */
  onFunasrUrlChange: (value: string) => void;
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

/**
 * Available models for the evaluation report (Feature 2).
 * User instruction: 用户可在设置选择生成报告的模型
 * Only models confirmed available on the DashScope key are offered. qwen3.7-max
 * and glm-5.2 were removed — they returned 400 "model does not exist" on this key.
 */
const SUMMARY_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro · 深度·慢·默认' },
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash · 快' }
];

const ASR_PROVIDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'paraformer', label: 'DashScope Paraformer（推荐）' },
  { value: 'xfyun', label: '讯飞实时转写（科大讯飞）' },
  { value: 'volc', label: '豆包流式语音（火山引擎）' },
  { value: 'sim', label: '本地模拟注入脚本' }
];

// Autonomous follow-up trigger mode. 'agent' lets an AI monitor decide when to
// follow up; 'interval' fires on a fixed 30s cadence. Pushed via SessionConfig.autoMode.
const AUTO_MODE_OPTIONS: ReadonlyArray<{ value: AutoMode; label: string }> = [
  { value: 'agent', label: 'AI 智能追问' },
  { value: 'interval', label: '每 30 秒自动' }
];

// Interviewer-adjustable cooldown (in SECONDS) for interval mode. Pushed as
// SessionConfig.autoIntervalMs (× 1000); only used when autoMode === 'interval'.
const AUTO_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 15, label: '15 秒' },
  { value: 30, label: '30 秒' },
  { value: 45, label: '45 秒' },
  { value: 60, label: '60 秒' },
  { value: 90, label: '90 秒' }
];

// Doubao streaming ASR resource ids — the "model" the user picks. 2.0 (seedasr)
// must be enabled on the account or the handshake 400s; 1.0 (bigasr) is the
// broadly-available fallback. Drives X-Api-Resource-Id on the server.
const VOLC_RESOURCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'volc.seedasr.sauc.duration', label: '豆包流式 2.0 · 小时版（推荐）' },
  { value: 'volc.seedasr.sauc.concurrent', label: '豆包流式 2.0 · 并发版' },
  { value: 'volc.bigasr.sauc.duration', label: '豆包流式 1.0 · 小时版' },
  { value: 'volc.bigasr.sauc.concurrent', label: '豆包流式 1.0 · 并发版' }
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
  onSummaryModelChange,
  onSummaryPromptModeChange,
  onSummaryPromptTextChange,
  onAsrProviderChange,
  onAutoModeChange,
  onAutoIntervalChange,
  onVolcSettingsChange,
  onFunasrUrlChange,
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
            设置
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
            aria-label="关闭设置"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section settings-section--mode">
            <h3 className="settings-section__title">面试模式</h3>
            <div
              className="mode-segmented"
              id="setting-interviewer-mode"
              role="radiogroup"
              aria-label="面试模式"
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
                    title="打开节点编辑器"
                    onClick={onOpenStudio}
                  >
                    ⚙ 高级编辑（节点编辑器）
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">API 密钥</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-dashscope-key">
                DashScope 密钥
              </label>
              <div className="settings-key-row">
                <input
                  type="text"
                  id="setting-dashscope-key"
                  className="settings-input settings-input--mono"
                  value="由服务端管理"
                  readOnly
                  aria-readonly="true"
                />
              </div>
              <p className="settings-field__desc">
                当前部署使用服务端环境变量里的密钥。浏览器不会看到或发送该密钥。
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">豆包 API（语音识别）</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-volc-app-id">
                豆包 APP ID
              </label>
              <input
                type="text"
                id="setting-volc-app-id"
                className="settings-input settings-input--mono"
                value={settings.volcAppId}
                autoComplete="off"
                spellCheck={false}
                placeholder="留空则用服务端 .env (VOLC_APP_ID)"
                onChange={(e) => onVolcSettingsChange({ volcAppId: e.target.value })}
              />
              <label
                className="settings-field__label"
                htmlFor="setting-volc-access-token"
                style={{ marginTop: 8 }}
              >
                豆包 Access Token
              </label>
              <input
                type="password"
                id="setting-volc-access-token"
                className="settings-input settings-input--mono"
                value={settings.volcAccessToken}
                autoComplete="off"
                spellCheck={false}
                placeholder="留空则用服务端 .env (VOLC_ACCESS_TOKEN)"
                onChange={(e) => onVolcSettingsChange({ volcAccessToken: e.target.value })}
              />
              <label
                className="settings-field__label"
                htmlFor="setting-volc-model"
                style={{ marginTop: 8 }}
              >
                模型
              </label>
              <select
                id="setting-volc-model"
                className="settings-select"
                value={settings.volcResourceId || 'volc.seedasr.sauc.duration'}
                onChange={(e) => onVolcSettingsChange({ volcResourceId: e.target.value })}
              >
                {VOLC_RESOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                豆包流式语音识别（火山引擎）。APP ID / Access Token 已在服务端 <code>.env</code> 配置，
                这里留空即用、填写则覆盖。2.0（seedasr）需账号开通对应资源，否则握手报 400 —— 用不了就选
                1.0（bigasr）。需在下方「语音识别」把服务商选成豆包才会启用。
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">AI 模型（快速模式）</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-dashscope-ai-model">
                快速模式与通用 AI 模型
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
                为了保持体验连续性，会保存在当前浏览器。本部署的服务端模型选择目前固定，因此暂时不会改变回复。
              </p>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-summary-model">
                评估报告模型
              </label>
              <select
                id="setting-summary-model"
                className="settings-select"
                value={settings.summaryModel}
                onChange={(e) => onSummaryModelChange(e.target.value)}
              >
                {SUMMARY_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                生成面试评估报告时使用的模型。deepseek-v4-pro 推理最深（默认，30-180 秒）；deepseek-v4-flash
                速度最快。
              </p>
            </div>

            <div className="settings-field">
              <span className="settings-field__label">总结提示词</span>
              <div
                className="mode-segmented mode-segmented--sm"
                role="radiogroup"
                aria-label="总结提示词模式"
              >
                <button
                  type="button"
                  className={`mode-segmented__btn${settings.summaryPromptMode === 'default' ? ' is-active' : ''}`}
                  role="radio"
                  aria-checked={settings.summaryPromptMode === 'default'}
                  onClick={() => onSummaryPromptModeChange('default')}
                >
                  <span className="mode-segmented__top">
                    <span className="mode-segmented__dot" aria-hidden="true" />
                    <span className="mode-segmented__label">默认</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`mode-segmented__btn${settings.summaryPromptMode === 'custom' ? ' is-active' : ''}`}
                  role="radio"
                  aria-checked={settings.summaryPromptMode === 'custom'}
                  onClick={() => onSummaryPromptModeChange('custom')}
                >
                  <span className="mode-segmented__top">
                    <span className="mode-segmented__dot" aria-hidden="true" />
                    <span className="mode-segmented__label">自定义</span>
                  </span>
                </button>
              </div>
              {settings.summaryPromptMode === 'custom' ? (
                <textarea
                  id="setting-summary-prompt-text"
                  className="settings-input"
                  rows={6}
                  placeholder="在此输入自定义的系统提示词。留空则自动回退到内置默认提示词。"
                  value={settings.summaryPromptText}
                  onChange={(e) => onSummaryPromptTextChange(e.target.value)}
                  style={{ marginTop: 8, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                />
              ) : null}
              <p className="settings-field__desc">
                <strong>默认</strong>：使用内置精调评估提示词（推荐）。<strong>自定义</strong>：输入你自己的系统提示词，
                完全替换内置提示词发送给模型。留空时自动回退到内置提示词。
              </p>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-output-language">
                追问输出语言
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
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-auto-mode">
                自动追问模式
              </label>
              <select
                id="setting-auto-mode"
                className="settings-select"
                value={settings.autoMode}
                onChange={(e) => onAutoModeChange(e.target.value as AutoMode)}
              >
                {AUTO_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                <code>AI 智能追问</code> 由 AI 监控决定何时追问；<code>每 30 秒自动</code>
                固定每 30 秒触发一次，不计生成耗时。
              </p>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-auto-interval">
                自动追问间隔
              </label>
              <select
                id="setting-auto-interval"
                className="settings-select"
                value={settings.autoIntervalSec}
                disabled={settings.autoMode !== 'interval'}
                onChange={(e) => onAutoIntervalChange(Number(e.target.value))}
              >
                {AUTO_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                仅在<code>每 N 秒自动</code>模式下生效：每隔所选秒数固定触发一次自动追问（不计生成耗时）。
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">语音识别</h3>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-asr-provider">
                服务商
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
                会保存在当前浏览器并实时应用。<code>Paraformer</code> 使用服务端 DashScope 密钥。
                <code>豆包</code> 通过火山引擎流式识别，请在上方 <strong>豆包 API</strong> 区域配置
                APP ID / Access Token / 模型。<code>本地模拟注入脚本</code> 会回放一段本地脚本对话，
                方便在没有麦克风或云端 ASR 时检查消息注入。<code>讯飞</code> 走实时语音转写通道。
              </p>
            </div>

            <div id="settings-funasr" className="settings-field">
              <label className="settings-field__label" htmlFor="setting-funasr-url">
                线下 · CAM++ 说话人分离本地服务地址
              </label>
              <input
                type="text"
                id="setting-funasr-url"
                className="settings-input settings-input--mono"
                value={settings.funasrUrl}
                autoComplete="off"
                spellCheck={false}
                placeholder="http://localhost:10097"
                onChange={(e) => onFunasrUrlChange(e.target.value)}
              />
              <p className="settings-field__desc">
                线下面试（单麦克风）转写仍走云端 Paraformer，另用本地 CAM++ sidecar 做说话人分离
                （先说话=面试官）。这是该本地服务的 HTTP 地址；留空则用服务端默认地址。
              </p>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-mic-device">
                麦克风（你的声音）
              </label>
              <select
                id="setting-mic-device"
                className="settings-select"
                value={micDeviceId}
                onChange={(e) => setMicDeviceId(e.target.value)}
              >
                <option value="">系统默认麦克风</option>
                {devices.map((device) => (
                  <option key={device.deviceId || device.label} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <p className="settings-field__desc">
                授权一次麦克风权限后，会显示设备名称。
              </p>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="setting-system-source">
                系统音频（候选人的声音）
              </label>
              <select id="setting-system-source" className="settings-select" defaultValue="tab" disabled>
                <option value="tab">共享浏览器标签页（getDisplayMedia）</option>
              </select>
              <p className="settings-field__desc">
                网页版会在启动电脑音频通道时，让你选择一个共享的浏览器标签页或窗口作为候选人音频来源。
              </p>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">外观</h3>
            <div className="settings-field">
              <span className="settings-field__label" id="setting-window-opacity-label">
                窗口透明度
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
              <span className="settings-field__label">键盘快捷键</span>
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
              <p className="settings-field__desc">只读参考。</p>
            </div>
            <div className="settings-field">
              <span className="settings-field__label">新手引导</span>
              <button
                type="button"
                className="settings-btn"
                onClick={() => {
                  try { localStorage.removeItem('tour-completed-v2'); } catch {}
                  window.location.reload();
                }}
              >重新播放引导 Tour</button>
              <p className="settings-field__desc">重新查看面试官 Copilot 的功能导览。</p>
            </div>
            <div className="settings-field">
              <span className="settings-field__label">帮助</span>
              <p className="settings-field__desc">
                遇到问题？按 <code>Alt+Shift+H</code> 查看快捷键，或在设置中重播引导 Tour。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
