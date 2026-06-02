import { describe, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { DifficultyBadge } from './DifficultyBadge';

afterEach(cleanup);

describe('DifficultyBadge', () => {
  test.each([
    [0, 'Unspecified'],
    [1, 'Easy'],
    [2, 'Medium'],
    [3, 'Hard']
  ])('maps difficulty %i to label "%s"', (difficulty, label) => {
    // Act
    render(<DifficultyBadge difficulty={difficulty} />);

    // Assert
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  test('treats out-of-range difficulty as Unspecified', () => {
    render(<DifficultyBadge difficulty={99} />);
    expect(screen.getByText('Unspecified')).toBeInTheDocument();
  });
});
