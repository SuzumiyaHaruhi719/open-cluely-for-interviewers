import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { AudioLanes, TranscriptLanes } from '../lib/useCopilotSocket';

// Mock the capture lib so the display toggle is "supported" in jsdom (which has
// no getDisplayMedia) — the panel only imports supportsDisplayAudio from here.
vi.mock('../lib/audioCapture', () => ({
  supportsDisplayAudio: () => true
}));

import { LiveAudioPanel } from './LiveAudioPanel';

afterEach(cleanup);

const IDLE: AudioLanes = {
  mic: { capturing: false, level: 0, error: null },
  display: { capturing: false, level: 0, error: null }
};

const EMPTY_TRANSCRIPTS: TranscriptLanes = {
  mic: { finalText: '', partial: '' },
  display: { finalText: '', partial: '' }
};

function renderPanel(overrides: Partial<Parameters<typeof LiveAudioPanel>[0]> = {}) {
  const onStart = vi.fn();
  const onStop = vi.fn();
  render(
    <LiveAudioPanel
      audio={IDLE}
      transcripts={EMPTY_TRANSCRIPTS}
      disabled={false}
      onStart={onStart}
      onStop={onStop}
      {...overrides}
    />
  );
  return { onStart, onStop };
}

describe('LiveAudioPanel', () => {
  test('renders both capture toggles and the two transcript lanes', () => {
    renderPanel();
    expect(screen.getByText('候选人音频')).toBeInTheDocument();
    expect(screen.getByText('我的麦克风')).toBeInTheDocument();
    expect(screen.getByText('候选人')).toBeInTheDocument();
    expect(screen.getByText('面试官（你）')).toBeInTheDocument();
    // Two idle sources => two Start buttons.
    expect(screen.getAllByRole('button', { name: '开始' })).toHaveLength(2);
  });

  test('clicking Start on the interviewee source calls onStart("display")', () => {
    const { onStart } = renderPanel();
    // The first source rendered is the interviewee (display) lane.
    const startButtons = screen.getAllByRole('button', { name: '开始' });
    fireEvent.click(startButtons[0]);
    expect(onStart).toHaveBeenCalledWith('display');
  });

  test('clicking Start on the mic source calls onStart("mic")', () => {
    const { onStart } = renderPanel();
    const startButtons = screen.getAllByRole('button', { name: '开始' });
    fireEvent.click(startButtons[1]);
    expect(onStart).toHaveBeenCalledWith('mic');
  });

  test('a capturing source shows Stop and calls onStop when clicked', () => {
    const { onStop } = renderPanel({
      audio: { ...IDLE, mic: { capturing: true, level: 0.4, error: null } }
    });
    const stop = screen.getByRole('button', { name: '停止' });
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledWith('mic');
  });

  test('renders final + partial transcript text in the interviewee lane', () => {
    renderPanel({
      transcripts: {
        ...EMPTY_TRANSCRIPTS,
        display: { finalText: 'I built a cache', partial: 'to cut latency' }
      }
    });
    expect(screen.getByText(/I built a cache/)).toBeInTheDocument();
    expect(screen.getByText(/to cut latency/)).toBeInTheDocument();
  });

  test('disables the toggles when the socket is not ready', () => {
    renderPanel({ disabled: true });
    for (const btn of screen.getAllByRole('button', { name: '开始' })) {
      expect(btn).toBeDisabled();
    }
  });
});
