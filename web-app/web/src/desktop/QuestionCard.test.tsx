import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { FollowUpOutput, RankedQuestion, TokenUsage } from '@open-cluely/contract';
import { QuestionCard } from './QuestionCard';

const OUTPUT: FollowUpOutput = {
  primary_question: 'How did you choose the shard key?',
  alternative_question: 'What broke first under load?',
  rationale_for_interviewer: 'Probes the depth of the partitioning decision.',
  anchor_quotes: ['consistent hashing'],
  expected_evidence_yield: 'Reveals trade-off reasoning.',
  iteration_version: '3'
};

const TOKENS: TokenUsage = { input: 10, output: 5, total: 15 };

/** Four ranked candidates — [0] is the top pick, [1..3] populate the list. */
const RANKED: RankedQuestion[] = [
  {
    question: 'How did you choose the shard key?',
    score: 27,
    maxScore: 30,
    rubricReason: 'Highest specificity + follow-on potential.',
    rank: 1
  },
  {
    question: 'What happened when a shard got hot?',
    score: 24,
    maxScore: 30,
    rubricReason: 'Good failure-mode probe.',
    rank: 2
  },
  {
    question: 'How did you rebalance after adding nodes?',
    score: 21,
    maxScore: 30,
    rubricReason: 'Tests operational maturity.',
    rank: 3
  },
  {
    question: 'Why not use a managed datastore?',
    score: 18,
    maxScore: 30,
    rubricReason: 'Broad, slightly off the thread.',
    rank: 4
  }
];

afterEach(() => {
  cleanup();
});

describe('QuestionCard ranked candidates', () => {
  test('uses the product icon library instead of a decorative text glyph', () => {
    const { container } = render(
      <QuestionCard output={OUTPUT} mode="expert" tokensUsed={TOKENS} elapsedMs={1200} />
    );

    expect(container.querySelector('[data-icon-library="phosphor"]')).not.toBeNull();
    expect(container.textContent).not.toContain('✦');
  });

  test('renders the primary question with the top-pick score badge', () => {
    render(<QuestionCard output={OUTPUT} mode="expert" tokensUsed={TOKENS} elapsedMs={1200} ranked={RANKED} />);

    // Primary question prominent.
    expect(screen.getByText('How did you choose the shard key?')).toBeInTheDocument();
    // Top pick (27/30) badges the primary.
    const primary = document.querySelector('.question-card__primary');
    expect(primary).not.toBeNull();
    expect(primary?.querySelector('.question-card__score')?.textContent).toBe('27/30');
  });

  test('does not crash when anchor_quotes is missing (regression: white-screen)', () => {
    // A follow-up result whose anchor_quotes is undefined (model omitted it /
    // malformed parse) used to throw "Cannot read properties of undefined
    // (reading 'length')" and white-screen the whole app via the ErrorBoundary.
    const noAnchors = { ...OUTPUT, anchor_quotes: undefined } as unknown as FollowUpOutput;
    expect(() =>
      render(
        <QuestionCard output={noAnchors} mode="expert" tokensUsed={TOKENS} elapsedMs={1200} ranked={RANKED} />
      )
    ).not.toThrow();
    // The card still renders its primary question.
    expect(screen.getByText('How did you choose the shard key?')).toBeInTheDocument();
  });

  test('expandable list shows the other 3 candidates with scores + reasons', () => {
    const { container } = render(
      <QuestionCard output={OUTPUT} mode="expert" tokensUsed={TOKENS} elapsedMs={1200} ranked={RANKED} />
    );

    // The summary advertises the count of the remaining candidates (4 - 1 = 3).
    expect(screen.getByText('更多排序候选 (3)')).toBeInTheDocument();

    const items = container.querySelectorAll('.question-card__ranked-item');
    expect(items).toHaveLength(3);

    // Each non-primary candidate's question, score and reason render.
    expect(screen.getByText('What happened when a shard got hot?')).toBeInTheDocument();
    expect(screen.getByText('How did you rebalance after adding nodes?')).toBeInTheDocument();
    expect(screen.getByText('Why not use a managed datastore?')).toBeInTheDocument();

    const scores = Array.from(
      container.querySelectorAll('.question-card__ranked-item .question-card__score')
    ).map((el) => el.textContent);
    expect(scores).toEqual(['24/30', '21/30', '18/30']);

    expect(screen.getByText('Good failure-mode probe.')).toBeInTheDocument();
    expect(screen.getByText('Tests operational maturity.')).toBeInTheDocument();
  });

  test("trigger badges distinguish auto and manual results", () => {
    const { rerender } = render(
      <QuestionCard output={OUTPUT} mode="expert" tokensUsed={TOKENS} elapsedMs={1200} ranked={RANKED} trigger="auto" />
    );
    expect(screen.getByText('自动')).toBeInTheDocument();

    rerender(
      <QuestionCard output={OUTPUT} mode="expert" tokensUsed={TOKENS} elapsedMs={1200} ranked={RANKED} trigger="manual" />
    );
    expect(screen.queryByText('自动')).toBeNull();
    expect(screen.getByText('手动')).toBeInTheDocument();
  });

  test('localizes card labels when Chinese output is selected', () => {
    render(
      <QuestionCard
        output={OUTPUT}
        mode="expert"
        tokensUsed={TOKENS}
        elapsedMs={1200}
        ranked={RANKED}
        outputLanguage="zh"
      />
    );

    expect(screen.getByLabelText('建议追问')).toBeInTheDocument();
    expect(screen.getByText('AI 追问')).toBeInTheDocument();
    expect(screen.getByText('备选问题')).toBeInTheDocument();
    expect(screen.getByText('为什么这样问')).toBeInTheDocument();
    expect(screen.getByText('预期证据')).toBeInTheDocument();
    expect(screen.queryByText('Why ask this')).toBeNull();
  });

  test('keeps ranked-list chrome Chinese when English output is selected', () => {
    render(
      <QuestionCard
        output={OUTPUT}
        mode="expert"
        tokensUsed={TOKENS}
        elapsedMs={1200}
        ranked={RANKED}
        pickedHint="What happened when a shard got hot?"
        outputLanguage="en"
      />
    );

    expect(screen.getByText('更多排序候选 (3)')).toBeInTheDocument();
    expect(screen.getByText(/已选用：/)).toBeInTheDocument();
    expect(screen.queryByText('More ranked candidates (3)')).toBeNull();
    expect(screen.queryByText(/Selected:/)).toBeNull();
  });

  test('clicking a candidate row calls onPickCandidate with its question', () => {
    const onPickCandidate = vi.fn();
    render(
      <QuestionCard
        output={OUTPUT}
        mode="expert"
        tokensUsed={TOKENS}
        elapsedMs={1200}
        ranked={RANKED}
        onPickCandidate={onPickCandidate}
      />
    );

    fireEvent.click(screen.getByText('What happened when a shard got hot?'));

    expect(onPickCandidate).toHaveBeenCalledTimes(1);
    expect(onPickCandidate).toHaveBeenCalledWith('What happened when a shard got hot?');
  });

  test('with no ranked pool, renders only the primary (no score badge, no list)', () => {
    const { container } = render(
      <QuestionCard output={OUTPUT} mode="fast" tokensUsed={TOKENS} elapsedMs={900} />
    );

    expect(screen.getByText('How did you choose the shard key?')).toBeInTheDocument();
    expect(container.querySelector('.question-card__score')).toBeNull();
    expect(container.querySelector('.question-card__ranked')).toBeNull();
  });

  test('hides token telemetry when the provider did not report usage', () => {
    render(
      <QuestionCard
        output={OUTPUT}
        mode="expert"
        tokensUsed={{ input: 0, output: 0, total: 0 }}
        elapsedMs={900}
      />
    );

    expect(screen.queryByText('0 词元')).toBeNull();
  });
});
