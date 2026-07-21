import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionConfig } from '@open-cluely/contract';
import { useCopilotSocket } from '../lib/useCopilotSocket';
import { InterviewDock } from './InterviewDock';
import { InterviewHeader } from './InterviewHeader';
import { InterviewSetup, type InterviewSetupSubmit } from './InterviewSetup';
import { SessionContextDrawer } from './SessionContextDrawer';
import { SummaryModal } from './SummaryModal';
import { TranscriptStream, type TranscriptMessage } from './TranscriptStream';
import { useAppSettings } from './useAppSettings';

interface ConfigState {
  jobDescription: string;
  resumeText: string;
  interviewGuide: string[];
}

const INITIAL_CONFIG: ConfigState = {
  jobDescription: '',
  resumeText: '',
  interviewGuide: []
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
  const [interviewEnded, setInterviewEnded] = useState(false);
  const contextButtonRef = useRef<HTMLButtonElement | null>(null);

  const isReady = status === 'open';
  const capturing = audio.display.capturing || audio.mic.capturing;
  const recognitionLive = (['display', 'mic'] as const).some((source) => {
    const lane = audio[source];
    return lane.capturing && (lane.runtimeState === 'live' || lane.runtimeState === undefined);
  });

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
    ({ jobDescription, interviewGuide, resumeText }: InterviewSetupSubmit): void => {
      clearSession();
      const nextConfig: ConfigState = {
        jobDescription,
        resumeText,
        interviewGuide
      };
      setConfig(nextConfig);
      pushConfig(fullConfig(nextConfig));
      setInterviewTitle(inferInterviewTitle(jobDescription));
      setStartedAt(null);
      setNow(Date.now());
      setContextOpen(false);
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

  const closeContext = useCallback((): void => {
    setContextOpen(false);
    window.requestAnimationFrame(() => contextButtonRef.current?.focus());
  }, []);

  const clientSummaryTranscript = transcriptMessages
    .map((message) => `${message.role === 'note' ? '备注' : message.role}: ${message.text}`)
    .join('\n');

  const onEndInterview = useCallback((): void => {
    stopAudio('display');
    stopAudio('mic');
    setInterviewEnded(true);
  }, [stopAudio]);

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
        contextButtonRef={contextButtonRef}
        onClear={clearSession}
        onToggleContext={() => setContextOpen((open) => !open)}
        onSummary={onSummarize}
        onEnd={onEndInterview}
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
          />
        </main>

        <SessionContextDrawer open={contextOpen} state={sessionContext} onClose={closeContext} />
      </div>

      <InterviewDock
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
    </div>
  );
}
