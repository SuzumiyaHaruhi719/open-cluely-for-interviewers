import { describe, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { DifficultyBadge } from './DifficultyBadge';

afterEach(cleanup);

describe('DifficultyBadge', () => {
  test.each([
    [0, '未标注'],
    [1, '简单'],
    [2, '中等'],
    [3, '困难']
  ])('maps difficulty %i to label "%s"', (difficulty, label) => {
    // Act
    render(<DifficultyBadge difficulty={difficulty} />);

    // Assert
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  test('treats out-of-range difficulty as 未标注', () => {
    render(<DifficultyBadge difficulty={99} />);
    expect(screen.getByText('未标注')).toBeInTheDocument();
  });
});
