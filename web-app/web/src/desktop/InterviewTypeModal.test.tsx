import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { InterviewTypeModal } from './InterviewTypeModal';

describe('InterviewTypeModal', () => {
  test('reviews Property Manager context before explicitly starting an offline interview', () => {
    const onPick = vi.fn();
    render(<InterviewTypeModal open onClose={vi.fn()} onPick={onPick} />);

    expect(screen.getByLabelText('职位背景')).toHaveValue('property-manager');
    expect(screen.getByText('驻扎在园区现场，负责物业运营落地的园区负责人')).toBeInTheDocument();
    expect(screen.getByText('突发事件应对与复盘')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '线下面试' }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        interviewType: 'offline',
        jobProfileId: 'property-manager',
        jobDescription: expect.stringContaining('现场的安全及消防'),
        interviewGuide: expect.arrayContaining([
          expect.stringContaining('突发事件应对与复盘')
        ])
      })
    );
    expect(onPick.mock.calls[0][0]).not.toHaveProperty('sample');
  });

  test('supports a custom JD without creating a prompt-authoring surface', () => {
    const onPick = vi.fn();
    render(<InterviewTypeModal open onClose={vi.fn()} onPick={onPick} />);

    fireEvent.change(screen.getByLabelText('职位背景'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('职位描述'), {
      target: { value: '负责一线门店运营与顾客服务。' }
    });
    fireEvent.click(screen.getByRole('radio', { name: '线上面试' }));
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));

    expect(onPick).toHaveBeenCalledWith({
      interviewType: 'online',
      jobProfileId: 'custom',
      jobDescription: '负责一线门店运营与顾客服务。',
      interviewGuide: []
    });
    expect(screen.queryByText('总结提示词')).not.toBeInTheDocument();
  });
});
