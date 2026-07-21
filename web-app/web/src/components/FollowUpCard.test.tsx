import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { FollowUpOutput, TokenUsage } from '@open-cluely/contract';
import { FollowUpCard } from './FollowUpCard';

afterEach(cleanup);

const output: FollowUpOutput = {
  primary_question: 'How did you decide on the sharding key?',
  alternative_question: 'What tradeoffs did you weigh against range-based sharding?',
  rationale_for_interviewer: 'Probes whether the choice was reasoned or copied.',
  anchor_quotes: ['we used consistent hashing', 'avoided hot partitions'],
  expected_evidence_yield: 'Reveals depth of distributed-systems understanding.',
  iteration_version: '3'
};

const tokensUsed: TokenUsage = { input: 1200, output: 300, total: 1500 };

describe('FollowUpCard', () => {
  test('renders the primary question, alternative, rationale, and anchor chips', () => {
    // Act
    render(
      <FollowUpCard output={output} mode="expert" tokensUsed={tokensUsed} elapsedMs={2400} />
    );

    // Assert — primary question is shown as the prominent heading.
    expect(
      screen.getByRole('heading', { name: /how did you decide on the sharding key/i })
    ).toBeInTheDocument();

    // Alternative question text.
    expect(screen.getByText(/tradeoffs did you weigh against range-based/i)).toBeInTheDocument();

    // Rationale.
    expect(screen.getByText(/probes whether the choice was reasoned/i)).toBeInTheDocument();

    // Each anchor quote renders as a chip (quoted).
    expect(screen.getByText(/we used consistent hashing/)).toBeInTheDocument();
    expect(screen.getByText(/avoided hot partitions/)).toBeInTheDocument();

    // Footer summary: mode + total tokens + elapsed.
    expect(screen.getByText('专家')).toBeInTheDocument();
    expect(screen.getByText(/1,500 词元/)).toBeInTheDocument();
    expect(screen.getByText(/2\.4 s/)).toBeInTheDocument();
  });

  test('falls back to input+output when total tokens are absent', () => {
    render(
      <FollowUpCard
        output={output}
        mode="fast"
        tokensUsed={{ input: 100, output: 40 }}
        elapsedMs={500}
      />
    );
    expect(screen.getByText(/140 词元/)).toBeInTheDocument();
    expect(screen.getByText(/500 ms/)).toBeInTheDocument();
  });

  test('omits the alternative block when there is no alternative', () => {
    const noAlt: FollowUpOutput = { ...output, alternative_question: '' };
    render(<FollowUpCard output={noAlt} mode="expert" tokensUsed={tokensUsed} elapsedMs={100} />);
    expect(screen.queryByText(/range-based sharding/i)).not.toBeInTheDocument();
  });
});
