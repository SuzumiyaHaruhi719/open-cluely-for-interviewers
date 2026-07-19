import { useCallback, useEffect, useState } from 'react';
import type { InterviewerModel, OutputLanguage } from '@open-cluely/contract';

const KEYS = {
  aiModel: 'open-cluely.aiModel',
  asrProvider: 'open-cluely.asrProvider',
  volcAppId: 'open-cluely.volcAppId',
  volcAccessToken: 'open-cluely.volcAccessToken',
  volcResourceId: 'open-cluely.volcResourceId',
  volcModel: 'open-cluely.volcModel',
  opacity: 'open-cluely.windowOpacity',
  autoGenerate: 'open-cluely.autoGenerate',
  autoMode: 'open-cluely.autoMode',
  autoIntervalSec: 'open-cluely.autoIntervalSec',
  summaryModel: 'open-cluely.summaryModel',
  summaryPromptMode: 'open-cluely.summaryPromptMode',
  summaryPromptText: 'open-cluely.summaryPromptText',
  outputLanguage: 'open-cluely.outputLanguage',
  micDeviceId: 'mic.inputDeviceId'
} as const;

export const DEFAULT_AI_MODEL: InterviewerModel = 'deepseek-v4-flash';
export const DEFAULT_OUTPUT_LANGUAGE: OutputLanguage = 'zh';
const AI_MODELS: ReadonlySet<string> = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'qwen3-vl-plus'
]);
/** Default summary prompt mode — use the built-in polished evaluation prompt. */
export const DEFAULT_SUMMARY_PROMPT_MODE: 'default' | 'custom' = 'default';
/** Default custom prompt text — empty means not yet set. */
export const DEFAULT_SUMMARY_PROMPT_TEXT = '';
/**
 * Default summary model. Matches the server's DEFAULT_SUMMARY_MODEL (deepseek-v4-pro).
 * The user can override via the Settings modal; the value is sent in `summaryModel`
 * on every `configure` so the server uses it for the next summarize call.
 */
export const DEFAULT_SUMMARY_MODEL = 'deepseek-v4-pro';
export const DEFAULT_ASR_PROVIDER = 'paraformer';
/** Default Doubao ASR resource id — 1.0 hourly is granted on the current account. */
export const DEFAULT_VOLC_RESOURCE_ID = 'volc.bigasr.sauc.duration';
/** Autonomous question generation defaults ON (the design's auto-on default). */
export const DEFAULT_AUTO_GENERATE = true;
/**
 * Autonomous follow-up trigger MODE. 'agent' = an AI monitor decides when to
 * follow up (the design default); 'interval' = a fixed 30s cadence. Pushed to
 * the server via SessionConfig.autoMode.
 */
export const DEFAULT_AUTO_MODE: AutoMode = 'agent';
/**
 * Default interval-mode cooldown in SECONDS (matches the legacy fixed 30s cadence).
 * Pushed to the server as autoIntervalMs (× 1000); only used when autoMode === 'interval'.
 */
export const DEFAULT_AUTO_INTERVAL_SEC = 30;
/** Floor for the interval cooldown — mirrors the server's sane minimum. */
export const MIN_AUTO_INTERVAL_SEC = 5;
/** Opacity is a 1..10 step (matching the desktop slider); 10 = fully opaque. */
export const DEFAULT_OPACITY_STEP = 10;
export const MIN_OPACITY_STEP = 1;
export const MAX_OPACITY_STEP = 10;

/** Autonomous follow-up trigger mode (mirrors SessionConfig.autoMode). */
export type AutoMode = 'agent' | 'interval';

export interface AppSettings {
  aiModel: InterviewerModel;
  /** Follow-up language; Chinese is the product default and persists per browser. */
  outputLanguage: OutputLanguage;
  /** Per-session summary model id. Sent to the server via `configure.summaryModel`. */
  summaryModel: string;
  /**
   * Per-session summary prompt mode (Feature 3).
   *   'default' — server uses the built-in polished evaluation prompt.
   *   'custom'  — server uses `summaryPromptText` when non-empty, else the default.
   */
  summaryPromptMode: 'default' | 'custom';
  /**
   * Per-session custom system prompt text (Feature 3). Only sent to the server
   * when summaryPromptMode === 'custom'. Ignored (falls back to default) when blank.
   */
  summaryPromptText: string;
  asrProvider: string;
  /** Shared room-microphone device used by Settings, Composer, and audioCapture. */
  micDeviceId: string;
  /**
   * Doubao / Volcengine credentials (only meaningful when asrProvider === 'volc').
   * SECURITY: stored in this browser's localStorage — same local-store behaviour
   * as the desktop app on the user's own machine. They are sent to the server
   * (which opens the Volc connection); the browser never connects to Volc directly.
   */
  volcAppId: string;
  volcAccessToken: string;
  volcResourceId: string;
  volcModel: string;
  opacityStep: number;
  /** Autonomous context-driven question generation (auto-on by default). */
  autoGenerate: boolean;
  /** Autonomous follow-up trigger mode: AI monitor ('agent') vs fixed 30s ('interval'). */
  autoMode: AutoMode;
  /**
   * Interval-mode cooldown in SECONDS (default 30, floored at 5). Pushed to the
   * server as autoIntervalMs; only used when autoMode === 'interval'.
   */
  autoIntervalSec: number;
}

function readString(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }
  return localStorage.getItem(key) ?? fallback;
}

function readAiModel(): InterviewerModel {
  const value = readString(KEYS.aiModel, DEFAULT_AI_MODEL);
  return AI_MODELS.has(value) ? (value as InterviewerModel) : DEFAULT_AI_MODEL;
}

function readOutputLanguage(): OutputLanguage {
  const value = readString(KEYS.outputLanguage, DEFAULT_OUTPUT_LANGUAGE);
  return value === 'en' || value === '' ? value : 'zh';
}

/** Read a persisted boolean; only the literal string 'false' turns it off. */
function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  return raw !== 'false';
}

function readOpacityStep(): number {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_OPACITY_STEP;
  }
  const raw = localStorage.getItem(KEYS.opacity);
  const value = raw === null ? DEFAULT_OPACITY_STEP : Number(raw);
  if (!Number.isFinite(value)) {
    return DEFAULT_OPACITY_STEP;
  }
  return Math.min(MAX_OPACITY_STEP, Math.max(MIN_OPACITY_STEP, Math.round(value)));
}

/** Read a persisted integer, coerced to a finite value floored at `min`. */
function readNumber(key: string, fallback: number, min: number): number {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }
  const raw = localStorage.getItem(key);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.round(value));
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode / quota — state still lives in memory for this session.
  }
}

/** The Volc credential fields, kept together for the modal's onChange wiring. */
export interface VolcSettings {
  volcAppId: string;
  volcAccessToken: string;
  volcResourceId: string;
  volcModel: string;
}

export interface UseAppSettings {
  settings: AppSettings;
  setAiModel: (value: InterviewerModel) => void;
  setOutputLanguage: (value: OutputLanguage) => void;
  setSummaryModel: (value: string) => void;
  /** Set the summary prompt mode ('default' | 'custom') and persist to localStorage. */
  setSummaryPromptMode: (mode: 'default' | 'custom') => void;
  /** Set the custom summary prompt text and persist to localStorage. */
  setSummaryPromptText: (text: string) => void;
  setAsrProvider: (value: string) => void;
  setMicDeviceId: (value: string) => void;
  /** Merge-patch the Volc credential fields (persists each touched field). */
  setVolcSettings: (patch: Partial<VolcSettings>) => void;
  setOpacityStep: (value: number) => void;
  /** Toggle autonomous question generation (persisted to localStorage). */
  setAutoGenerate: (value: boolean) => void;
  /** Set the autonomous follow-up trigger mode (persisted to localStorage). */
  setAutoMode: (value: AutoMode) => void;
  /** Set the interval-mode cooldown in seconds (clamped >=5, persisted to localStorage). */
  setAutoIntervalSec: (value: number) => void;
}

const VOLC_FIELD_KEYS: Record<keyof VolcSettings, string> = {
  volcAppId: KEYS.volcAppId,
  volcAccessToken: KEYS.volcAccessToken,
  volcResourceId: KEYS.volcResourceId,
  volcModel: KEYS.volcModel
};

/**
 * Web-only app settings persisted to localStorage. The ASR provider select is
 * now FUNCTIONAL: changing it (and the Volc creds, when 'volc' is chosen) is
 * pushed to the server by the Shell via sendConfigure, which opens the matching
 * recognition session. The AI-model selection is persisted here and pushed by
 * the Shell as SessionConfig.interviewerModel. The window-opacity step is
 * applied to `.app-shell` by the Shell.
 */
export function useAppSettings(): UseAppSettings {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    aiModel: readAiModel(),
    outputLanguage: readOutputLanguage(),
    summaryModel: readString(KEYS.summaryModel, DEFAULT_SUMMARY_MODEL),
    summaryPromptMode: readString(KEYS.summaryPromptMode, DEFAULT_SUMMARY_PROMPT_MODE) === 'custom' ? 'custom' : 'default',
    summaryPromptText: readString(KEYS.summaryPromptText, DEFAULT_SUMMARY_PROMPT_TEXT),
    asrProvider: readString(KEYS.asrProvider, DEFAULT_ASR_PROVIDER),
    micDeviceId: readString(KEYS.micDeviceId, ''),
    volcAppId: readString(KEYS.volcAppId, ''),
    volcAccessToken: readString(KEYS.volcAccessToken, ''),
    volcResourceId: readString(KEYS.volcResourceId, DEFAULT_VOLC_RESOURCE_ID),
    volcModel: readString(KEYS.volcModel, ''),
    opacityStep: readOpacityStep(),
    autoGenerate: readBool(KEYS.autoGenerate, DEFAULT_AUTO_GENERATE),
    // Anything other than the literal 'interval' coerces to the 'agent' default.
    autoMode: readString(KEYS.autoMode, DEFAULT_AUTO_MODE) === 'interval' ? 'interval' : 'agent',
    autoIntervalSec: readNumber(KEYS.autoIntervalSec, DEFAULT_AUTO_INTERVAL_SEC, MIN_AUTO_INTERVAL_SEC)
  }));

  const setAiModel = useCallback((value: InterviewerModel): void => {
    setSettings((prev) => ({ ...prev, aiModel: value }));
    persist(KEYS.aiModel, value);
  }, []);

  const setOutputLanguage = useCallback((value: OutputLanguage): void => {
    setSettings((prev) => ({ ...prev, outputLanguage: value }));
    persist(KEYS.outputLanguage, value);
  }, []);

  const setSummaryModel = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, summaryModel: value }));
    persist(KEYS.summaryModel, value);
  }, []);

  const setSummaryPromptMode = useCallback((mode: 'default' | 'custom'): void => {
    setSettings((prev) => ({ ...prev, summaryPromptMode: mode }));
    persist(KEYS.summaryPromptMode, mode);
  }, []);

  const setSummaryPromptText = useCallback((text: string): void => {
    setSettings((prev) => ({ ...prev, summaryPromptText: text }));
    persist(KEYS.summaryPromptText, text);
  }, []);

  const setAsrProvider = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, asrProvider: value }));
    persist(KEYS.asrProvider, value);
  }, []);

  const setMicDeviceId = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, micDeviceId: value }));
    persist(KEYS.micDeviceId, value);
  }, []);

  const setVolcSettings = useCallback((patch: Partial<VolcSettings>): void => {
    setSettings((prev) => ({ ...prev, ...patch }));
    for (const key of Object.keys(patch) as Array<keyof VolcSettings>) {
      const value = patch[key];
      if (typeof value === 'string') {
        persist(VOLC_FIELD_KEYS[key], value);
      }
    }
  }, []);

  const setOpacityStep = useCallback((value: number): void => {
    const clamped = Math.min(MAX_OPACITY_STEP, Math.max(MIN_OPACITY_STEP, Math.round(value)));
    setSettings((prev) => ({ ...prev, opacityStep: clamped }));
    persist(KEYS.opacity, String(clamped));
  }, []);

  const setAutoGenerate = useCallback((value: boolean): void => {
    setSettings((prev) => ({ ...prev, autoGenerate: value }));
    persist(KEYS.autoGenerate, String(value));
  }, []);

  const setAutoMode = useCallback((value: AutoMode): void => {
    setSettings((prev) => ({ ...prev, autoMode: value }));
    persist(KEYS.autoMode, value);
  }, []);

  const setAutoIntervalSec = useCallback((value: number): void => {
    const clamped = Math.max(MIN_AUTO_INTERVAL_SEC, Math.round(value));
    setSettings((prev) => ({ ...prev, autoIntervalSec: clamped }));
    persist(KEYS.autoIntervalSec, String(clamped));
  }, []);

  // Apply the opacity to the shell whenever it changes. This is the one
  // appearance setting that works in a browser.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell) {
      shell.style.opacity = String(settings.opacityStep / MAX_OPACITY_STEP);
    }
  }, [settings.opacityStep]);

  return {
    settings,
    setAiModel,
    setOutputLanguage,
    setSummaryModel,
    setSummaryPromptMode,
    setSummaryPromptText,
    setAsrProvider,
    setMicDeviceId,
    setVolcSettings,
    setOpacityStep,
    setAutoGenerate,
    setAutoMode,
    setAutoIntervalSec
  };
}
