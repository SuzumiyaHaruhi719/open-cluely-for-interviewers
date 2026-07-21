import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { AudioLanes } from '../lib/useCopilotSocket';
import { InterviewDock } from './InterviewDock';

const AUDIO: AudioLanes = {
  display: { capturing: false, level: 0, error: null, runtimeState: 'stopped' },
  mic: { capturing: false, level: 0, error: null, runtimeState: 'stopped' }
};

describe('InterviewDock', () => {
  test('keeps both interview audio lanes and one compact note action', () => {
    const onAddNote = vi.fn();
    render(
      <InterviewDock
        audio={AUDIO}
        disabled={false}
        timer="00:00:00"
        onStartAudio={vi.fn()}
        onStopAudio={vi.fn()}
        micDeviceId=""
        onMicDeviceChange={vi.fn()}
        onAddNote={onAddNote}
      />
    );

    expect(document.getElementById('channel-computer')).toBeInTheDocument();
    expect(document.getElementById('channel-mic')).toBeInTheDocument();
    expect(screen.getByText('录音 00:00:00')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('面试备注'), {
      target: { value: '候选人没有给出量化结果' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }));

    expect(onAddNote).toHaveBeenCalledWith('候选人没有给出量化结果');
    expect(screen.getByLabelText('面试备注')).toHaveValue('');
  });

  test('submits a note with Enter but preserves Shift+Enter', () => {
    const onAddNote = vi.fn();
    render(
      <InterviewDock
        audio={AUDIO}
        disabled={false}
        timer="00:00:00"
        onStartAudio={vi.fn()}
        onStopAudio={vi.fn()}
        onAddNote={onAddNote}
      />
    );

    const input = screen.getByLabelText('面试备注');
    fireEvent.change(input, { target: { value: '追问消防演练频率' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onAddNote).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAddNote).toHaveBeenCalledWith('追问消防演练频率');
  });
});
