import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Topbar } from './Topbar';

describe('Topbar interviewer actions', () => {
  test('exposes clear-session directly without an empty overflow menu', () => {
    const onClearSession = vi.fn();
    render(
      <Topbar
        title="物业经理面试"
        mode="expert"
        status="open"
        capturing={false}
        timer="00:00"
        isLive={false}
        screenshotCount={0}
        canAnalyze
        isAnalyzing={false}
        onAnalyze={vi.fn()}
        onClearSession={onClearSession}
        onSummarize={vi.fn()}
      />
    );

    const clearSession = screen.getByRole('button', { name: '清空会话' });
    expect(clearSession).toBeVisible();
    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '会议纪要' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '洞察' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '总结面试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成追问' })).toBeInTheDocument();
    expect(screen.getByTitle('语音转文字引擎')).toHaveTextContent('豆包 2.0');
    expect(document.getElementById('auto-indicator')).toBeNull();

    fireEvent.click(clearSession);
    expect(onClearSession).toHaveBeenCalledTimes(1);
  });
});
