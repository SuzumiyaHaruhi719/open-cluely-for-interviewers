import { afterEach, describe, expect, it, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TranscriptStream, type TranscriptMessage } from './TranscriptStream';
import type { TranscriptLanes } from '../lib/useCopilotSocket';

const EMPTY_LANES: TranscriptLanes = {
  mic: { finalText: '', partial: '' },
  display: { finalText: '', partial: '' }
};

function renderStream(
  transcriptMessages: TranscriptMessage[],
  lanes: TranscriptLanes = EMPTY_LANES
) {
  return render(
    <TranscriptStream
      transcripts={lanes}
      transcriptMessages={transcriptMessages}
      lastResult={null}
      progress={null}
      isAnalyzing={false}
      error={null}
      autoScroll={false}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe('TranscriptStream seeded messages', () => {
  test('renders candidate + interviewer messages as colour-coded lanes', () => {
    const messages: TranscriptMessage[] = [
      { role: 'interviewer', text: 'Tell me about a hard bug.' },
      { role: 'candidate', text: 'We had a race condition in the scheduler.' }
    ];

    const { container } = renderStream(messages);

    const lanes = container.querySelectorAll('.chat-message');
    expect(lanes).toHaveLength(2);
    expect(container.querySelector('.lane-interviewer')?.textContent).toContain(
      'Tell me about a hard bug.'
    );
    expect(container.querySelector('.lane-candidate')?.textContent).toContain(
      'We had a race condition in the scheduler.'
    );
  });

  test('renders an ai message as a compact .lane-ai line, NOT the full question card', () => {
    const messages: TranscriptMessage[] = [
      { role: 'candidate', text: 'I sharded by user id.' },
      { role: 'ai', text: 'How did you pick the shard key?' }
    ];

    const { container } = renderStream(messages);

    const ai = container.querySelector('.lane-ai');
    expect(ai).not.toBeNull();
    expect(ai?.textContent).toContain('How did you pick the shard key?');
    // Compact line, not the rich live-result card.
    expect(container.querySelector('.is-question-card')).toBeNull();
  });

  test('seeded messages render before the live transcript lanes', () => {
    const messages: TranscriptMessage[] = [{ role: 'candidate', text: 'Seeded answer.' }];
    const lanes: TranscriptLanes = {
      mic: { finalText: '', partial: '' },
      display: { finalText: 'Live candidate text.', partial: '' }
    };

    const { container } = renderStream(messages, lanes);

    const all = Array.from(container.querySelectorAll('.chat-message')).map((el) => el.textContent);
    expect(all[0]).toContain('Seeded answer.');
    expect(all[1]).toContain('Live candidate text.');
  });

  test('renders nothing (stays :empty-eligible) when there are no messages or live text', () => {
    const { container } = renderStream([]);
    expect(container.querySelectorAll('.chat-message')).toHaveLength(0);
  });
});

describe('TranscriptStream offline speaker bubbles', () => {
  it('offline: renders speaker bubbles and fires the role toggle', () => {
    const onSetRole = vi.fn();
    render(
      <TranscriptStream
        offline
        speakerSegments={[{ id: 1, speakerId: 0, role: 'interviewer', text: '你好' }]}
        onSetSpeakerRole={onSetRole}
        transcripts={EMPTY_LANES}
        transcriptMessages={[]}
        lastResult={null}
        progress={null}
        isAnalyzing={false}
        error={null}
        autoScroll={false}
      />
    );
    expect(screen.getByText('你好')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /候选人/ }));
    expect(onSetRole).toHaveBeenCalledWith(0, 'candidate');
  });
});
