import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMicDevices } from './useMicDevices';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMicDevices', () => {
  test('omits privacy-masked devices whose empty id would duplicate system default', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: '', label: '' },
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Boardroom microphone' },
          { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Speakers' }
        ])
      }
    });

    const { result } = renderHook(() => useMicDevices(true));

    await waitFor(() => {
      expect(result.current.devices).toEqual([
        { deviceId: 'mic-1', label: 'Boardroom microphone' }
      ]);
    });
  });
});
