import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { InterviewSetup } from './InterviewSetup';

function renderSetup(patch: { ready?: boolean; resumeText?: string; onStart?: ReturnType<typeof vi.fn> } = {}) {
  const onStart = patch.onStart ?? vi.fn();
  const result = render(
    <InterviewSetup
      ready={patch.ready ?? true}
      resumeText={patch.resumeText ?? ''}
      onResumeTextChange={vi.fn()}
      onStart={onStart}
    />
  );
  return { ...result, onStart };
}

describe('InterviewSetup', () => {
  test('keeps the one-shot surface to resume, searchable JD, and start', () => {
    renderSetup();

    expect(screen.getByRole('heading', { name: '准备本次面试' })).toBeInTheDocument();
    expect(screen.getByLabelText(/上传简历/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '选择职位 JD' })).toHaveValue(
      '物业经理 · 区域运营服务'
    );
    expect(screen.getByText('驻扎在园区现场，负责物业运营落地的园区负责人')).toBeInTheDocument();
    expect(screen.queryByLabelText('自定义职位描述')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始面试' })).toBeEnabled();

    expect(screen.queryByText('题库')).not.toBeInTheDocument();
    expect(screen.queryByText('设置')).not.toBeInTheDocument();
    expect(screen.queryByText('面试形式')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/模型|输出语言|语音识别/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pipeline|自定义提示词/)).not.toBeInTheDocument();
  });

  test('submits the preserved Property Manager JD, scorecard, and resume context', () => {
    const { onStart } = renderSetup({ resumeText: '  候选人拥有八年园区管理经验。  ' });

    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        jobProfileId: 'property-manager',
        jobDescription: expect.stringContaining('现场的安全及消防'),
        interviewGuide: expect.arrayContaining([expect.stringContaining('突发事件应对与复盘')]),
        resumeText: '候选人拥有八年园区管理经验。'
      })
    );
  });

  test('filters JD choices and only reveals free text after choosing custom', () => {
    const { onStart } = renderSetup();
    const picker = screen.getByRole('combobox', { name: '选择职位 JD' });

    fireEvent.change(picker, { target: { value: '城市负责人' } });
    expect(screen.getByRole('option', { name: /物业经理/ })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: '不存在的岗位' } });
    expect(screen.queryByRole('option', { name: /物业经理/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '自定义职位' }));

    const custom = screen.getByLabelText('自定义职位描述');
    expect(screen.getByRole('button', { name: '开始面试' })).toBeDisabled();
    fireEvent.change(custom, { target: { value: '  负责一线门店运营。  ' } });
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));

    expect(onStart).toHaveBeenCalledWith({
      jobProfileId: 'custom',
      jobDescription: '负责一线门店运营。',
      interviewGuide: [],
      resumeText: ''
    });
  });

  test('uses the shared icon library for resume controls', () => {
    const { container } = renderSetup({ resumeText: '候选人简历' });

    expect(container.querySelectorAll('[data-icon-library="phosphor"]').length).toBeGreaterThanOrEqual(2);
    expect(container).not.toHaveTextContent('🔓');
  });

  test('keeps start disabled while the live session is unavailable', () => {
    renderSetup({ ready: false });

    expect(screen.getByRole('button', { name: '开始面试' })).toBeDisabled();
    expect(screen.getByText('正在连接面试服务…')).toBeInTheDocument();
  });
});
