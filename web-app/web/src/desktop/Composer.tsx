import { useState } from 'react';
import type { AudioSource } from '@open-cluely/contract';
import type { AudioLanes } from '../lib/useCopilotSocket';
import { ChannelCard } from './ChannelCard';

interface ComposerProps {
  audio: AudioLanes;
  disabled: boolean;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onStartAudio: (source: AudioSource) => void;
  onStopAudio: (source: AudioSource) => void;
  /** Append a manual note to the candidate-answer buffer. */
  onAddNote: (note: string) => void;
  /**
   * Offline (single-mic) interview: render ONLY the mic channel as the room mic
   * and hide the candidate/computer-audio card. Online (default) shows both.
   */
  offline?: boolean;
}

/**
 * The composer, matching the desktop `.composer`: two dual-channel audio cards
 * (`#channel-computer` candidate/teal, `#channel-mic` interviewer/amber) over a
 * manual-context row (`.chat-composer`). "Add" appends the note to the
 * candidate-answer buffer so it can be analysed.
 */
export function Composer({
  audio,
  disabled,
  autoScroll,
  onToggleAutoScroll,
  onStartAudio,
  onStopAudio,
  onAddNote,
  offline = false
}: ComposerProps) {
  const [note, setNote] = useState('');

  const submit = (): void => {
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      return;
    }
    onAddNote(trimmed);
    setNote('');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div id="composer" className="composer">
      <div className="composer__channels">
        {/* Offline (single-mic) interviews capture only the room mic — the
            computer-audio/candidate card is online-only. */}
        {offline ? null : (
          <ChannelCard
            domId="channel-computer"
            source="display"
            accent="candidate"
            title="Candidate · computer audio"
            state={audio.display}
            disabled={disabled}
            onStart={onStartAudio}
            onStop={onStopAudio}
          />
        )}
        <ChannelCard
          domId="channel-mic"
          source="mic"
          accent="interviewer"
          title={offline ? '房间麦克风 / Room mic' : 'You · microphone'}
          state={audio.mic}
          disabled={disabled}
          onStart={onStartAudio}
          onStop={onStopAudio}
        />
      </div>

      <div id="chat-composer" className="chat-composer">
        <textarea
          id="chat-manual-input"
          className="chat-manual-input"
          rows={1}
          placeholder="Add a note to the context…"
          aria-label="Manual context input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          id="chat-autoscroll-toggle"
          className={`chat-autoscroll-toggle${autoScroll ? '' : ' off'}`}
          type="button"
          aria-pressed={autoScroll}
          title="Toggle auto-scroll"
          onClick={onToggleAutoScroll}
        >
          {'⇩'}
        </button>
        <button
          id="chat-manual-send"
          className="chat-manual-send"
          type="button"
          onClick={submit}
          disabled={note.trim().length === 0}
        >
          Add
        </button>
      </div>
    </div>
  );
}
