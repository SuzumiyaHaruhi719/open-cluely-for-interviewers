import { useCallback, useEffect, useState } from 'react';

export interface MicDevice {
  deviceId: string;
  label: string;
}

/**
 * Enumerates `audioinput` devices via `navigator.mediaDevices.enumerateDevices`
 * for the settings mic-device select. Labels are only populated after the user
 * has granted microphone permission once (a browser privacy rule); until then
 * devices appear with generic fallbacks. Re-enumerates on `devicechange`.
 */
export function useMicDevices(enabled: boolean): { devices: MicDevice[]; refresh: () => void } {
  const [devices, setDevices] = useState<MicDevice[]>([]);

  const refresh = useCallback((): void => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.enumerateDevices !== 'function') {
      setDevices([]);
      return;
    }
    void md
      .enumerateDevices()
      .then((list) => {
        const mics = list
          // Browsers hide device ids before permission. Rendering those entries
          // creates duplicate "system default" values that cannot be selected.
          .filter((d) => d.kind === 'audioinput' && d.deviceId.trim().length > 0)
          .map((d, index) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${index + 1}`
          }));
        setDevices(mics);
      })
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    refresh();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.addEventListener !== 'function') {
      return;
    }
    md.addEventListener('devicechange', refresh);
    return () => md.removeEventListener('devicechange', refresh);
  }, [enabled, refresh]);

  return { devices, refresh };
}
