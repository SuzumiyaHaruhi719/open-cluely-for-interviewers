import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SpotlightTour } from './SpotlightTour';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EMPTY_BOX: Box = { left: 0, top: 0, width: 0, height: 0 };

function domRect(box: Box): DOMRect {
  return {
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box
  } as DOMRect;
}

function setRect(id: string, read: () => Box): void {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing test element #${id}`);
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => domRect(read()));
}

function TourHarness({ onToggleRail, replayToken = 0 }: { onToggleRail: () => void; replayToken?: number }) {
  return (
    <>
      <button id="toggle-rail-btn" onClick={onToggleRail}>Toggle rail</button>
      <button id="btn-new-interview">New interview</button>
      <div id="channel-computer">Computer</div>
      <div id="channel-mic">Mic</div>
      <button id="analyze-btn">Analyze</button>
      <SpotlightTour replayToken={replayToken} />
    </>
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function openTourAndAdvanceToComputerAudio(): Promise<void> {
  await advance(900);
  fireEvent.click(screen.getByRole('button', { name: '开始导览 →' }));
  await advance(800);
  fireEvent.click(screen.getByRole('button', { name: '下一步 →' }));
  await advance(800);
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  document.body.classList.remove('rail-collapsed');
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.body.classList.remove('rail-collapsed');
  delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
});

test('keeps JD selection in New Interview and advances directly to visible interview controls', async () => {
  document.body.classList.add('rail-collapsed');
  const onToggleRail = vi.fn(() => document.body.classList.remove('rail-collapsed'));
  render(<TourHarness onToggleRail={onToggleRail} />);

  setRect('btn-new-interview', () => ({ left: 100, top: 80, width: 140, height: 40 }));
  setRect('channel-computer', () => ({ left: 320, top: 620, width: 180, height: 42 }));

  await advance(900);
  expect(screen.getByText(/职位背景和简历/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始导览 →' }));
  await advance(800);
  expect(screen.getByText(/职位背景/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '下一步 →' }));
  await advance(800);

  expect(onToggleRail).not.toHaveBeenCalled();
  expect(screen.getByText(/② 采集候选人音频/)).toBeInTheDocument();
  expect(document.querySelector<HTMLElement>('.tour-spotlight-ring')?.style.left).toBe('314px');
});

test('centers the current step when its target remains unavailable', async () => {
  const onToggleRail = vi.fn();
  render(<TourHarness onToggleRail={onToggleRail} />);

  setRect('btn-new-interview', () => ({ left: 100, top: 80, width: 140, height: 40 }));
  setRect('channel-computer', () => EMPTY_BOX);

  await openTourAndAdvanceToComputerAudio();

  expect(screen.getByText(/② 采集候选人音频/)).toBeInTheDocument();
  expect(document.querySelector('.tour-spotlight-ring')).toHaveClass('is-hidden');
  expect(document.querySelector('.tour-spotlight-ring')).toHaveAttribute('aria-hidden', 'true');
  expect(document.querySelector<HTMLElement>('.tour-tooltip')?.style.left).toBe('50%');
});

test('keeps the previous spotlight mounted until the next target is ready', async () => {
  const onToggleRail = vi.fn();
  render(<TourHarness onToggleRail={onToggleRail} />);

  setRect('btn-new-interview', () => ({ left: 100, top: 80, width: 140, height: 40 }));
  setRect('channel-computer', () => ({ left: 500, top: 120, width: 260, height: 50 }));

  await advance(900);
  fireEvent.click(screen.getByRole('button', { name: '开始导览 →' }));
  await advance(800);

  const firstRing = document.querySelector<HTMLElement>('.tour-spotlight-ring');
  expect(firstRing?.style.left).toBe('94px');

  fireEvent.click(screen.getByRole('button', { name: '下一步 →' }));

  // Smooth scrolling and rail reveals take time. The current implementation
  // used to unmount the entire tour here, swallowing the CSS transition.
  const ringDuringHandoff = document.querySelector<HTMLElement>('.tour-spotlight-ring');
  expect(ringDuringHandoff).not.toBeNull();
  expect(ringDuringHandoff?.style.left).toBe('94px');
  expect(document.querySelector('.tour-mask')).not.toBeNull();
  expect(document.querySelector('.tour-tooltip')).not.toBeNull();

  await advance(800);
  expect(document.querySelector<HTMLElement>('.tour-spotlight-ring')?.style.left).toBe('494px');
  expect(screen.getByText(/② 采集候选人音频/)).toBeInTheDocument();
});

test('does not horizontally center targets inside the clipped workspace', async () => {
  const onToggleRail = vi.fn();
  render(<TourHarness onToggleRail={onToggleRail} />);

  setRect('btn-new-interview', () => ({ left: 100, top: 80, width: 140, height: 40 }));

  await advance(900);
  fireEvent.click(screen.getByRole('button', { name: '开始导览 →' }));
  await advance(1);

  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest'
  });
});

test('replays immediately when the parent changes replayToken without reloading the page', async () => {
  sessionStorage.setItem('tour-shown-this-session', '1');
  const onToggleRail = vi.fn();
  const { rerender } = render(<TourHarness onToggleRail={onToggleRail} replayToken={0} />);

  await advance(900);
  expect(screen.queryByText('欢迎使用面试官 Copilot')).not.toBeInTheDocument();

  rerender(<TourHarness onToggleRail={onToggleRail} replayToken={1} />);
  await advance(1);

  expect(screen.getByText('欢迎使用面试官 Copilot')).toBeInTheDocument();
});
