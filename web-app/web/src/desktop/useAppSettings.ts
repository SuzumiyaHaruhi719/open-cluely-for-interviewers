import { useCallback, useState } from 'react';

const KEYS = {
  summaryModel: 'open-cluely.summaryModel',
  micDeviceId: 'mic.inputDeviceId'
} as const;

/** Browser-persisted fields retired from the interviewer product surface. */
const RETIRED_KEYS = [
  'open-cluely.aiModel',
  'open-cluely.asrProvider',
  'open-cluely.autoGenerate',
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

export type SummaryModel = 'deepseek-v4-pro' | 'deepseek-v4-flash';
/** Backward-compatible rendering type; the product always configures `agent`. */
export type AutoMode = 'agent' | 'interval';

export const DEFAULT_SUMMARY_MODEL: SummaryModel = 'deepseek-v4-pro';

const SUMMARY_MODELS: ReadonlySet<string> = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash'
]);

export interface AppSettings {
  /** Shared room-microphone device used by Settings, Composer, and audio capture. */
  micDeviceId: string;
  /** Post-interview evaluation model; realtime Expert remains fixed separately. */
  summaryModel: SummaryModel;
}

export interface UseAppSettings {
  settings: AppSettings;
  setMicDeviceId: (value: string) => void;
  setSummaryModel: (value: SummaryModel) => void;
}

function readString(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function readSummaryModel(): SummaryModel {
  const value = readString(KEYS.summaryModel, DEFAULT_SUMMARY_MODEL);
  return SUMMARY_MODELS.has(value) ? (value as SummaryModel) : DEFAULT_SUMMARY_MODEL;
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
      micDeviceId: readString(KEYS.micDeviceId, ''),
      summaryModel: readSummaryModel()
    };
  });

  const setMicDeviceId = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, micDeviceId: value }));
    persist(KEYS.micDeviceId, value);
  }, []);

  const setSummaryModel = useCallback((value: SummaryModel): void => {
    const normalized = SUMMARY_MODELS.has(value) ? value : DEFAULT_SUMMARY_MODEL;
    setSettings((prev) => ({ ...prev, summaryModel: normalized }));
    persist(KEYS.summaryModel, normalized);
  }, []);

  return {
    settings,
    setMicDeviceId,
    setSummaryModel
  };
}
