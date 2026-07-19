import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ChannelCard } from './ChannelCard';

const devices = [
  { kind: 'audioinput', deviceId: 'built-in-mic', label: 'MacBook Pro Microphone', groupId: 'g1' },
  { kind: 'audioinput', deviceId: 'blackhole-2ch', label: 'BlackHole 2ch', groupId: 'g2' }
] as MediaDeviceInfo[];

describe('ChannelCard microphone selection', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => devices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    });
  });

  test('is controlled by the shared setting and reports changes to it', async () => {
    const onMicDeviceChange = vi.fn();
    const { rerender } = render(
      <ChannelCard
        domId="channel-mic"
        source="mic"
        accent="interviewer"
        title="房间麦克风"
        state={{ capturing: false, level: 0, error: null }}
        disabled={false}
        micDeviceId="blackhole-2ch"
        onMicDeviceChange={onMicDeviceChange}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    );

    const select = await screen.findByTitle('选择麦克风输入设备');
    await waitFor(() => expect(select).toHaveValue('blackhole-2ch'));
    fireEvent.change(select, { target: { value: 'built-in-mic' } });
    expect(onMicDeviceChange).toHaveBeenCalledWith('built-in-mic');

    rerender(
      <ChannelCard
        domId="channel-mic"
        source="mic"
        accent="interviewer"
        title="房间麦克风"
        state={{ capturing: false, level: 0, error: null }}
        disabled={false}
        micDeviceId="built-in-mic"
        onMicDeviceChange={onMicDeviceChange}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(select).toHaveValue('built-in-mic');
  });

  test('shows provider finalization and failure instead of an optimistic live badge', async () => {
    const baseProps = {
      domId: 'channel-runtime',
      source: 'mic' as const,
      accent: 'interviewer' as const,
      title: '房间麦克风',
      disabled: false,
      onMicDeviceChange: vi.fn(),
      onStart: vi.fn(),
      onStop: vi.fn()
    };
    const { rerender } = render(
      <ChannelCard
        {...baseProps}
        state={{ capturing: false, level: 0, error: null, runtimeState: 'finalizing' }}
      />
    );
    await screen.findByRole('option', { name: 'MacBook Pro Microphone' });
    expect(screen.getByText('收尾中')).toBeInTheDocument();

    rerender(
      <ChannelCard
        {...baseProps}
        state={{
          capturing: true,
          level: 0,
          error: '讯飞鉴权失败',
          runtimeState: 'failed'
        }}
      />
    );
    expect(screen.getByText('错误')).toBeInTheDocument();
    expect(screen.queryByText('实时')).not.toBeInTheDocument();
  });
});
