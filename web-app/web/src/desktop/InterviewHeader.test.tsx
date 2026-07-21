import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { InterviewHeader } from './InterviewHeader';

describe('InterviewHeader', () => {
  test('shows only live interview metadata and essential actions', () => {
    render(
      <InterviewHeader
        title="物业经理面试"
        connected
        capturing
        timer="00:12:48"
        contextLoaded
        contextOpen={false}
        ended={false}
        canAnalyze
        isAnalyzing={false}
        onAnalyze={vi.fn()}
        onClear={vi.fn()}
        onToggleContext={vi.fn()}
        onSummary={vi.fn()}
        onEnd={vi.fn()}
      />
    );

    expect(screen.getByText('物业经理面试')).toBeInTheDocument();
    expect(screen.getByText('直播中')).toBeInTheDocument();
    expect(screen.getByText('00:12:48')).toBeInTheDocument();
    expect(screen.getByText('资料已载入')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清空转写' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话上下文' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: '结束面试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '面试总结' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '手动追问' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '切换到浅色主题' })).toBeInTheDocument();

    expect(screen.queryByText('题库')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.queryByText(/移动端/)).not.toBeInTheDocument();
  });

  test('routes manual question, clear, context, summary, and end as independent actions', () => {
    const onAnalyze = vi.fn();
    const onClear = vi.fn();
    const onToggleContext = vi.fn();
    const onSummary = vi.fn();
    const onEnd = vi.fn();
    render(
      <InterviewHeader
        title="面试进行中"
        connected
        capturing={false}
        timer="00:00:00"
        contextLoaded={false}
        contextOpen
        ended={false}
        canAnalyze
        isAnalyzing={false}
        onAnalyze={onAnalyze}
        onClear={onClear}
        onToggleContext={onToggleContext}
        onSummary={onSummary}
        onEnd={onEnd}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动追问' }));
    fireEvent.click(screen.getByRole('button', { name: '清空转写' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭会话上下文' }));
    fireEvent.click(screen.getByRole('button', { name: '面试总结' }));
    fireEvent.click(screen.getByRole('button', { name: '结束面试' }));

    expect(onAnalyze).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    expect(onToggleContext).toHaveBeenCalledOnce();
    expect(onSummary).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  test('shows a truthful ended state and prevents ending twice', () => {
    render(
      <InterviewHeader
        title="物业经理面试"
        connected
        capturing={false}
        timer="00:18:03"
        contextLoaded
        contextOpen={false}
        ended
        canAnalyze={false}
        isAnalyzing={false}
        onAnalyze={vi.fn()}
        onClear={vi.fn()}
        onToggleContext={vi.fn()}
        onSummary={vi.fn()}
        onEnd={vi.fn()}
      />
    );

    expect(screen.getByText('已结束')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结束面试' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '面试总结' })).toBeEnabled();
  });
});
