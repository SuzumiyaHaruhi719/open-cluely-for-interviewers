import { useEffect, useRef } from 'react';
import type { CopilotProgress, CopilotResult, TranscriptLanes } from '../lib/useCopilotSocket';
import { QuestionCard } from './QuestionCard';
import { ProgressCard } from './ProgressCard';

interface TranscriptStreamProps {
  transcripts: TranscriptLanes;
  lastResult: CopilotResult | null;
  progress: CopilotProgress | null;
  isAnalyzing: boolean;
  error: string | null;
  autoScroll: boolean;
}

interface LaneLineProps {
  lane: 'candidate' | 'interviewer';
  text: string;
  live?: boolean;
}

/** One transcript line — desktop `.chat-message.lane-candidate|interviewer`. */
function LaneLine({ lane, text, live = false }: LaneLineProps) {
  return (
    <div className={`chat-message lane-${lane}${live ? ' is-live' : ''}`}>
      <div className="message-header">
        <span className="message-icon" aria-hidden="true">
          {lane === 'candidate' ? '◐' : '●'}
        </span>
        <span className="message-label">{lane === 'candidate' ? 'Candidate' : 'You'}</span>
      </div>
      <div className="message-content">{text}</div>
    </div>
  );
}

/**
 * Live transcript stream — the desktop `.chat-messages` hero column. Renders the
 * two colour-coded lanes (candidate = display/teal, interviewer = mic/amber),
 * then the analyze-progress card while a request is in flight, then the AI
 * question card once a result lands. Empty until the first line, where the
 * copied chat.css `:empty::before` shows the prompt copy.
 */
export function TranscriptStream({
  transcripts,
  lastResult,
  progress,
  isAnalyzing,
  error,
  autoScroll
}: TranscriptStreamProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest content in view as lines / cards arrive (desktop autoscroll).
  // Guarded: jsdom (and some embeddings) don't implement scrollIntoView.
  useEffect(() => {
    const end = endRef.current;
    if (autoScroll && end && typeof end.scrollIntoView === 'function') {
      end.scrollIntoView({ block: 'end' });
    }
  }, [
    autoScroll,
    transcripts.display.finalText,
    transcripts.display.partial,
    transcripts.mic.finalText,
    transcripts.mic.partial,
    lastResult,
    progress,
    isAnalyzing
  ]);

  const display = transcripts.display;
  const mic = transcripts.mic;

  return (
    <div
      id="chat-messages"
      className="chat-messages"
      role="log"
      aria-live="polite"
      aria-label="Live transcript"
    >
      {display.finalText ? <LaneLine lane="candidate" text={display.finalText} /> : null}
      {display.partial ? <LaneLine lane="candidate" text={display.partial} live /> : null}

      {mic.finalText ? <LaneLine lane="interviewer" text={mic.finalText} /> : null}
      {mic.partial ? <LaneLine lane="interviewer" text={mic.partial} live /> : null}

      {isAnalyzing ? <ProgressCard progress={progress} /> : null}

      {lastResult && !isAnalyzing ? (
        <QuestionCard
          output={lastResult.output}
          mode={lastResult.mode}
          tokensUsed={lastResult.tokensUsed}
          elapsedMs={lastResult.elapsedMs}
        />
      ) : null}

      {error ? (
        <div className="chat-message system-message">
          <span className="system-message-message">{error}</span>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
