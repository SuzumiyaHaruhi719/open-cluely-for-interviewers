import { useCallback, useEffect, useState } from 'react';

/** The two themes the GLP foundation supports. */
export type Theme = 'light' | 'dark';

/** localStorage key the persisted theme choice lives under. */
export const THEME_STORAGE_KEY = 'glp-theme';

/**
 * Resolve the initial theme. Order of precedence:
 *   1. A previously persisted choice in localStorage (`glp-theme`).
 *   2. Default to `'dark'` — the app currently ships dark. We intentionally do
 *      NOT auto-follow prefers-color-scheme so the experience is stable; the
 *      media query is only consulted if there is no stored preference AND no
 *      sensible default could apply (kept here as a documented fallback).
 */
export function readInitialTheme(): Theme {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  }
  // No stored preference: default to dark (the app's current look).
  return 'dark';
}

/**
 * Apply a theme to the document by setting `data-theme` on <html>, which is the
 * selector theme.css overrides under (`html[data-theme="dark"]`). Light needs no
 * special selector but we set the attribute for both so the value is always
 * explicit and inspectable.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

/**
 * React hook owning the active GLP theme. Reads the persisted choice on mount,
 * applies it to <html>, and persists every change back to localStorage.
 *
 * Returns the current `theme`, a `toggle()` that flips light<->dark, and a
 * `setTheme()` for explicit control.
 */
export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Keep <html data-theme> and localStorage in sync with state.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Private-mode / quota — the data-theme attribute is what drives the UI.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle, setTheme };
}
