import { afterEach, describe, expect, it, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TranscriptStream, type TranscriptMessage } from './TranscriptStream';
import type {
  CopilotQuestionEvent,
  CopilotResult,
  TranscriptLanes
} from '../lib/useCopilotSocket';

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
  vi.useRealTimers();
});

test('changing the fixed cadence restarts its visible countdown immediately', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
  const props = {
    transcripts: EMPTY_LANES,
    transcriptMessages: [],
    lastResult: null,
    progress: null,
    isAnalyzing: false,
    error: null,
    autoScroll: false,
    autoMode: 'interval' as const,
    autoGenerate: true,
    capturing: true,
    lastAutoFireAt: null
  };
  const { rerender } = render(<TranscriptStream {...props} autoIntervalMs={30_000} />);
  expect(screen.getByText('下次自动追问 ~30s')).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(12_000));
  expect(screen.getByText('下次自动追问 ~18s')).toBeInTheDocument();

  rerender(<TranscriptStream {...props} autoIntervalMs={15_000} />);
  expect(screen.getByText('下次自动追问 ~15s')).toBeInTheDocument();
});

test('does not promise an interval follow-up while no ASR session is live', () => {
  render(
    <TranscriptStream
      transcripts={EMPTY_LANES}
      transcriptMessages={[]}
      lastResult={null}
      progress={null}
      isAnalyzing={false}
      error={null}
      autoScroll={false}
      autoMode="interval"
      autoIntervalMs={15_000}
      autoGenerate
      capturing={false}
    />
  );

  expect(screen.queryByText(/下次自动追问/)).not.toBeInTheDocument();
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
        lastResult={null}
        questionEvents={[{ id: 'req-1', anchorSeq: null, result: lastResult }]}
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
  it('inserts every AI question immediately after its anchored candidate segment', () => {
    const makeResult = (requestId: string, question: string): CopilotResult => ({
      type: 'result',
      requestId,
      mode: 'expert',
      output: {
        primary_question: question,
        alternative_question: '',
        rationale_for_interviewer: '验证回答中的证据缺口。',
        anchor_quotes: [],
        expected_evidence_yield: '获得可验证结果。',
        iteration_version: '3'
      },
      shouldShowFollowUps: true,
      tokensUsed: { input: 10, output: 5, total: 15 },
      elapsedMs: 800,
      iterationVersion: '3',
      trigger: 'auto'
    });
    const questionEvents: CopilotQuestionEvent[] = [
      { id: 'auto-1', anchorSeq: 3, result: makeResult('auto-1', '第一个追问？') },
      { id: 'auto-2', anchorSeq: 3, result: makeResult('auto-2', '第二个追问？') }
    ];

    const { container } = render(
      <TranscriptStream
        offline
        speakerSegments={[
          { id: 3, speakerId: 7, role: 'candidate', text: '候选人证据' },
          { id: 4, speakerId: 9, role: 'interviewer', text: '后续面试官发言' }
        ]}
        questionEvents={questionEvents}
        transcripts={EMPTY_LANES}
        transcriptMessages={[]}
        lastResult={makeResult('latest', '不应渲染的底部卡片')}
        progress={null}
        isAnalyzing={false}
        error={null}
        autoScroll={false}
      />
    );

    const timeline = Array.from(container.querySelectorAll('.chat-message')).map(
      (node) => node.textContent ?? ''
    );
    expect(timeline[0]).toContain('候选人证据');
    expect(timeline[1]).toContain('第一个追问？');
    expect(timeline[2]).toContain('第二个追问？');
    expect(timeline[3]).toContain('后续面试官发言');
    expect(container).not.toHaveTextContent('不应渲染的底部卡片');
  });

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

  it('keeps the live partial visible while finalized speaker bubbles are already present', () => {
    render(
      <TranscriptStream
        offline={false}
        speakerSegments={[
          { id: 1, speakerId: 1, role: 'interviewer', text: '请介绍一下你的项目' }
        ]}
        transcripts={{
          mic: { finalText: '请介绍一下你的项目', partial: '' },
          display: { finalText: '', partial: '我负责的是推荐系统实时特征' }
        }}
        transcriptMessages={[]}
        lastResult={null}
        progress={null}
        isAnalyzing={false}
        error={null}
        autoScroll={false}
      />
    );

    expect(screen.getByText('请介绍一下你的项目')).toBeInTheDocument();
    expect(screen.getByText('我负责的是推荐系统实时特征')).toBeInTheDocument();
    expect(screen.getByText('输入中…')).toBeInTheDocument();
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
