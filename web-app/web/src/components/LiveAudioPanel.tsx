import type { AudioSource } from '@open-cluely/contract';
import type { AudioLanes, TranscriptLanes } from '../lib/useCopilotSocket';
import { supportsDisplayAudio } from '../lib/audioCapture';

interface LiveAudioPanelProps {
  audio: AudioLanes;
  transcripts: TranscriptLanes;
  disabled: boolean;
  onStart: (source: AudioSource) => void;
  onStop: (source: AudioSource) => void;
}

const SOURCE_META: Record<AudioSource, { title: string; sub: string }> = {
  display: { title: 'Interviewee audio', sub: 'Share a tab/window with audio' },
  mic: { title: 'My mic', sub: 'Your side of the conversation' }
};

/** A small VU bar driven by a 0..1 RMS level. */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const pct = Math.min(100, Math.round(level * 140)); // gentle gain so speech reads
  return (
    <div className="vu" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <span className="vu-fill" style={{ width: `${active ? pct : 0}%` }} />
    </div>
  );
}

function SourceToggle({
  source,
  state,
  disabled,
  onStart,
  onStop
}: {
  source: AudioSource;
  state: { capturing: boolean; level: number; error: string | null };
  disabled: boolean;
  onStart: (source: AudioSource) => void;
  onStop: (source: AudioSource) => void;
}) {
  const meta = SOURCE_META[source];
  const unsupported = source === 'display' && !supportsDisplayAudio();
  const blocked = disabled || unsupported;

  return (
    <div className="audio-source" data-capturing={state.capturing ? 'true' : 'false'}>
      <div className="audio-source-head">
        <div>
          <div className="audio-source-title">{meta.title}</div>
          <div className="hint">{meta.sub}</div>
        </div>
        <button
          type="button"
          className={`btn btn-sm${state.capturing ? '' : ' btn-primary'}`}
          disabled={blocked}
          onClick={() => (state.capturing ? onStop(source) : onStart(source))}
        >
          {state.capturing ? 'Stop' : 'Start'}
        </button>
      </div>
      <LevelMeter level={state.level} active={state.capturing} />
      {unsupported ? (
        <div className="hint audio-warn">Tab-audio capture needs Chrome or Edge.</div>
      ) : null}
      {state.error ? <div className="hint audio-error">{state.error}</div> : null}
    </div>
  );
}

function TranscriptLane({
  label,
  lane,
  tone
}: {
  label: string;
  lane: { finalText: string; partial: string };
  tone: 'interviewee' | 'interviewer';
}) {
  const hasContent = lane.finalText.length > 0 || lane.partial.length > 0;
  return (
    <div className="lane" data-tone={tone}>
      <div className="lane-label">{label}</div>
      <div className="lane-body">
        {hasContent ? (
          <p>
            {lane.finalText}
            {lane.partial ? <span className="lane-partial"> {lane.partial}</span> : null}
          </p>
        ) : (
          <p className="lane-empty">No speech captured yet.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Live-audio control + transcript surface. Two capture toggles (interviewee via
 * getDisplayMedia, interviewer via the mic) and a two-lane running transcript.
 */
export function LiveAudioPanel({ audio, transcripts, disabled, onStart, onStop }: LiveAudioPanelProps) {
  return (
    <div className="audio-panel">
      <div className="section-title">Live audio</div>
      <div className="audio-sources">
        <SourceToggle
          source="display"
          state={audio.display}
          disabled={disabled}
          onStart={onStart}
          onStop={onStop}
        />
        <SourceToggle
          source="mic"
          state={audio.mic}
          disabled={disabled}
          onStart={onStart}
          onStop={onStop}
        />
      </div>

      <div className="transcript-lanes">
        <TranscriptLane label="Interviewee" lane={transcripts.display} tone="interviewee" />
        <TranscriptLane label="Interviewer (you)" lane={transcripts.mic} tone="interviewer" />
      </div>

      <p className="hint">
        Sharing tab audio is Chrome/Edge-only — tick “Share tab audio” in the picker. Transcripts
        stream live; the interviewee transcript fills the answer box for you to Analyze.
      </p>
    </div>
  );
}
