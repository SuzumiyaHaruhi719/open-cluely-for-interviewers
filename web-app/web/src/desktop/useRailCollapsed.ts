import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'open-cluely.railCollapsed';

function readInitial(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

/**
 * Mirrors the desktop right-rail collapse: toggles `body.rail-collapsed` (the
 * class the copied styles.css animates) and persists the choice to localStorage
 * under `open-cluely.railCollapsed`.
 */
export function useRailCollapsed(): readonly [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(readInitial);

  useEffect(() => {
    document.body.classList.toggle('rail-collapsed', collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch {
      // Private-mode / quota — the body class is what matters for the UI.
    }
    return () => {
      document.body.classList.remove('rail-collapsed');
    };
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  return [collapsed, toggle] as const;
}
