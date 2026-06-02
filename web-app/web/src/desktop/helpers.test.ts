import { describe, expect, test } from 'vitest';
import { formatTimer, recMeta, MODE_META } from './helpers';

describe('formatTimer', () => {
  test('formats sub-minute durations as mm:ss', () => {
    expect(formatTimer(0)).toBe('00:00');
    expect(formatTimer(5_000)).toBe('00:05');
    expect(formatTimer(65_000)).toBe('01:05');
  });

  test('formats hour-plus durations as h:mm:ss', () => {
    expect(formatTimer(3_661_000)).toBe('1:01:01');
  });

  test('clamps negative input to zero', () => {
    expect(formatTimer(-10_000)).toBe('00:00');
  });
});

describe('recMeta', () => {
  test('reports live when a channel is capturing regardless of socket', () => {
    expect(recMeta('open', true)).toEqual({ state: 'live', label: 'Live' });
    expect(recMeta('reconnecting', true)).toEqual({ state: 'live', label: 'Live' });
  });

  test('reports connecting while the socket is opening', () => {
    expect(recMeta('connecting', false)).toEqual({ state: 'connecting', label: 'Connecting' });
    expect(recMeta('reconnecting', false)).toEqual({ state: 'connecting', label: 'Connecting' });
  });

  test('reports idle when open but not capturing', () => {
    expect(recMeta('open', false)).toEqual({ state: 'idle', label: 'Idle' });
    expect(recMeta('closed', false)).toEqual({ state: 'idle', label: 'Idle' });
  });
});

describe('MODE_META', () => {
  test('maps each mode to a data-mode attr matching its key', () => {
    expect(MODE_META.fast.attr).toBe('fast');
    expect(MODE_META.expert.attr).toBe('expert');
    expect(MODE_META.expert2.attr).toBe('expert2');
    expect(MODE_META.customize.attr).toBe('customize');
  });
});
