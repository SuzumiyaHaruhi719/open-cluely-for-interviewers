import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AudioSource } from '@open-cluely/contract';
import { Desktop, LockOpen, Microphone } from '@phosphor-icons/react';
import type { AudioState } from '../lib/useCopilotSocket';
import { supportsDisplayAudio } from '../lib/audioCapture';

interface ChannelCardProps {
  /** DOM id matching the desktop: channel-computer (display) / channel-mic. */
  domId: string;
  source: AudioSource;
  /** Card accent: teal (candidate) or amber (interviewer). */
  accent: 'candidate' | 'interviewer';
  title: string;
  state: AudioState;
  disabled: boolean;
  /** Shared selected microphone device id (empty = OS default). */
  micDeviceId?: string;
  onMicDeviceChange?: (deviceId: string) => void;
  onStart: (source: AudioSource) => void;
  onStop: (source: AudioSource) => void;
}

/**
 * Audio-input device list for the room-mic lane. Enumerates inputs on mount; a
 * one-time permission unlock reveals device LABELS (blank until granted). The
 * chosen deviceId is persisted to MIC_DEVICE_KEY, which audioCapture.ts reads on
 * the next mic start.
 */
function useMicDevices(enabled: boolean) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [needsPermission, setNeedsPermission] = useState(false);

  const load = useCallback(async (withPrompt: boolean) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    if (withPrompt) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch {
        /* permission denied — labels stay blank */
      }
    }
    let list: MediaDeviceInfo[] = [];
    try {
      list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    } catch {
      return;
    }
    setDevices(list);
    setNeedsPermission(list.length > 0 && !list.some((d) => d.label));
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void load(false);
    const onChange = () => void load(false);
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  }, [enabled, load]);

  return { devices, needsPermission, grant: () => void load(true) };
}

/** Status pill text + `data-state` from the capture state. */
function statusFor(
  state: AudioState
): { label: string; attr: 'off' | 'connecting' | 'listening' | 'warning' | 'error' } {
  if (state.runtimeState === 'failed' || state.error) {
    return { label: '错误', attr: 'error' };
  }
  if (state.runtimeState === 'partial') {
    return { label: '部分完成', attr: 'warning' };
  }
  if (state.runtimeState === 'finalizing') {
    return { label: '收尾中', attr: 'connecting' };
  }
  if (state.runtimeState === 'connecting') {
    return { label: '连接中', attr: 'connecting' };
  }
  if (state.runtimeState === 'live') {
    return { label: '实时', attr: 'listening' };
  }
  if (state.capturing) {
    return { label: '实时', attr: 'listening' };
  }
  return { label: '关闭', attr: 'off' };
}

/**
 * One dual-channel audio card. Ports the existing LiveAudioPanel toggle + VU
 * behaviour into the desktop `.channel-box` markup (header + status pill +
 * toggle + scaleX level meter). `--channel-accent` is injected per card — teal
 * for the candidate/computer channel, amber for the interviewer/mic — exactly
 * like the desktop component.
 */
export function ChannelCard({
  domId,
  source,
  accent,
  title,
  state,
  disabled,
  micDeviceId = '',
  onMicDeviceChange = () => {},
  onStart,
  onStop
}: ChannelCardProps) {
  const unsupported = source === 'display' && !supportsDisplayAudio();
  const blocked = disabled || unsupported;
  const status = statusFor(state);
  const accentVar = accent === 'candidate' ? 'var(--candidate)' : 'var(--interviewer)';
  // VU meter: gentle gain so speech reads, mapped to a 0..1 scaleX.
  const meterScale = state.capturing ? Math.min(1, state.level * 1.4) : 0;
  const cardStyle = { '--channel-accent': accentVar } as CSSProperties;
  const fillStyle = { transform: `scaleX(${meterScale})` } as CSSProperties;

  // Room-mic lane: a real device picker. Hook is always called (gated internally).
  const isMic = source === 'mic';
  const mic = useMicDevices(isMic);
  const micSelectDisabled = blocked || state.capturing;

  // Debounce guard: while a start/stop is in flight, lock the toggle so a user
  // can't spam-click it before the capture state settles. Mirrors the desktop
  // channel-control.js `isBusy` flag — there the toggle shows '…' and ignores
  // clicks while ensureSourceRunning() awaits. AudioState has no `connecting`
  // field (capture flips `capturing` only once setup completes), so we track it
  // locally by awaiting the onStart/onStop callback.
  const [connecting, setConnecting] = useState(false);
  const handleToggle = async (): Promise<void> => {
    if (connecting) return;
    setConnecting(true);
    try {
      if (state.capturing) {
        await onStop(source);
      } else {
        await onStart(source);
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      id={domId}
      className="composer__channel"
    >
      <div
        className={`channel-box${state.capturing ? ' is-on' : ''}`}
        style={cardStyle}
      >
        <div className="channel-header">
          <div className="channel-heading">
            {source === 'mic' ? (
              <Microphone size={15} data-icon-library="phosphor" aria-hidden="true" />
            ) : (
              <Desktop size={15} data-icon-library="phosphor" aria-hidden="true" />
            )}
            <span className="channel-title">{title}</span>
          </div>
          <span className="channel-status" data-state={status.attr}>
            {status.label}
          </span>
        </div>

        <div className="channel-device-row">
          <button
            type="button"
            className={`channel-toggle${state.capturing ? ' on' : ''}${connecting ? ' connecting' : ''}`}
            disabled={blocked || connecting}
            onClick={handleToggle}
          >
            {connecting ? '…' : state.capturing ? '停止' : '开始'}
          </button>
          {isMic ? (
            <div style={{ display: 'flex', flex: '1 1 auto', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <select
                className="channel-device-select"
                style={{ flex: '1 1 auto', minWidth: 0 }}
                value={micDeviceId}
                disabled={micSelectDisabled}
                title={state.capturing ? '停止后才能切换麦克风' : '选择麦克风输入设备'}
                onChange={(e) => onMicDeviceChange(e.target.value)}
              >
                <option value="">系统默认麦克风</option>
                {mic.devices.map((d, i) => (
                  <option key={d.deviceId || `mic-${i}`} value={d.deviceId}>
                    {d.label || `麦克风 ${i + 1}`}
                  </option>
                ))}
              </select>
              {mic.needsPermission && (
                <button
                  type="button"
                  onClick={mic.grant}
                  title="授权一次以显示麦克风名称（仅用于列出设备）"
                  style={{
                    flex: '0 0 auto',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--fg-muted)',
                    padding: '2px 7px',
                    fontSize: 12,
                    lineHeight: 1
                  }}
                >
                  <LockOpen size={13} data-icon-library="phosphor" aria-hidden="true" />
                  设备名
                </button>
              )}
            </div>
          ) : (
            <span className="channel-device-select channel-device-select--static" aria-hidden="true">
              {unsupported
                ? '标签页音频需要 Chrome 或 Edge'
                : state.error
                  ? state.error
                  : '共享带音频的标签页或窗口'}
            </span>
          )}
        </div>

        {isMic && state.error ? (
          <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4, lineHeight: 1.3 }}>
            {state.error}
          </div>
        ) : null}

        {state.notice ? <div className="channel-notice">{state.notice}</div> : null}

        <div className="channel-meter">
          <div className="channel-meter-fill" style={fillStyle} />
        </div>
      </div>
    </div>
  );
}
