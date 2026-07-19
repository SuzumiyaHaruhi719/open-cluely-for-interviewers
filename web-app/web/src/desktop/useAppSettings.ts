import { useCallback, useState } from 'react';

const KEYS = {
  asrProvider: 'open-cluely.asrProvider',
  autoGenerate: 'open-cluely.autoGenerate',
  autoMode: 'open-cluely.autoMode',
  autoIntervalSec: 'open-cluely.autoIntervalSec',
  summaryModel: 'open-cluely.summaryModel',
  ttsModel: 'open-cluely.ttsModel',
  micDeviceId: 'mic.inputDeviceId'
} as const;

/** Browser-persisted fields retired from the interviewer product surface. */
const RETIRED_KEYS = [
  'open-cluely.aiModel',
  'open-cluely.outputLanguage',
  'open-cluely.summaryPromptMode',
  'open-cluely.summaryPromptText',
  'open-cluely.volcAppId',
  'open-cluely.volcAccessToken',
  'open-cluely.volcResourceId',
  'open-cluely.volcModel',
  'open-cluely.windowOpacity'
] as const;

/** Only providers verified on the deployment are exposed to interviewers. */
export type UserAsrProvider = 'xfyun' | 'volc' | 'paraformer' | 'sim';
export type SummaryModel = 'deepseek-v4-pro' | 'deepseek-v4-flash';
export type QwenTtsModel = 'qwen-audio-3.0-tts-plus' | 'qwen-audio-3.0-tts-flash';
export type AutoMode = 'agent' | 'interval';

export const DEFAULT_ASR_PROVIDER: UserAsrProvider = 'xfyun';
export const DEFAULT_SUMMARY_MODEL: SummaryModel = 'deepseek-v4-pro';
export const DEFAULT_TTS_MODEL: QwenTtsModel = 'qwen-audio-3.0-tts-plus';
export const DEFAULT_AUTO_GENERATE = true;
export const DEFAULT_AUTO_MODE: AutoMode = 'agent';
export const DEFAULT_AUTO_INTERVAL_SEC = 30;
export const MIN_AUTO_INTERVAL_SEC = 5;
export const MAX_AUTO_INTERVAL_SEC = 300;

const USER_ASR_PROVIDERS: ReadonlySet<string> = new Set(['xfyun', 'volc', 'paraformer']);
const SUMMARY_MODELS: ReadonlySet<string> = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash'
]);
const QWEN_TTS_MODELS: ReadonlySet<string> = new Set([
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.0-tts-flash'
]);

export interface AppSettings {
  /** Recognition provider used for the next capture/reconnect. */
  asrProvider: UserAsrProvider;
  /** Qwen voice used when the interviewer explicitly reads a generated question. */
  ttsModel: QwenTtsModel;
  /** Shared room-microphone device used by Settings, Composer, and audio capture. */
  micDeviceId: string;
  /** Autonomous context-driven question generation. */
  autoGenerate: boolean;
  /** AI evidence monitor or a fixed wall-clock interval. */
  autoMode: AutoMode;
  /** Fixed-interval cadence in seconds; ignored when autoMode is `agent`. */
  autoIntervalSec: number;
  /** Post-interview evaluation model; realtime Expert remains fixed separately. */
  summaryModel: SummaryModel;
}

export interface UseAppSettings {
  settings: AppSettings;
  setAsrProvider: (value: UserAsrProvider) => void;
  setTtsModel: (value: QwenTtsModel) => void;
  setMicDeviceId: (value: string) => void;
  setAutoGenerate: (value: boolean) => void;
  setAutoMode: (value: AutoMode) => void;
  setAutoIntervalSec: (value: number) => void;
  setSummaryModel: (value: SummaryModel) => void;
}

function readString(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function readAsrProvider(): UserAsrProvider {
  const value = readString(KEYS.asrProvider, DEFAULT_ASR_PROVIDER);
  return USER_ASR_PROVIDERS.has(value) ? (value as UserAsrProvider) : DEFAULT_ASR_PROVIDER;
}

function readSummaryModel(): SummaryModel {
  const value = readString(KEYS.summaryModel, DEFAULT_SUMMARY_MODEL);
  return SUMMARY_MODELS.has(value) ? (value as SummaryModel) : DEFAULT_SUMMARY_MODEL;
}

function readTtsModel(): QwenTtsModel {
  const value = readString(KEYS.ttsModel, DEFAULT_TTS_MODEL);
  return QWEN_TTS_MODELS.has(value) ? (value as QwenTtsModel) : DEFAULT_TTS_MODEL;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function clampInterval(value: number): number {
  const finite = Number.isFinite(value) ? Math.round(value) : DEFAULT_AUTO_INTERVAL_SEC;
  return Math.min(MAX_AUTO_INTERVAL_SEC, Math.max(MIN_AUTO_INTERVAL_SEC, finite));
}

function readInterval(): number {
  const raw = readString(KEYS.autoIntervalSec, String(DEFAULT_AUTO_INTERVAL_SEC));
  return clampInterval(Number(raw));
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode/quota failure only affects persistence; in-memory state remains valid.
  }
}

function purgeRetiredSettings(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of RETIRED_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // A locked-down storage implementation must not prevent Settings from loading.
    }
  }
}

/** Essential interviewer preferences; product policy and credentials stay server-owned. */
export function useAppSettings(): UseAppSettings {
  const [settings, setSettings] = useState<AppSettings>(() => {
    purgeRetiredSettings();
    return {
      asrProvider: readAsrProvider(),
      ttsModel: readTtsModel(),
      micDeviceId: readString(KEYS.micDeviceId, ''),
      autoGenerate: readBool(KEYS.autoGenerate, DEFAULT_AUTO_GENERATE),
      autoMode: readString(KEYS.autoMode, DEFAULT_AUTO_MODE) === 'interval' ? 'interval' : 'agent',
      autoIntervalSec: readInterval(),
      summaryModel: readSummaryModel()
    };
  });

  const setAsrProvider = useCallback((value: UserAsrProvider): void => {
    // `sim` is an internal deterministic harness reached only by automated tests;
    // it is intentionally absent from Settings and is never persisted.
    if (value === 'sim') {
      setSettings((prev) => ({ ...prev, asrProvider: value }));
      return;
    }
    const normalized = USER_ASR_PROVIDERS.has(value) ? value : DEFAULT_ASR_PROVIDER;
    setSettings((prev) => ({ ...prev, asrProvider: normalized }));
    persist(KEYS.asrProvider, normalized);
  }, []);

  const setMicDeviceId = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, micDeviceId: value }));
    persist(KEYS.micDeviceId, value);
  }, []);

  const setTtsModel = useCallback((value: QwenTtsModel): void => {
    const normalized = QWEN_TTS_MODELS.has(value) ? value : DEFAULT_TTS_MODEL;
    setSettings((prev) => ({ ...prev, ttsModel: normalized }));
    persist(KEYS.ttsModel, normalized);
  }, []);

  const setAutoGenerate = useCallback((value: boolean): void => {
    setSettings((prev) => ({ ...prev, autoGenerate: value }));
    persist(KEYS.autoGenerate, String(value));
  }, []);

  const setAutoMode = useCallback((value: AutoMode): void => {
    const normalized: AutoMode = value === 'interval' ? 'interval' : 'agent';
    setSettings((prev) => ({ ...prev, autoMode: normalized }));
    persist(KEYS.autoMode, normalized);
  }, []);

  const setAutoIntervalSec = useCallback((value: number): void => {
    const normalized = clampInterval(value);
    setSettings((prev) => ({ ...prev, autoIntervalSec: normalized }));
    persist(KEYS.autoIntervalSec, String(normalized));
  }, []);

  const setSummaryModel = useCallback((value: SummaryModel): void => {
    const normalized = SUMMARY_MODELS.has(value) ? value : DEFAULT_SUMMARY_MODEL;
    setSettings((prev) => ({ ...prev, summaryModel: normalized }));
    persist(KEYS.summaryModel, normalized);
  }, []);

  return {
    settings,
    setAsrProvider,
    setTtsModel,
    setMicDeviceId,
    setAutoGenerate,
    setAutoMode,
    setAutoIntervalSec,
    setSummaryModel
  };
}
