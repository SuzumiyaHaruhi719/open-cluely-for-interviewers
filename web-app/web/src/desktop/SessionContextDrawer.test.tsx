import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SessionContextDrawer } from './SessionContextDrawer';

const CONTEXT = {
  competencies: [{ name: '消防安全', status: 'partial' as const, evidence: '提到月度巡检' }],
  topics: ['租户冲突处理'],
  gaps: ['预算控制的量化结果']
};

describe('SessionContextDrawer', () => {
  test('keeps automatic context mounted and exposes it only when open', () => {
    const { rerender } = render(
      <SessionContextDrawer open={false} state={CONTEXT} onClose={vi.fn()} />
    );

    const drawer = screen.getByRole('complementary', { hidden: true });
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('消防安全')).toBeInTheDocument();

    rerender(<SessionContextDrawer open state={CONTEXT} onClose={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: '会话上下文' })).toHaveAttribute(
      'aria-hidden',
      'false'
    );
    expect(screen.getByText('租户冲突处理')).toBeInTheDocument();
    expect(screen.getByText('预算控制的量化结果')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '自动会话上下文内容' })).toHaveAttribute(
      'tabindex',
      '0'
    );
  });

  test('closes from its button and Escape without touching context data', () => {
    const onClose = vi.fn();
    render(<SessionContextDrawer open state={CONTEXT} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '关闭会话上下文' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByText('消防安全')).toBeInTheDocument();
  });
});
