import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_SUMMARY_MODEL,
  useAppSettings
} from './useAppSettings';

describe('useAppSettings persisted controls', () => {
  beforeEach(() => localStorage.clear());

  test('reads the capture device key and keeps one persisted source of truth', () => {
    localStorage.setItem('mic.inputDeviceId', 'blackhole-2ch');
    const { result } = renderHook(() => useAppSettings());

    expect(result.current.settings.micDeviceId).toBe('blackhole-2ch');

    act(() => result.current.setMicDeviceId('built-in-mic'));

    expect(result.current.settings.micDeviceId).toBe('built-in-mic');
    expect(localStorage.getItem('mic.inputDeviceId')).toBe('built-in-mic');
  });

  test('purges retired provider and Auto choices while validating the evaluation model', () => {
    localStorage.setItem('open-cluely.asrProvider', 'xfyun');
    localStorage.setItem('open-cluely.autoGenerate', 'false');
    localStorage.setItem('open-cluely.summaryModel', 'retired-model');
    localStorage.setItem('open-cluely.ttsModel', 'retired-tts');
    localStorage.setItem('open-cluely.autoMode', 'interval');
    localStorage.setItem('open-cluely.autoIntervalSec', '2');
    const { result } = renderHook(() => useAppSettings());

    expect(result.current.settings.summaryModel).toBe(DEFAULT_SUMMARY_MODEL);
    expect(localStorage.getItem('open-cluely.asrProvider')).toBeNull();
    expect(localStorage.getItem('open-cluely.autoGenerate')).toBeNull();
    expect(localStorage.getItem('open-cluely.ttsModel')).toBeNull();
    expect(localStorage.getItem('open-cluely.autoMode')).toBeNull();
    expect(localStorage.getItem('open-cluely.autoIntervalSec')).toBeNull();
    expect(result.current.settings).not.toHaveProperty('autoMode');
    expect(result.current.settings).not.toHaveProperty('autoIntervalSec');
    expect(result.current.settings).not.toHaveProperty('asrProvider');
    expect(result.current.settings).not.toHaveProperty('autoGenerate');
    expect(result.current.settings).not.toHaveProperty('ttsModel');
    expect(result.current).not.toHaveProperty('setAsrProvider');
    expect(result.current).not.toHaveProperty('setAutoGenerate');
    expect(result.current).not.toHaveProperty('setTtsModel');
  });

  test('keeps a valid evaluation model selection', () => {
    localStorage.setItem('open-cluely.summaryModel', 'deepseek-v4-flash');
    const { result } = renderHook(() => useAppSettings());

    expect(result.current.settings.summaryModel).toBe('deepseek-v4-flash');
  });

  test('persists every retained setting through its single normalized setter', () => {
    const { result } = renderHook(() => useAppSettings());

    act(() => {
      result.current.setMicDeviceId('room-mic');
      result.current.setSummaryModel('deepseek-v4-flash');
    });

    expect(result.current.settings).toMatchObject({
      micDeviceId: 'room-mic',
      summaryModel: 'deepseek-v4-flash'
    });
    expect(localStorage.getItem('mic.inputDeviceId')).toBe('room-mic');
    expect(localStorage.getItem('open-cluely.summaryModel')).toBe('deepseek-v4-flash');
  });

  test('does not expose language, secrets, prompts, mode, or appearance state', () => {
    localStorage.setItem('open-cluely.volcAppId', 'legacy-app-id');
    localStorage.setItem('open-cluely.volcAccessToken', 'legacy-token');
    localStorage.setItem('open-cluely.summaryPromptText', 'legacy prompt');
    const { result } = renderHook(() => useAppSettings());

    expect(localStorage.getItem('open-cluely.volcAppId')).toBeNull();
    expect(localStorage.getItem('open-cluely.volcAccessToken')).toBeNull();
    expect(localStorage.getItem('open-cluely.summaryPromptText')).toBeNull();
    expect(result.current.settings).not.toHaveProperty('aiModel');
    expect(result.current.settings).not.toHaveProperty('outputLanguage');
    expect(result.current.settings).not.toHaveProperty('summaryPromptMode');
    expect(result.current.settings).not.toHaveProperty('summaryPromptText');
    expect(result.current.settings).not.toHaveProperty('volcAppId');
    expect(result.current.settings).not.toHaveProperty('volcAccessToken');
    expect(result.current.settings).not.toHaveProperty('ttsModel');
    expect(result.current.settings).not.toHaveProperty('opacityStep');
    expect(result.current).not.toHaveProperty('setOutputLanguage');
    expect(result.current).not.toHaveProperty('setVolcSettings');
    expect(result.current).not.toHaveProperty('setTtsModel');
    expect(result.current).not.toHaveProperty('setOpacityStep');
  });
});
