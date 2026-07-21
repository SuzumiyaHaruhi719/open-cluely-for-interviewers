import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { OutputLanguage, SpeakerRole } from '@open-cluely/contract';
import { NotePencil } from '@phosphor-icons/react/NotePencil';
import { Question } from '@phosphor-icons/react/Question';
import { Sparkle } from '@phosphor-icons/react/Sparkle';
import { User } from '@phosphor-icons/react/User';
import { UsersThree } from '@phosphor-icons/react/UsersThree';
import type {
  CopilotProgress,
  CopilotQuestionEvent,
  CopilotResult,
  TranscriptLanes
} from '../lib/useCopilotSocket';
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
  createdAtMs?: number;
}

interface TranscriptStreamProps {
  transcripts: TranscriptLanes;
  /** Seeded (sample) or loaded (session) conversation, shown before live lanes. */
  transcriptMessages: TranscriptMessage[];
  /** @deprecated Visible questions come from questionEvents. */
  lastResult: CopilotResult | null;
  /** Durable AI follow-ups anchored inside the live transcript timeline. */
  questionEvents?: CopilotQuestionEvent[];
  /** Selected output language; also localizes the live question-card labels. */
  outputLanguage?: OutputLanguage;
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
  /** Server-confirmed ASR is live; interval countdown is meaningless while idle. */
  capturing?: boolean;
  /** Timestamp (ms) of the last auto fire (or when interval mode became active). */
  lastAutoFireAt?: number | null;
  /**
   * Offline (single-mic) interview: render the diarized `speakerSegments` list
   * with one-tap role toggles INSTEAD of the two online source lanes. Online
   * callers omit this (defaults false) and are unaffected.
   */
  offline?: boolean;
  /** Speaker-partitioned finalized segments; rendered for the single-mic flow. */
  speakerSegments?: SpeakerSegment[];
  /** One-tap role override for a speaker id (offline only). */
  onSetSpeakerRole?: (speakerId: number, role: SpeakerRole) => void;
  /** First capture start; arrival timestamps render as elapsed interview time. */
  startedAtMs?: number | null;
}

interface LaneLineProps {
  lane: 'candidate' | 'interviewer' | 'unknown';
  text: string;
  live?: boolean;
  onLiveReveal?: () => void;
  createdAtMs?: number;
  startedAtMs?: number | null;
}

const LIVE_CAPTION_INTERVAL_MS = 20;

export function formatTranscriptTime(
  createdAtMs: number | undefined,
  startedAtMs: number | null | undefined
): string {
  const arrival = Number.isFinite(createdAtMs) ? (createdAtMs as number) : (startedAtMs ?? 0);
  const base = Number.isFinite(startedAtMs) ? (startedAtMs as number) : arrival;
  const totalSeconds = Math.max(0, Math.floor((arrival - base) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

type GraphemeSegmenter = {
  segment: (input: string) => Iterable<{ segment: string }>;
};
type GraphemeSegmenterConstructor = new (
  locale?: string,
  options?: { granularity: 'grapheme' }
) => GraphemeSegmenter;

function splitGraphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter('zh', { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

function commonPrefixLength(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function TranscriptRoleIcon({ lane }: { lane: 'candidate' | 'interviewer' | 'unknown' }) {
  const iconProps = {
    size: 15,
    weight: 'fill' as const,
    'data-icon-library': 'phosphor',
    'aria-hidden': true
  };
  if (lane === 'candidate') return <User {...iconProps} />;
  if (lane === 'interviewer') return <UsersThree {...iconProps} />;
  return <Question {...iconProps} />;
}

/** Smooth provider-sized rolling hypotheses into a legible character stream.
 * Durable finals never pass through this component and therefore land at once. */
function ProgressiveLiveText({ text, onReveal }: { text: string; onReveal?: () => void }) {
  const targetRef = useRef(text);
  const [displayed, setDisplayed] = useState(() => splitGraphemes(text).slice(0, 1).join(''));

  useEffect(() => {
    targetRef.current = text;
    setDisplayed((current) => {
      const target = splitGraphemes(text);
      const shown = splitGraphemes(current);
      const shared = commonPrefixLength(shown, target);
      if (shared === shown.length) return current;
      return target.slice(0, Math.max(1, shared)).join('');
    });
  }, [text]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDisplayed((current) => {
        const target = splitGraphemes(targetRef.current);
        const shown = splitGraphemes(current);
        const shared = commonPrefixLength(shown, target);
        if (shared < shown.length) {
          return target.slice(0, Math.max(1, shared)).join('');
        }
        if (shown.length >= target.length) return current;
        return target.slice(0, shown.length + 1).join('');
      });
    }, LIVE_CAPTION_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    onReveal?.();
  }, [displayed, onReveal]);

  return (
    <>
      <span data-live-caption="visual" aria-hidden="true">
        {displayed}
      </span>
      <span className="live-caption__sr" role="status" aria-live="polite" aria-atomic="true">
        {text}
      </span>
    </>
  );
}

/** One transcript line — desktop `.chat-message.lane-candidate|interviewer`. */
function LaneLine({
  lane,
  text,
  live = false,
  onLiveReveal,
  createdAtMs,
  startedAtMs
}: LaneLineProps) {
  const timestamp = formatTranscriptTime(createdAtMs, startedAtMs);
  return (
    <div className={`chat-message lane-${lane}${live ? ' is-live' : ''}`}>
      <time className="transcript-time" dateTime={`PT${Math.max(0, Math.floor(((createdAtMs ?? startedAtMs ?? 0) - (startedAtMs ?? createdAtMs ?? 0)) / 1000))}S`}>
        {timestamp}
      </time>
      <div className="message-header">
        <span className="message-icon" aria-hidden="true">
          <TranscriptRoleIcon lane={lane} />
        </span>
        <span className="message-label">
          {live ? '输入中…' : lane === 'candidate' ? '候选人' : lane === 'interviewer' ? '你' : '说话人'}
        </span>
      </div>
      <div className="message-content">
        {live ? <ProgressiveLiveText text={text} onReveal={onLiveReveal} /> : text}
      </div>
    </div>
  );
}

/**
 * A compact AI follow-up line for seeded/loaded history — `.chat-message.lane-ai`.
 * Deliberately NOT the full question card: replayed history shows the question
 * text only, while LIVE results still render the rich `QuestionCard` below.
 */
function AiLine({
  text,
  createdAtMs,
  startedAtMs
}: {
  text: string;
  createdAtMs?: number;
  startedAtMs?: number | null;
}) {
  return (
    <div className="chat-message lane-ai">
      <time className="transcript-time">
        {formatTranscriptTime(createdAtMs, startedAtMs)}
      </time>
      <div className="message-header">
        <span className="message-icon" aria-hidden="true">
          <Sparkle size={15} weight="fill" data-icon-library="phosphor" />
        </span>
        <span className="message-label">AI</span>
      </div>
      <div className="message-content">{text}</div>
    </div>
  );
}

/** A manual interviewer note added to the context — `.chat-message.lane-note`. */
function NoteLine({
  text,
  createdAtMs,
  startedAtMs
}: {
  text: string;
  createdAtMs?: number;
  startedAtMs?: number | null;
}) {
  return (
    <div className="chat-message lane-note">
      <time className="transcript-time">
        {formatTranscriptTime(createdAtMs, startedAtMs)}
      </time>
      <div className="message-header">
        <span className="message-icon" aria-hidden="true">
          <NotePencil size={15} weight="fill" data-icon-library="phosphor" />
        </span>
        <span className="message-label">备注</span>
      </div>
      <div className="message-content">{text}</div>
    </div>
  );
}

/** Map a diarized speaker role onto a transcript lane. */
function roleToLane(role: SpeakerRole): 'candidate' | 'interviewer' | 'unknown' {
  return role === 'interviewer' ? 'interviewer' : role === 'candidate' ? 'candidate' : 'unknown';
}

/**
 * Server partitions coalesce consecutive same-role ASR turns and retain the
 * first turn's seq as the visible bubble id. Auto can anchor to a later seq
 * inside that bubble, so exact-id matching would orphan the question at the
 * bottom of the transcript. The containing bubble is the latest visible start
 * at or before the semantic anchor.
 */
function containingSegmentId(
  anchorSeq: number | null,
  segments: readonly SpeakerSegment[]
): number | null {
  if (anchorSeq === null) return null;
  let containingId: number | null = null;
  for (const segment of segments) {
    if (segment.id > anchorSeq) break;
    containingId = segment.id;
  }
  return containingId;
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
  // The server restarts its interval timer whenever the cadence changes. Mirror
  // that reset here instead of continuing to count from the old cadence anchor.
  const [anchorAt, setAnchorAt] = useState(() => lastAutoFireAt ?? Date.now());
  useEffect(() => {
    const resetAt = Date.now();
    setAnchorAt(resetAt);
    setNow(resetAt);
  }, [autoIntervalMs]);
  useEffect(() => {
    const resetAt = lastAutoFireAt ?? Date.now();
    setAnchorAt(resetAt);
    setNow(Date.now());
  }, [lastAutoFireAt]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.round((autoIntervalMs - (now - anchorAt)) / 1000));
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
  questionEvents = [],
  outputLanguage = '',
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
  capturing = false,
  lastAutoFireAt = null,
  startedAtMs = null
}: TranscriptStreamProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);

  const scrollToLatest = useCallback((): void => {
    const el = containerRef.current;
    if (autoScroll && followLatestRef.current && el) el.scrollTop = el.scrollHeight;
  }, [autoScroll]);

  const onTranscriptScroll = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    followLatestRef.current = distanceFromBottom <= 48;
  }, []);

  // Keep the newest content in view as lines / cards arrive (desktop autoscroll).
  // Scroll the CONTAINER (not a trailing sentinel) so `.chat-messages` can be
  // truly `:empty` — that's what triggers the desktop `:empty::before` prompt.
  useEffect(() => {
    scrollToLatest();
  }, [
    autoScroll,
    transcriptMessages,
    transcripts.display.finalText,
    transcripts.display.partial,
    transcripts.mic.finalText,
    transcripts.mic.partial,
    speakerSegments,
    questionEvents,
    progress,
    isAnalyzing,
    scrollToLatest
  ]);

  // Show the approximate cooldown only when interval mode + AUTO are on and no
  // generation is in flight (the progress card replaces it while analyzing).
  const showCooldown = autoMode === 'interval' && autoGenerate && capturing && !isAnalyzing;

  const display = transcripts.display;
  const mic = transcripts.mic;

  // Render the labelable speaker-segment view whenever diarized segments exist
  // OR the interview is offline. Doubao carries its OWN speaker id on
  // ONLINE finals, so segments DO exist in online mode — show the bubbles with
  // 面试官/候选人 toggles so the interviewer can label them. Without this, online
  // mode always showed the two fixed channel lanes and the toggles never appeared
  // (native cluster labels must remain editable). Pure online with a non-diarizing provider
  // (paraformer/volc) has no segments → falls through to the two-lane view.
  const showSpeakers = offline || (speakerSegments?.length ?? 0) > 0;
  const visibleSegments = speakerSegments ?? [];
  const questionAnchorIds = new Map(
    questionEvents.map((event) => [event.id, containingSegmentId(event.anchorSeq, visibleSegments)])
  );
  const tailQuestions = showSpeakers
    ? questionEvents.filter((event) => questionAnchorIds.get(event.id) === null)
    : questionEvents;
  const newestQuestionId = questionEvents.at(-1)?.id;

  const renderQuestion = (event: CopilotQuestionEvent) => (
    <QuestionCard
      key={event.id}
      output={event.result.output}
      mode={event.result.mode}
      tokensUsed={event.result.tokensUsed}
      elapsedMs={event.result.elapsedMs}
      outputLanguage={outputLanguage}
      ranked={event.result.ranked}
      trigger={event.result.trigger}
      pickedHint={event.id === newestQuestionId ? pickedHint : null}
      onPickCandidate={onPickCandidate}
      timelineTime={formatTranscriptTime(event.createdAtMs, startedAtMs)}
    />
  );

  return (
    <div
      id="chat-messages"
      className="chat-messages"
      ref={containerRef}
      role="log"
      tabIndex={0}
      onScroll={onTranscriptScroll}
      aria-live="polite"
      aria-label="实时转写"
    >
      {/* Seeded (sample) or loaded (session) conversation, before the live lanes. */}
      {transcriptMessages.map((message, index) => {
        if (message.role === 'ai') {
          return (
            <AiLine
              key={`seed-${index}`}
              text={message.text}
              createdAtMs={message.createdAtMs}
              startedAtMs={startedAtMs}
            />
          );
        }
        if (message.role === 'note') {
          return (
            <NoteLine
              key={`seed-${index}`}
              text={message.text}
              createdAtMs={message.createdAtMs}
              startedAtMs={startedAtMs}
            />
          );
        }
        return (
          <LaneLine
            key={`seed-${index}`}
            lane={message.role}
            text={message.text}
            createdAtMs={message.createdAtMs}
            startedAtMs={startedAtMs}
          />
        );
      })}

      {showSpeakers ? (
        // Diarized speaker bubbles (offline single-mic OR online Doubao, which
        // carries its own speaker id). Each bubble offers the 面试官/候选人 toggle.
        // The OFFLINE-only fallback below shows the raw room-mic text until
        // diarization tags a speaker (sidecar resolving/unavailable), plus the
        // live partial for real-time feedback.
        <>
          {visibleSegments.map((seg) => {
            // Never present unresolved semantic evidence as a confident identity.
            // The explicit pending label remains actionable through the manual role
            // controls while the server's final audit is still inconclusive.
            const lane = roleToLane(seg.role);
            const label =
              seg.role === 'interviewer'
                ? '面试官'
                : seg.role === 'candidate'
                  ? '候选人'
                  : `待确认 · 说话人 ${seg.speakerId}`;
            return (
              <Fragment key={seg.id}>
                <div className={`chat-message lane-${lane} has-role-toggle`}>
                  <time className="transcript-time">
                    {formatTranscriptTime(seg.createdAtMs, startedAtMs)}
                  </time>
                  <div className="message-header">
                    <span className="message-icon" aria-hidden="true">
                      <TranscriptRoleIcon lane={lane} />
                    </span>
                    <span className="message-label">{label}</span>
                    <span className="speaker-role-actions">
                      <button
                        type="button"
                        className={`speaker-role-toggle${seg.role === 'interviewer' ? ' is-active' : ''}`}
                        onClick={() => onSetSpeakerRole?.(seg.speakerId, 'interviewer')}
                      >
                        面试官
                      </button>
                      <button
                        type="button"
                        className={`speaker-role-toggle${seg.role === 'candidate' ? ' is-active' : ''}`}
                        onClick={() => onSetSpeakerRole?.(seg.speakerId, 'candidate')}
                      >
                        候选人
                      </button>
                    </span>
                  </div>
                  <div className="message-content">{seg.text}</div>
                </div>
                {questionEvents
                  .filter((event) => questionAnchorIds.get(event.id) === seg.id)
                  .map(renderQuestion)}
              </Fragment>
            );
          })}
          {offline && (speakerSegments ?? []).length === 0 && mic.finalText ? (
            <LaneLine lane="candidate" text={mic.finalText} startedAtMs={startedAtMs} />
          ) : null}
          {/* Native speaker IDs are attached only to finalized ASR runs.
              Keep the provider's rolling partial visible as a neutral live line
              until that run finalizes and semantic role assignment can label it. */}
          {display.partial ? <LaneLine lane="unknown" text={display.partial} live onLiveReveal={scrollToLatest} startedAtMs={startedAtMs} /> : null}
          {mic.partial ? <LaneLine lane="unknown" text={mic.partial} live onLiveReveal={scrollToLatest} startedAtMs={startedAtMs} /> : null}
        </>
      ) : (
        <>
          {display.finalText ? <LaneLine lane="candidate" text={display.finalText} startedAtMs={startedAtMs} /> : null}
          {display.partial ? <LaneLine lane="candidate" text={display.partial} live onLiveReveal={scrollToLatest} startedAtMs={startedAtMs} /> : null}

          {mic.finalText ? <LaneLine lane="interviewer" text={mic.finalText} startedAtMs={startedAtMs} /> : null}
          {mic.partial ? <LaneLine lane="interviewer" text={mic.partial} live onLiveReveal={scrollToLatest} startedAtMs={startedAtMs} /> : null}
        </>
      )}

      {/* Manual/legacy results without a matching semantic segment land at the
          current tail. Anchored automatic results were inserted above, directly
          after the candidate evidence that caused them. */}
      {tailQuestions.map(renderQuestion)}

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
