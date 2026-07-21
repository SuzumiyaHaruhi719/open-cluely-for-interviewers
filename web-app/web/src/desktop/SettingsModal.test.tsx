import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from './useAppSettings';

const ESSENTIAL_SETTINGS = {
  micDeviceId: '',
  summaryModel: 'deepseek-v4-pro'
} as AppSettings;

function renderSettings(settings: AppSettings = ESSENTIAL_SETTINGS) {
  const callbacks = {
    onClose: vi.fn(),
    onSummaryModelChange: vi.fn()
  };

  render(<SettingsModal open settings={settings} {...callbacks} />);
  return callbacks;
}

describe('SettingsModal essentials', () => {
  test('renders only settings an interviewer can safely operate', () => {
    renderSettings();

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByLabelText('语音识别')).not.toBeInTheDocument();
    expect(screen.queryByText(/讯飞|Paraformer/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('语音合成')).not.toBeInTheDocument();
    expect(screen.queryByText(/Qwen Audio 3\.0/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '音频' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('麦克风')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '自动追问' })).not.toBeInTheDocument();
    expect(screen.queryByText('专家追问')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('触发方式')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('自动追问间隔')).not.toBeInTheDocument();
    expect(screen.getByLabelText('评估报告模型')).toHaveValue('deepseek-v4-pro');

    expect(screen.queryByText('面试模式')).not.toBeInTheDocument();
    expect(screen.queryByText('API 密钥')).not.toBeInTheDocument();
    expect(screen.queryByText(/App ID|Access Token|Customize|Pipeline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('输出语言')).not.toBeInTheDocument();
    expect(screen.queryByText('总结提示词')).not.toBeInTheDocument();
    expect(screen.queryByText('外观')).not.toBeInTheDocument();
    expect(screen.queryByText('键盘快捷键')).not.toBeInTheDocument();
  });

  test('applies the retained evaluation model choice', () => {
    const callbacks = renderSettings();

    fireEvent.change(screen.getByLabelText('评估报告模型'), {
      target: { value: 'deepseek-v4-flash' }
    });

    expect(callbacks.onSummaryModelChange).toHaveBeenCalledWith('deepseek-v4-flash');
  });

  test('wires every retained control to its owning callback', () => {
    const callbacks = renderSettings();

    fireEvent.change(screen.getByLabelText('评估报告模型'), {
      target: { value: 'deepseek-v4-flash' }
    });

    expect(callbacks.onSummaryModelChange).toHaveBeenCalledWith('deepseek-v4-flash');
  });

});
