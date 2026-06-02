import type { CSSProperties } from 'react';
import type { AudioSource } from '@open-cluely/contract';
import type { AudioState } from '../lib/useCopilotSocket';
import { supportsDisplayAudio } from '../lib/audioCapture';
import { MicIcon } from './icons';

interface ChannelCardProps {
  /** DOM id matching the desktop: channel-computer (display) / channel-mic. */
  domId: string;
  source: AudioSource;
  /** Card accent: teal (candidate) or amber (interviewer). */
  accent: 'candidate' | 'interviewer';
  title: string;
  state: AudioState;
  disabled: boolean;
  onStart: (source: AudioSource) => void;
  onStop: (source: AudioSource) => void;
}

/** Status pill text + `data-state` from the capture state. */
function statusFor(state: AudioState): { label: string; attr: 'off' | 'connecting' | 'listening' | 'error' } {
  if (state.error) {
    return { label: 'Error', attr: 'error' };
  }
  if (state.capturing) {
    return { label: 'Live', attr: 'listening' };
  }
  return { label: 'Off', attr: 'off' };
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
            <MicIcon size={14} />
            <span className="channel-title">{title}</span>
          </div>
          <span className="channel-status" data-state={status.attr}>
            {status.label}
          </span>
        </div>

        <div className="channel-device-row">
          <button
            type="button"
            className={`channel-toggle${state.capturing ? ' on' : ''}`}
            disabled={blocked}
            onClick={() => (state.capturing ? onStop(source) : onStart(source))}
          >
            {state.capturing ? 'Stop' : 'Start'}
          </button>
          <span className="channel-device-select channel-device-select--static" aria-hidden="true">
            {unsupported
              ? 'Tab audio needs Chrome / Edge'
              : state.error
                ? state.error
                : source === 'display'
                  ? 'Share a tab/window with audio'
                  : 'System default microphone'}
          </span>
        </div>

        <div className="channel-meter">
          <div className="channel-meter-fill" style={fillStyle} />
        </div>
      </div>
    </div>
  );
}
