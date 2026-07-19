import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { useAppSettings } from './useAppSettings';

describe('useAppSettings microphone device', () => {
  beforeEach(() => localStorage.clear());

  test('reads the capture device key and keeps one persisted source of truth', () => {
    localStorage.setItem('mic.inputDeviceId', 'blackhole-2ch');
    const { result } = renderHook(() => useAppSettings());

    expect(result.current.settings.micDeviceId).toBe('blackhole-2ch');

    act(() => result.current.setMicDeviceId('built-in-mic'));

    expect(result.current.settings.micDeviceId).toBe('built-in-mic');
    expect(localStorage.getItem('mic.inputDeviceId')).toBe('built-in-mic');
  });
});
