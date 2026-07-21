import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { EndInterviewDialog } from './EndInterviewDialog';

describe('EndInterviewDialog', () => {
  test('uses cancel-first focus and explicit neutral/destructive actions', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<EndInterviewDialog open onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByRole('dialog', { name: '结束本次面试？' })).toBeInTheDocument();
    expect(screen.getByText('确认后将停止音频采集并返回开始前准备页面。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('end-interview-dialog__cancel');
    expect(screen.getByRole('button', { name: '确认结束' })).toHaveClass(
      'end-interview-dialog__confirm'
    );

    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('cancels with Escape or the backdrop and does not render while closed', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <EndInterviewDialog open onCancel={onCancel} onConfirm={vi.fn()} />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('end-interview-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(2);

    rerender(<EndInterviewDialog open={false} onCancel={onCancel} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog', { name: '结束本次面试？' })).not.toBeInTheDocument();
  });
});
