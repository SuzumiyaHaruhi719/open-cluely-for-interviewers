import { useEffect, useRef } from 'react';
import type { CopilotProgress, CopilotResult, TranscriptLanes } from '../lib/useCopilotSocket';
import { QuestionCard } from './QuestionCard';
import { ProgressCard } from './ProgressCard';

/** A role on a seeded/loaded conversation line (sample pick or session load). */
export type TranscriptRole = 'candidate' | 'interviewer' | 'ai';

/** One pre-existing conversation line, rendered before the live transcript. */
export interface TranscriptMessage {
  role: TranscriptRole;
  text: string;
}

interface TranscriptStreamProps {
  transcripts: TranscriptLanes;
  /** Seeded (sample) or loaded (session) conversation, shown before live lanes. */
  transcriptMessages: TranscriptMessage[];
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
 * A compact AI follow-up line for seeded/loaded history — `.chat-message.lane-ai`.
 * Deliberately NOT the full question card: replayed history shows the question
 * text only, while LIVE results still render the rich `QuestionCard` below.
 */
function AiLine({ text }: { text: string }) {
  return (
    <div className="chat-message lane-ai">
      <div className="message-header">
        <span className="message-icon" aria-hidden="true">
          ✦
        </span>
        <span className="message-label">AI</span>
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
  transcriptMessages,
  lastResult,
  progress,
  isAnalyzing,
  error,
  autoScroll
}: TranscriptStreamProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest content in view as lines / cards arrive (desktop autoscroll).
  // Scroll the CONTAINER (not a trailing sentinel) so `.chat-messages` can be
  // truly `:empty` — that's what triggers the desktop `:empty::before` prompt.
  useEffect(() => {
    const el = containerRef.current;
    if (autoScroll && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [
    autoScroll,
    transcriptMessages,
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
      ref={containerRef}
      role="log"
      aria-live="polite"
      aria-label="Live transcript"
    >
      {/* Seeded (sample) or loaded (session) conversation, before the live lanes. */}
      {transcriptMessages.map((message, index) => {
        if (message.role === 'ai') {
          return <AiLine key={`seed-${index}`} text={message.text} />;
        }
        return <LaneLine key={`seed-${index}`} lane={message.role} text={message.text} />;
      })}

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
    </div>
  );
}
