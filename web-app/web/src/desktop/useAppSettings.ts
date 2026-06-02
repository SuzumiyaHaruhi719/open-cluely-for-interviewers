import { useCallback, useEffect, useState } from 'react';

const KEYS = {
  aiModel: 'open-cluely.aiModel',
  asrProvider: 'open-cluely.asrProvider',
  volcAppId: 'open-cluely.volcAppId',
  volcAccessToken: 'open-cluely.volcAccessToken',
  volcResourceId: 'open-cluely.volcResourceId',
  volcModel: 'open-cluely.volcModel',
  opacity: 'open-cluely.windowOpacity',
  autoGenerate: 'open-cluely.autoGenerate'
} as const;

export const DEFAULT_AI_MODEL = 'deepseek-v4-pro';
export const DEFAULT_ASR_PROVIDER = 'paraformer';
/** Autonomous question generation defaults ON (the design's auto-on default). */
export const DEFAULT_AUTO_GENERATE = true;
/** Opacity is a 1..10 step (matching the desktop slider); 10 = fully opaque. */
export const DEFAULT_OPACITY_STEP = 10;
export const MIN_OPACITY_STEP = 1;
export const MAX_OPACITY_STEP = 10;

export interface AppSettings {
  aiModel: string;
  asrProvider: string;
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
}

function readString(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }
  return localStorage.getItem(key) ?? fallback;
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
  setAiModel: (value: string) => void;
  setAsrProvider: (value: string) => void;
  /** Merge-patch the Volc credential fields (persists each touched field). */
  setVolcSettings: (patch: Partial<VolcSettings>) => void;
  setOpacityStep: (value: number) => void;
  /** Toggle autonomous question generation (persisted to localStorage). */
  setAutoGenerate: (value: boolean) => void;
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
 * recognition session. The AI-model select remains UI continuity only (server
 * model selection is server-driven). The window-opacity step is applied to
 * `.app-shell` by the Shell.
 */
export function useAppSettings(): UseAppSettings {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    aiModel: readString(KEYS.aiModel, DEFAULT_AI_MODEL),
    asrProvider: readString(KEYS.asrProvider, DEFAULT_ASR_PROVIDER),
    volcAppId: readString(KEYS.volcAppId, ''),
    volcAccessToken: readString(KEYS.volcAccessToken, ''),
    volcResourceId: readString(KEYS.volcResourceId, ''),
    volcModel: readString(KEYS.volcModel, ''),
    opacityStep: readOpacityStep(),
    autoGenerate: readBool(KEYS.autoGenerate, DEFAULT_AUTO_GENERATE)
  }));

  const setAiModel = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, aiModel: value }));
    persist(KEYS.aiModel, value);
  }, []);

  const setAsrProvider = useCallback((value: string): void => {
    setSettings((prev) => ({ ...prev, asrProvider: value }));
    persist(KEYS.asrProvider, value);
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

  // Apply the opacity to the shell whenever it changes. This is the one
  // appearance setting that works in a browser.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell) {
      shell.style.opacity = String(settings.opacityStep / MAX_OPACITY_STEP);
    }
  }, [settings.opacityStep]);

  return { settings, setAiModel, setAsrProvider, setVolcSettings, setOpacityStep, setAutoGenerate };
}
