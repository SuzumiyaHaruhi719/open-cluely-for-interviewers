import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionConfig } from '@open-cluely/contract';
import { useCopilotSocket } from '../lib/useCopilotSocket';
import { EndInterviewDialog } from './EndInterviewDialog';
import { InterviewDock } from './InterviewDock';
import { InterviewHeader } from './InterviewHeader';
import {
  InterviewSetup,
  type InterviewSetupSubmit,
  type InterviewType
} from './InterviewSetup';
import { SessionContextDrawer } from './SessionContextDrawer';
import { SummaryModal } from './SummaryModal';
import {
  mergeSpeakerTimeline,
  TranscriptStream,
  type TranscriptMessage
} from './TranscriptStream';
import { useAppSettings } from './useAppSettings';

interface ConfigState {
  jobDescription: string;
  resumeText: string;
  interviewGuide: string[];
  interviewType: InterviewType;
}

const INITIAL_CONFIG: ConfigState = {
  jobDescription: '',
  resumeText: '',
  interviewGuide: [],
  interviewType: 'online'
};

const EXPERT_CONFIG = {
  mode: 'expert',
  interviewerModel: 'deepseek-v4-flash',
  outputLanguage: 'zh'
} as const;

const FIXED_ASR_PROVIDER = 'volc' as const;

function formatElapsedTimer(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function inferInterviewTitle(jobDescription: string): string {
  const firstLine = jobDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(职位|岗位|职位名称)\s*[:：]\s*/u, '');
  if (!firstLine || firstLine.length > 18) return '面试进行中';
  return firstLine.endsWith('面试') ? firstLine : `${firstLine}面试`;
}

function transcriptMessageLabel(message: TranscriptMessage): string {
  if (message.role === 'note') return '备注';
  if (message.role === 'ai') return 'AI追问';
  return message.role === 'interviewer' ? '面试官' : '候选人';
}

function speakerRoleLabel(role: 'interviewer' | 'candidate' | 'unknown', speakerId: number): string {
  if (role === 'interviewer') return '面试官';
  if (role === 'candidate') return '候选人';
  return `待确认（说话人 ${speakerId}）`;
}

/**
 * Single-purpose interviewer experience: factual preparation followed by a
 * focused live transcript. Product policy is fixed; the only side surface is
 * the server-maintained automatic session-context drawer.
 */
export function Shell() {
  const socket = useCopilotSocket();
  const {
    status,
    sendConfigure,
    analyze,
    addContextNote,
    questionEvents,
    lastAutoFireAt,
    progress,
    progressTokens,
    isAnalyzing,
    error,
    transcripts,
    audio,
    startAudio,
    stopAudio,
    speakerSegments,
    setSpeakerRole,
    resetSpeakerSegments,
    sessionContext,
    summary,
    startSummary,
    resetTranscripts
  } = socket;

  const appSettings = useAppSettings();
  const [phase, setPhase] = useState<'setup' | 'live'>('setup');
  const [config, setConfig] = useState<ConfigState>(INITIAL_CONFIG);
  const [resumeDraft, setResumeDraft] = useState('');
  const [interviewTitle, setInterviewTitle] = useState('面试进行中');
  const [transcriptMessages, setTranscriptMessages] = useState<TranscriptMessage[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [interviewEnded, setInterviewEnded] = useState(false);
  const contextButtonRef = useRef<HTMLButtonElement | null>(null);
  const endButtonRef = useRef<HTMLButtonElement | null>(null);

  const isReady = status === 'open';
  const capturing = audio.display.capturing || audio.mic.capturing;
  const recognitionLive = (['display', 'mic'] as const).some((source) => {
    const lane = audio[source];
    return lane.capturing && (lane.runtimeState === 'live' || lane.runtimeState === undefined);
  });

  const manualCandidateAnswer = useMemo(() => {
    const confirmed = speakerSegments
      .filter((segment) => segment.role === 'candidate')
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(' ');
    const candidateText = confirmed || transcripts.display.finalText.trim();
    return candidateText.slice(-6000);
  }, [speakerSegments, transcripts.display.finalText]);

  const onManualAnalyze = useCallback((): void => {
    if (!isReady || isAnalyzing || manualCandidateAnswer.length === 0) return;
    analyze(
      manualCandidateAnswer,
      questionEvents.map((event) => event.result.output.primary_question).filter(Boolean)
    );
  }, [analyze, isAnalyzing, isReady, manualCandidateAnswer, questionEvents]);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (capturing && startedAt === null) setStartedAt(Date.now());
  }, [capturing, startedAt]);
  useEffect(() => {
    if (startedAt === null) return;
    const timerId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [startedAt]);
  const timer = formatElapsedTimer(startedAt === null ? 0 : now - startedAt);

  const pushConfig = useCallback(
    (patch: Partial<SessionConfig>): void => sendConfigure(patch),
    [sendConfigure]
  );

  const fullConfig = useCallback(
    (context: ConfigState): Partial<SessionConfig> => ({
      ...EXPERT_CONFIG,
      jobDescription: context.jobDescription,
      resumeText: context.resumeText,
      interviewGuide: context.interviewGuide,
      asrProvider: FIXED_ASR_PROVIDER,
      diarize: true,
      autoGenerate: true,
      autoMode: 'agent',
      summaryModel: appSettings.settings.summaryModel
    }),
    [appSettings.settings.summaryModel]
  );

  // Every new/reconnected server session receives the complete fixed policy and
  // current factual context. Credentials remain server-environment owned.
  useEffect(() => {
    if (socket.sessionId) sendConfigure(fullConfig(config));
  }, [socket.sessionId, config, fullConfig, sendConfigure]);

  const clearSession = useCallback((): void => {
    pushConfig({ resetGeneration: true });
    setTranscriptMessages([]);
    resetSpeakerSegments();
    resetTranscripts();
  }, [pushConfig, resetSpeakerSegments, resetTranscripts]);

  const onStartInterview = useCallback(
    ({ jobDescription, interviewGuide, resumeText, interviewType }: InterviewSetupSubmit): void => {
      clearSession();
      const nextConfig: ConfigState = {
        jobDescription,
        resumeText,
        interviewGuide,
        interviewType
      };
      setConfig(nextConfig);
      pushConfig(fullConfig(nextConfig));
      setInterviewTitle(inferInterviewTitle(jobDescription));
      setStartedAt(null);
      setNow(Date.now());
      setContextOpen(false);
      setEndConfirmOpen(false);
      setInterviewEnded(false);
      setPhase('live');
    },
    [clearSession, fullConfig, pushConfig]
  );

  const onAddNote = useCallback(
    (note: string): void => {
      addContextNote(note);
      setTranscriptMessages((previous) => [
        ...previous,
        { role: 'note', text: note, createdAtMs: Date.now() }
      ]);
    },
    [addContextNote]
  );

  const contextNotes = useMemo(
    () =>
      transcriptMessages
        .filter((message) => message.role === 'note')
        .map(({ text, createdAtMs }) => ({ text, createdAtMs })),
    [transcriptMessages]
  );

  const closeContext = useCallback((): void => {
    setContextOpen(false);
    window.requestAnimationFrame(() => contextButtonRef.current?.focus());
  }, []);

  const clientSummaryTranscript = useMemo(() => {
    if (speakerSegments.length > 0) {
      return mergeSpeakerTimeline(transcriptMessages, speakerSegments)
        .map((item) => {
          if (item.kind === 'message') {
            return `${transcriptMessageLabel(item.message)}: ${item.message.text}`;
          }
          return `${speakerRoleLabel(item.segment.role, item.segment.speakerId)}: ${item.segment.text}`;
        })
        .join('\n');
    }

    // Defensive fallback for any non-diarizing provider: summarize the same
    // finalized two-lane copy that the live panel renders. Doubao normally uses
    // the canonical speaker-segment branch above.
    return [
      transcripts.mic.finalText.trim()
        ? `面试官: ${transcripts.mic.finalText.trim()}`
        : '',
      transcripts.display.finalText.trim()
        ? `候选人: ${transcripts.display.finalText.trim()}`
        : '',
      ...transcriptMessages.map(
        (message) => `${transcriptMessageLabel(message)}: ${message.text}`
      )
    ]
      .filter(Boolean)
      .join('\n');
  }, [speakerSegments, transcriptMessages, transcripts.display.finalText, transcripts.mic.finalText]);

  const confirmEndInterview = useCallback((): void => {
    stopAudio('display');
    stopAudio('mic');
    setInterviewEnded(true);
    setEndConfirmOpen(false);
    setContextOpen(false);
    setSummaryOpen(false);
    setStartedAt(null);
    setNow(Date.now());
    setPhase('setup');
  }, [stopAudio]);

  const cancelEndInterview = useCallback((): void => {
    setEndConfirmOpen(false);
    endButtonRef.current?.focus();
  }, []);

  const onSummarize = useCallback((): void => {
    setSummaryOpen(true);
    startSummary(clientSummaryTranscript);
  }, [clientSummaryTranscript, startSummary]);

  if (phase === 'setup') {
    return (
      <div id="app" className="one-shot-app one-shot-app--setup">
        <InterviewSetup
          ready={isReady}
          resumeText={resumeDraft}
          onResumeTextChange={setResumeDraft}
          onStart={onStartInterview}
        />
      </div>
    );
  }

  return (
    <div id="app" className="one-shot-app one-shot-app--live">
      <InterviewHeader
        title={interviewTitle}
        connected={isReady}
        capturing={recognitionLive}
        timer={timer}
        contextLoaded={Boolean(config.jobDescription || config.resumeText)}
        contextOpen={contextOpen}
        ended={interviewEnded}
        canAnalyze={isReady && manualCandidateAnswer.length > 0}
        isAnalyzing={isAnalyzing}
        contextButtonRef={contextButtonRef}
        endButtonRef={endButtonRef}
        onClear={clearSession}
        onAnalyze={onManualAnalyze}
        onToggleContext={() => setContextOpen((open) => !open)}
        onSummary={onSummarize}
        onEnd={() => setEndConfirmOpen(true)}
      />

      <div className="interview-workspace">
        <main className="interview-stage">
          <TranscriptStream
            transcripts={transcripts}
            transcriptMessages={transcriptMessages}
            lastResult={null}
            questionEvents={questionEvents}
            outputLanguage="zh"
            progress={progress}
            progressTokens={progressTokens}
            isAnalyzing={isAnalyzing}
            error={error}
            autoScroll
            speakerSegments={speakerSegments}
            onSetSpeakerRole={setSpeakerRole}
            autoGenerate
            capturing={recognitionLive}
            lastAutoFireAt={lastAutoFireAt}
            startedAtMs={startedAt}
            offline={config.interviewType === 'offline'}
          />
        </main>

        <SessionContextDrawer
          open={contextOpen}
          state={sessionContext}
          notes={contextNotes}
          startedAtMs={startedAt}
          onClose={closeContext}
        />
      </div>

      <InterviewDock
        interviewType={config.interviewType}
        audio={audio}
        disabled={!isReady || interviewEnded}
        timer={timer}
        onStartAudio={startAudio}
        onStopAudio={stopAudio}
        micDeviceId={appSettings.settings.micDeviceId}
        onMicDeviceChange={appSettings.setMicDeviceId}
        onAddNote={onAddNote}
      />

      <SummaryModal
        open={summaryOpen}
        summary={summary}
        onRegenerate={() => startSummary(clientSummaryTranscript)}
        onClose={() => setSummaryOpen(false)}
      />

      <EndInterviewDialog
        open={endConfirmOpen}
        onCancel={cancelEndInterview}
        onConfirm={confirmEndInterview}
      />
    </div>
  );
}
