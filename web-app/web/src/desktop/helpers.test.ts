import { describe, expect, test } from 'vitest';
import { formatTimer, recMeta, MODE_META, formatRelativeTime } from './helpers';

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
    expect(recMeta('open', true)).toEqual({ state: 'live', label: '实时' });
    expect(recMeta('reconnecting', true)).toEqual({ state: 'live', label: '实时' });
  });

  test('reports connecting while the socket is opening', () => {
    expect(recMeta('connecting', false)).toEqual({ state: 'connecting', label: '连接中' });
    expect(recMeta('reconnecting', false)).toEqual({ state: 'connecting', label: '连接中' });
  });

  test('reports idle when open but not capturing', () => {
    expect(recMeta('open', false)).toEqual({ state: 'idle', label: '空闲' });
    expect(recMeta('closed', false)).toEqual({ state: 'idle', label: '空闲' });
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

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000;

  test('reports "just now" under a minute', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
  });

  test('reports minutes, hours, and days ago within a week', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe('3 小时前');
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe('2 天前');
  });

  test('falls back to an absolute date past a week', () => {
    const result = formatRelativeTime(now - 10 * 24 * 60 * 60_000, now);
    expect(result).not.toMatch(/前|刚刚/);
  });

  test('clamps future timestamps to "just now"', () => {
    expect(formatRelativeTime(now + 10_000, now)).toBe('刚刚');
  });
});
