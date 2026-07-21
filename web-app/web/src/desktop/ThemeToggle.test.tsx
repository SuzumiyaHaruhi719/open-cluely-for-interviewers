import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  localStorage.removeItem('glp-theme');
  document.documentElement.dataset.theme = 'dark';
});

test('is icon-only and swaps its accessible action with the active GLP theme', () => {
  localStorage.setItem('glp-theme', 'dark');
  render(<ThemeToggle />);

  const toLight = screen.getByRole('button', { name: '切换到浅色主题' });
  expect(toLight).toHaveTextContent('');
  fireEvent.click(toLight);

  expect(document.documentElement.dataset.theme).toBe('light');
  expect(screen.getByRole('button', { name: '切换到深色主题' })).toHaveTextContent('');
});
