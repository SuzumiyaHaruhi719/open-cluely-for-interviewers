import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { InterviewSetup } from './InterviewSetup';

describe('InterviewSetup', () => {
  test('keeps the one-shot preparation surface to resume, JD, and start', () => {
    render(
      <InterviewSetup
        ready
        resumeText=""
        onResumeTextChange={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '准备本次面试' })).toBeInTheDocument();
    expect(screen.getByLabelText(/上传简历/)).toBeInTheDocument();
    expect(screen.getByLabelText('职位描述')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始面试' })).toBeDisabled();

    expect(screen.queryByText('题库')).not.toBeInTheDocument();
    expect(screen.queryByText('设置')).not.toBeInTheDocument();
    expect(screen.queryByText('面试形式')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/模型|输出语言|语音识别/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pipeline|自定义提示词/)).not.toBeInTheDocument();
  });

  test('submits trimmed JD and current resume context when ready', () => {
    const onStart = vi.fn();
    render(
      <InterviewSetup
        ready
        resumeText="  候选人拥有八年园区管理经验。  "
        onResumeTextChange={vi.fn()}
        onStart={onStart}
      />
    );

    fireEvent.change(screen.getByLabelText('职位描述'), {
      target: { value: '  物业经理\n负责园区运营。  ' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));

    expect(onStart).toHaveBeenCalledWith({
      jobDescription: '物业经理\n负责园区运营。',
      resumeText: '候选人拥有八年园区管理经验。'
    });
  });

  test('keeps start disabled while the live session is unavailable', () => {
    render(
      <InterviewSetup
        ready={false}
        resumeText=""
        onResumeTextChange={vi.fn()}
        onStart={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('职位描述'), {
      target: { value: '物业经理' }
    });

    expect(screen.getByRole('button', { name: '开始面试' })).toBeDisabled();
    expect(screen.getByText('正在连接面试服务…')).toBeInTheDocument();
  });
});
