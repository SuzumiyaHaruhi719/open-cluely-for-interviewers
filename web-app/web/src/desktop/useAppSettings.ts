import { useCallback, useState } from 'react';

const KEYS = {
  asrProvider: 'open-cluely.asrProvider',
  autoGenerate: 'open-cluely.autoGenerate',
  summaryModel: 'open-cluely.summaryModel',
  micDeviceId: 'mic.inputDeviceId'
} as const;

/** Browser-persisted fields retired from the interviewer product surface. */
const RETIRED_KEYS = [
  'open-cluely.aiModel',
  'open-cluely.outputLanguage',
  'open-cluely.autoMode',
  'open-cluely.autoIntervalSec',
  'open-cluely.summaryPromptMode',
  'open-cluely.summaryPromptText',
  'open-cluely.volcAppId',
  'open-cluely.volcAccessToken',
  'open-cluely.volcResourceId',
  'open-cluely.volcModel',
  'open-cluely.ttsModel',
  'open-cluely.windowOpacity'
] as const;

/** Only providers verified on the deployment are exposed to interviewers. */
export type UserAsrProvider = 'xfyun' | 'volc' | 'paraformer' | 'sim';
export type SummaryModel = 'deepseek-v4-pro' | 'deepseek-v4-flash';
/** Backward-compatible rendering type; the product always configures `agent`. */
export type AutoMode = 'agent' | 'interval';

export const DEFAULT_ASR_PROVIDER: UserAsrProvider = 'xfyun';
export const DEFAULT_SUMMARY_MODEL: SummaryModel = 'deepseek-v4-pro';
export const DEFAULT_AUTO_GENERATE = true;

const USER_ASR_PROVIDERS: ReadonlySet<string> = new Set(['xfyun', 'volc', 'paraformer']);
const SUMMARY_MODELS: ReadonlySet<string> = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash'
]);

export interface AppSettings {
  /** Recognition provider used for the next capture/reconnect. */
  asrProvider: UserAsrProvider;
  /** Shared room-microphone device used by Settings, Composer, and audio capture. */
  micDeviceId: string;
  /** Autonomous context-driven question generation. */
  autoGenerate: boolean;
  /** Post-interview evaluation model; realtime Expert remains fixed separately. */
  summaryModel: SummaryModel;
}

export interface UseAppSettings {
  settings: AppSettings;
  setAsrProvider: (value: UserAsrProvider) => void;
  setMicDeviceId: (value: string) => void;
  setAutoGenerate: (value: boolean) => void;
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

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
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
      micDeviceId: readString(KEYS.micDeviceId, ''),
      autoGenerate: readBool(KEYS.autoGenerate, DEFAULT_AUTO_GENERATE),
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

  const setAutoGenerate = useCallback((value: boolean): void => {
    setSettings((prev) => ({ ...prev, autoGenerate: value }));
    persist(KEYS.autoGenerate, String(value));
  }, []);

  const setSummaryModel = useCallback((value: SummaryModel): void => {
    const normalized = SUMMARY_MODELS.has(value) ? value : DEFAULT_SUMMARY_MODEL;
    setSettings((prev) => ({ ...prev, summaryModel: normalized }));
    persist(KEYS.summaryModel, normalized);
  }, []);

  return {
    settings,
    setAsrProvider,
    setMicDeviceId,
    setAutoGenerate,
    setSummaryModel
  };
}
