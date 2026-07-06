import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ProgressCard } from './ProgressCard';
import type { CopilotProgress } from '../lib/useCopilotSocket';

function progress(overrides: Partial<CopilotProgress> = {}): CopilotProgress {
  return {
    type: 'progress',
    requestId: 'req-1',
    phase: 'answer',
    index: 0,
    total: 5,
    status: 'start',
    ...overrides
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ProgressCard', () => {
  test('shows the friendly Chinese label (not the raw block key) for a known phase', () => {
    const { container } = render(<ProgressCard progress={progress({ phase: 'gaps' })} />);
    const label = container.querySelector('.chat-progress__label');
    expect(label?.textContent).toContain('定位待追问的薄弱点');
    // The raw internal key must not leak to the interviewer.
    expect(label?.textContent).not.toContain('gaps');
  });

  test('falls back to the raw phase for an unknown key', () => {
    const { container } = render(<ProgressCard progress={progress({ phase: 'mystery' })} />);
    expect(container.querySelector('.chat-progress__label')?.textContent).toContain('mystery');
  });

  test('appends the (completed/total) phase count when a total is known', () => {
    const { container } = render(
      <ProgressCard progress={progress({ phase: 'rank', index: 3, total: 5, status: 'start' })} />
    );
    expect(container.querySelector('.chat-progress__label')?.textContent).toContain('(3/5)');
  });

  test('renders a live elapsed timer that advances on each tick', () => {
    const { container } = render(<ProgressCard progress={progress()} />);
    const timer = container.querySelector('.chat-progress__timer');
    expect(timer).not.toBeNull();
    // Starts sub-second (ms formatting).
    expect(timer?.textContent).toMatch(/ms$/);

    // Advance past a second → flips to "X.X s".
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(container.querySelector('.chat-progress__timer')?.textContent).toMatch(/^1\.\d s$/);
  });

  test('renders the token count only when tokens > 0', () => {
    const { container, rerender } = render(<ProgressCard progress={progress()} tokens={0} />);
    expect(container.querySelector('.chat-progress__tokens')).toBeNull();

    rerender(<ProgressCard progress={progress()} tokens={1234} />);
    const tokens = container.querySelector('.chat-progress__tokens');
    expect(tokens?.textContent).toBe('1,234 令牌');
  });

  test('uses the indeterminate variant + fallback label before any phase total is known', () => {
    const { container } = render(<ProgressCard progress={null} />);
    const card = container.querySelector('.chat-progress-card');
    expect(card?.className).toContain('is-indeterminate');
    expect(container.querySelector('.chat-progress__label')?.textContent).toContain(
      '正在分析回答…'
    );
  });
});
