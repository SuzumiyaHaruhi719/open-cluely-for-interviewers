import { afterEach, describe, expect, it, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TranscriptStream, type TranscriptMessage } from './TranscriptStream';
import type { CopilotResult, TranscriptLanes } from '../lib/useCopilotSocket';

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

  test('passes Chinese output language to the live question card', () => {
    const lastResult: CopilotResult = {
      type: 'result',
      requestId: 'req-1',
      mode: 'expert',
      output: {
        primary_question: '你会如何继续追问？',
        alternative_question: '还有哪些风险？',
        rationale_for_interviewer: '检查候选人是否能解释取舍。',
        anchor_quotes: [],
        expected_evidence_yield: '能看到系统设计深度。',
        iteration_version: '3'
      },
      shouldShowFollowUps: true,
      tokensUsed: { input: 10, output: 5, total: 15 },
      elapsedMs: 600,
      iterationVersion: '3'
    };

    render(
      <TranscriptStream
        transcripts={EMPTY_LANES}
        transcriptMessages={[]}
        lastResult={lastResult}
        progress={null}
        isAnalyzing={false}
        error={null}
        autoScroll={false}
        outputLanguage="zh"
      />
    );

    expect(screen.getByText('为什么这样问')).toBeInTheDocument();
    expect(screen.queryByText('Why ask this')).toBeNull();
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

  it('offline with empty segments: falls back to the room-mic lane (no toggles)', () => {
    const onSetRole = vi.fn();
    render(
      <TranscriptStream
        offline
        speakerSegments={[]}
        onSetSpeakerRole={onSetRole}
        transcripts={{
          mic: { finalText: '房间麦克风文字', partial: '' },
          display: { finalText: '', partial: '' }
        }}
        transcriptMessages={[]}
        lastResult={null}
        progress={null}
        isAnalyzing={false}
        error={null}
        autoScroll={false}
      />
    );
    // Fallback room-mic lane shows the raw text; no role toggles yet.
    expect(screen.getByText('房间麦克风文字')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /候选人/ })).toBeNull();
  });
});

describe('TranscriptStream online iFlytek speaker bubbles', () => {
  it('online (offline=false) WITH speaker segments: renders the labelable bubbles + toggles', () => {
    const onSetRole = vi.fn();
    render(
      <TranscriptStream
        offline={false}
        speakerSegments={[
          { id: 1, speakerId: 1, role: 'unknown', text: '请介绍一下你的项目' },
          { id: 2, speakerId: 2, role: 'unknown', text: '我做了一个推荐系统' }
        ]}
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
    // Both iFlytek-online segments render as bubbles…
    expect(screen.getByText('请介绍一下你的项目')).toBeInTheDocument();
    expect(screen.getByText('我做了一个推荐系统')).toBeInTheDocument();
    // …and EACH bubble offers the 面试官 / 候选人 toggles (2 bubbles × 2 buttons).
    expect(screen.getAllByRole('button', { name: /面试官/ })).toHaveLength(2);
    const candidateButtons = screen.getAllByRole('button', { name: /候选人/ });
    expect(candidateButtons).toHaveLength(2);
    // Tapping 候选人 on speaker 2's bubble labels THAT speaker id.
    fireEvent.click(candidateButtons[1]);
    expect(onSetRole).toHaveBeenCalledWith(2, 'candidate');
  });

  it('online (offline=false) WITHOUT segments (paraformer/volc): renders the two channel lanes, NO toggles', () => {
    const onSetRole = vi.fn();
    render(
      <TranscriptStream
        offline={false}
        speakerSegments={[]}
        onSetSpeakerRole={onSetRole}
        transcripts={{
          mic: { finalText: 'Interviewer line.', partial: '' },
          display: { finalText: 'Candidate line.', partial: '' }
        }}
        transcriptMessages={[]}
        lastResult={null}
        progress={null}
        isAnalyzing={false}
        error={null}
        autoScroll={false}
      />
    );
    // The two fixed online lanes render (candidate = display, interviewer = mic)…
    expect(screen.getByText('Candidate line.')).toBeInTheDocument();
    expect(screen.getByText('Interviewer line.')).toBeInTheDocument();
    // …and there are NO role toggles in pure online mode with a non-diarizing provider.
    expect(screen.queryByRole('button', { name: /候选人/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /面试官/ })).toBeNull();
    expect(onSetRole).not.toHaveBeenCalled();
  });
});
