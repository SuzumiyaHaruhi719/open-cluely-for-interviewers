import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from './useAppSettings';

const ESSENTIAL_SETTINGS: AppSettings = {
  asrProvider: 'xfyun',
  micDeviceId: '',
  autoGenerate: true,
  summaryModel: 'deepseek-v4-pro'
};

function renderSettings(settings: AppSettings = ESSENTIAL_SETTINGS) {
  const callbacks = {
    onClose: vi.fn(),
    onAsrProviderChange: vi.fn(),
    onMicDeviceChange: vi.fn(),
    onAutoGenerateChange: vi.fn(),
    onSummaryModelChange: vi.fn()
  };

  render(<SettingsModal open settings={settings} micDeviceDisabled={false} {...callbacks} />);
  return callbacks;
}

describe('SettingsModal essentials', () => {
  test('renders only settings an interviewer can safely operate', () => {
    renderSettings();

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByLabelText('语音识别')).toHaveValue('xfyun');
    expect(screen.getByText('切换后自动重连，凭证由服务端管理')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '豆包 Seed ASR 2.0 · 原生说话人分离' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /DashScope Paraformer/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /豆包流式语音 1\.0/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('语音合成')).not.toBeInTheDocument();
    expect(screen.queryByText(/Qwen Audio 3\.0/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('麦克风')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '自动追问' })).toBeChecked();
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

  test('applies the retained provider and evaluation model choices', () => {
    const callbacks = renderSettings();

    fireEvent.change(screen.getByLabelText('语音识别'), { target: { value: 'volc' } });
    fireEvent.change(screen.getByLabelText('评估报告模型'), {
      target: { value: 'deepseek-v4-flash' }
    });

    expect(callbacks.onAsrProviderChange).toHaveBeenCalledWith('volc');
    expect(callbacks.onSummaryModelChange).toHaveBeenCalledWith('deepseek-v4-flash');
  });

  test('wires every retained expert control to its owning callback', () => {
    const callbacks = renderSettings();

    fireEvent.change(screen.getByLabelText('语音识别'), { target: { value: 'paraformer' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '自动追问' }));
    fireEvent.change(screen.getByLabelText('评估报告模型'), {
      target: { value: 'deepseek-v4-flash' }
    });

    expect(callbacks.onAsrProviderChange).toHaveBeenCalledWith('paraformer');
    expect(callbacks.onAutoGenerateChange).toHaveBeenCalledWith(false);
    expect(callbacks.onSummaryModelChange).toHaveBeenCalledWith('deepseek-v4-flash');
  });

  test('locks capture-owned controls while recording without hiding their values', () => {
    const callbacks = {
      onClose: vi.fn(),
      onAsrProviderChange: vi.fn(),
      onMicDeviceChange: vi.fn(),
      onAutoGenerateChange: vi.fn(),
      onSummaryModelChange: vi.fn()
    };

    render(<SettingsModal open settings={ESSENTIAL_SETTINGS} micDeviceDisabled {...callbacks} />);

    expect(screen.getByLabelText('麦克风')).toBeDisabled();
    expect(screen.getByText('停止录音后可切换设备')).toBeInTheDocument();
    expect(screen.getByLabelText('语音识别')).toHaveValue('xfyun');
  });
});
