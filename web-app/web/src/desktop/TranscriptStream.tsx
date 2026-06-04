import { useEffect, useRef, useState } from 'react';
import type { SpeakerRole } from '@open-cluely/contract';
import type { CopilotProgress, CopilotResult, TranscriptLanes } from '../lib/useCopilotSocket';
import type { AutoMode } from './useAppSettings';
import type { SpeakerSegment } from '../lib/speakerSegments';
import { QuestionCard } from './QuestionCard';
import { ProgressCard } from './ProgressCard';

/** A role on a seeded/loaded conversation line (sample pick or session load). */
export type TranscriptRole = 'candidate' | 'interviewer' | 'ai' | 'note';

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
  /**
   * Full arrival-order history of generated results. Every entry renders its own
   * QuestionCard so a new generation never overwrites/hides an older question.
   * Optional (defaults to []) so existing callers/tests without history still work.
   */
  results?: CopilotResult[];
  progress: CopilotProgress | null;
  /** Cumulative analyze tokens so far; shown on the progress card when > 0. */
  progressTokens?: number;
  isAnalyzing: boolean;
  error: string | null;
  autoScroll: boolean;
  /** Transient "已选用" confirmation text after a ranked candidate is picked. */
  pickedHint?: string | null;
  /** Promote a ranked candidate into the analyze buffer (no server round-trip). */
  onPickCandidate?: (question: string) => void;
  /**
   * Autonomous trigger mode. The cooldown countdown only renders for 'interval'.
   * Optional (defaults 'agent') so existing callers/tests are unaffected.
   */
  autoMode?: AutoMode;
  /** Interval-mode cooldown in ms (autoIntervalSec × 1000); drives the countdown. */
  autoIntervalMs?: number;
  /** Whether the AUTO pill is on — countdown only shows when auto-generate is active. */
  autoGenerate?: boolean;
  /** Timestamp (ms) of the last auto fire (or when interval mode became active). */
  lastAutoFireAt?: number | null;
  /**
   * Offline (single-mic) interview: render the diarized `speakerSegments` list
   * with one-tap role toggles INSTEAD of the two online source lanes. Online
   * callers omit this (defaults false) and are unaffected.
   */
  offline?: boolean;
  /** Diarized speaker segments (offline FunASR only); rendered when `offline`. */
  speakerSegments?: SpeakerSegment[];
  /** One-tap role override for a speaker id (offline only). */
  onSetSpeakerRole?: (speakerId: number, role: SpeakerRole) => void;
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
        <span className="message-label">
          {live ? '输入中…' : lane === 'candidate' ? 'Candidate' : 'You'}
        </span>
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

/** A manual interviewer note added to the context — `.chat-message.lane-note`. */
function NoteLine({ text }: { text: string }) {
  return (
    <div className="chat-message lane-note">
      <div className="message-header">
        <span className="message-icon" aria-hidden="true">
          📝
        </span>
        <span className="message-label">Note</span>
      </div>
      <div className="message-content">{text}</div>
    </div>
  );
}

/** Map a diarized speaker role onto a transcript lane (only interviewer/candidate). */
function roleToLane(role: SpeakerRole): 'candidate' | 'interviewer' {
  return role === 'interviewer' ? 'interviewer' : 'candidate';
}

/**
 * An approximate client-side countdown to the next interval-mode auto follow-up:
 * "下次自动追问 ~Ns". Drives a 1s tick (cleaned up on unmount) and computes the
 * remaining seconds from `autoIntervalMs - (now - lastAutoFireAt)`. The caller is
 * responsible for only rendering this when interval mode + AUTO are on and a
 * generation isn't in flight; if no auto has fired yet (`lastAutoFireAt` null) it
 * counts down from the full interval starting now.
 */
function AutoCooldownLine({
  autoIntervalMs,
  lastAutoFireAt
}: {
  autoIntervalMs: number;
  lastAutoFireAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  // Fall back to "now" when no auto has fired yet so the bar starts a fresh window.
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const anchor = lastAutoFireAt ?? mountedAt;
  const remaining = Math.max(0, Math.round((autoIntervalMs - (now - anchor)) / 1000));
  return (
    <div className="chat-message auto-cooldown-line" role="status" aria-live="off">
      <span className="auto-cooldown-line__text">下次自动追问 ~{remaining}s</span>
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
  results = [],
  progress,
  progressTokens = 0,
  isAnalyzing,
  error,
  autoScroll,
  pickedHint = null,
  onPickCandidate,
  offline = false,
  speakerSegments,
  onSetSpeakerRole,
  autoMode = 'agent',
  autoIntervalMs = 30000,
  autoGenerate = false,
  lastAutoFireAt = null
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
    speakerSegments,
    lastResult,
    results.length,
    progress,
    isAnalyzing
  ]);

  // Show the approximate cooldown only when interval mode + AUTO are on and no
  // generation is in flight (the progress card replaces it while analyzing).
  const showCooldown = autoMode === 'interval' && autoGenerate && !isAnalyzing;

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
        if (message.role === 'note') {
          return <NoteLine key={`seed-${index}`} text={message.text} />;
        }
        return <LaneLine key={`seed-${index}`} lane={message.role} text={message.text} />;
      })}

      {offline ? (
        // Offline (single-mic): diarized speaker bubbles + a fallback so the
        // room-mic transcript is NEVER blank — it shows the raw text until
        // diarization tags a speaker (sidecar resolving/unavailable), plus the
        // live partial for real-time feedback.
        <>
          {(speakerSegments ?? []).map((seg) => (
          <div
            key={seg.id}
            className={`chat-message lane-${roleToLane(seg.role)} has-role-toggle`}
          >
            <div className="message-header">
              <span className="message-icon" aria-hidden="true">
                {seg.role === 'interviewer' ? '●' : '◐'}
              </span>
              <span className="message-label">
                {seg.role === 'interviewer' ? '面试官' : '候选人'}
              </span>
              <button
                type="button"
                className="speaker-role-toggle"
                onClick={() =>
                  onSetSpeakerRole?.(
                    seg.speakerId,
                    seg.role === 'interviewer' ? 'candidate' : 'interviewer'
                  )
                }
              >
                {seg.role === 'interviewer' ? '标为候选人' : '标为面试官'}
              </button>
            </div>
            <div className="message-content">{seg.text}</div>
          </div>
          ))}
          {(speakerSegments ?? []).length === 0 && mic.finalText ? (
            <LaneLine lane="candidate" text={mic.finalText} />
          ) : null}
          {mic.partial ? <LaneLine lane="candidate" text={mic.partial} live /> : null}
        </>
      ) : (
        <>
          {display.finalText ? <LaneLine lane="candidate" text={display.finalText} /> : null}
          {display.partial ? <LaneLine lane="candidate" text={display.partial} live /> : null}

          {mic.finalText ? <LaneLine lane="interviewer" text={mic.finalText} /> : null}
          {mic.partial ? <LaneLine lane="interviewer" text={mic.partial} live /> : null}
        </>
      )}

      {/* Full result history — one card per generation, oldest→newest, so a new
          question never overwrites/hides an older one. The picker affordances
          (onPickCandidate + the "已选用" hint) attach only to the LATEST card. */}
      {results.map((result, index) => {
        const isLatest = index === results.length - 1;
        return (
          <QuestionCard
            key={result.requestId}
            output={result.output}
            mode={result.mode}
            tokensUsed={result.tokensUsed}
            elapsedMs={result.elapsedMs}
            ranked={result.ranked}
            trigger={result.trigger}
            pickedHint={isLatest ? pickedHint : null}
            onPickCandidate={isLatest ? onPickCandidate : undefined}
          />
        );
      })}

      {/* Progress shows ADDITIONALLY, below the history — it must not replace it. */}
      {isAnalyzing ? <ProgressCard progress={progress} tokens={progressTokens} /> : null}

      {showCooldown ? (
        <AutoCooldownLine autoIntervalMs={autoIntervalMs} lastAutoFireAt={lastAutoFireAt} />
      ) : null}

      {error ? (
        <div className="chat-message system-message">
          <span className="system-message-message">{error}</span>
        </div>
      ) : null}
    </div>
  );
}
