import { useCallback, useEffect, useState } from 'react';

const KEYS = {
  aiModel: 'open-cluely.aiModel',
  asrProvider: 'open-cluely.asrProvider',
  opacity: 'open-cluely.windowOpacity'
} as const;

export const DEFAULT_AI_MODEL = 'deepseek-v4-pro';
export const DEFAULT_ASR_PROVIDER = 'paraformer';
/** Opacity is a 1..10 step (matching the desktop slider); 10 = fully opaque. */
export const DEFAULT_OPACITY_STEP = 10;
export const MIN_OPACITY_STEP = 1;
export const MAX_OPACITY_STEP = 10;

export interface AppSettings {
  aiModel: string;
  asrProvider: string;
  opacityStep: number;
}

function readString(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }
  return localStorage.getItem(key) ?? fallback;
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

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode / quota — state still lives in memory for this session.
  }
}

export interface UseAppSettings {
  settings: AppSettings;
  setAiModel: (value: string) => void;
  setAsrProvider: (value: string) => void;
  setOpacityStep: (value: number) => void;
}

/**
 * Web-only app settings persisted to localStorage. The AI-model and
 * ASR-provider selects are remembered for UI continuity but do NOT change
 * server behaviour (the deployment is server-driven) — the settings modal notes
 * this. The window-opacity step is applied to `.app-shell` by the Shell, which
 * genuinely works on the web.
 */
export function useAppSettings(): UseAppSettings {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    aiModel: readString(KEYS.aiModel, DEFAULT_AI_MODEL),
    asrProvider: readString(KEYS.asrProvider, DEFAULT_ASR_PROVIDER),
    opacityStep: readOpacityStep()
  }));

  const setAiModel = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, aiModel: value }));
    persist(KEYS.aiModel, value);
  }, []);

  const setAsrProvider = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, asrProvider: value }));
    persist(KEYS.asrProvider, value);
  }, []);

  const setOpacityStep = useCallback((value: number): void => {
    const clamped = Math.min(MAX_OPACITY_STEP, Math.max(MIN_OPACITY_STEP, Math.round(value)));
    setSettings((prev) => ({ ...prev, opacityStep: clamped }));
    persist(KEYS.opacity, String(clamped));
  }, []);

  // Apply the opacity to the shell whenever it changes. This is the one
  // appearance setting that works in a browser.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell) {
      shell.style.opacity = String(settings.opacityStep / MAX_OPACITY_STEP);
    }
  }, [settings.opacityStep]);

  return { settings, setAiModel, setAsrProvider, setOpacityStep };
}
