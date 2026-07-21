import { useState } from 'react';
import type { AudioSource } from '@open-cluely/contract';
import { PaperPlaneRight } from '@phosphor-icons/react/PaperPlaneRight';
import { Record } from '@phosphor-icons/react/Record';
import type { AudioLanes } from '../lib/useCopilotSocket';
import { ChannelCard } from './ChannelCard';

interface InterviewDockProps {
  audio: AudioLanes;
  disabled: boolean;
  timer: string;
  onStartAudio: (source: AudioSource) => void | Promise<void>;
  onStopAudio: (source: AudioSource) => void;
  micDeviceId?: string;
  onMicDeviceChange?: (deviceId: string) => void;
  onAddNote: (note: string) => void;
}

/** Compact always-visible audio + note dock for the active interview. */
export function InterviewDock({
  audio,
  disabled,
  timer,
  onStartAudio,
  onStopAudio,
  micDeviceId = '',
  onMicDeviceChange = () => {},
  onAddNote
}: InterviewDockProps) {
  const [note, setNote] = useState('');

  const submit = (): void => {
    const trimmed = note.trim();
    if (disabled || !trimmed) return;
    onAddNote(trimmed);
    setNote('');
  };

  return (
    <footer className="interview-dock">
      <div className="interview-dock__channels">
        <ChannelCard
          domId="channel-computer"
          source="display"
          accent="candidate"
          title="候选人 · 电脑音频"
          state={audio.display}
          disabled={disabled}
          onStart={onStartAudio}
          onStop={onStopAudio}
        />
        <ChannelCard
          domId="channel-mic"
          source="mic"
          accent="interviewer"
          title="面试官 · 麦克风"
          state={audio.mic}
          disabled={disabled}
          micDeviceId={micDeviceId}
          onMicDeviceChange={onMicDeviceChange}
          onStart={onStartAudio}
          onStop={onStopAudio}
        />
      </div>

      <div className="interview-dock__recording" aria-label="录音时长">
        <Record size={15} weight="fill" aria-hidden="true" />
        <span>录音 {timer}</span>
      </div>

      <div className="interview-dock__note">
        <textarea
          rows={1}
          aria-label="面试备注"
          placeholder="输入面试备注…"
          value={note}
          disabled={disabled}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" aria-label="添加备注" disabled={disabled || !note.trim()} onClick={submit}>
          <PaperPlaneRight size={18} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
