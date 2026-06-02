import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InterviewerMode, OutputLanguage, SessionConfig } from '@open-cluely/contract';
import { useCopilotSocket } from '../lib/useCopilotSocket';
import { QuestionBank } from '../views/QuestionBank';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { TranscriptStream } from './TranscriptStream';
import { Composer } from './Composer';
import { RightRail } from './RightRail';
import { SettingsModal } from './SettingsModal';
import { useRailCollapsed } from './useRailCollapsed';
import { formatTimer } from './helpers';
import type { AppView } from './types';

interface ConfigState {
  mode: InterviewerMode;
  outputLanguage: OutputLanguage;
  jobDescription: string;
  resumeText: string;
}

const INITIAL_CONFIG: ConfigState = {
  mode: 'expert',
  outputLanguage: '',
  jobDescription: '',
  resumeText: ''
};

/**
 * The re-skinned app shell. Reproduces the desktop `renderer.html` structure
 * (`.app-shell` > `.titlebar` + `.layout`(`.sidebar`,`.main`,`.right-rail`) +
 * the settings modal) and wires the existing `useCopilotSocket` hook into it.
 * The `.main` column swaps between the live copilot and the (restyled) question
 * bank; the live session + socket persist across that swap.
 */
export function Shell() {
  const socket = useCopilotSocket();
  const {
    status,
    sendConfigure,
    analyze,
    lastResult,
    progress,
    isAnalyzing,
    error,
    transcripts,
    audio,
    startAudio,
    stopAudio
  } = socket;

  const [view, setView] = useState<AppView>('copilot');
  const [config, setConfig] = useState<ConfigState>(INITIAL_CONFIG);
  const [answer, setAnswer] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [railCollapsed, toggleRail] = useRailCollapsed();

  const isReady = status === 'open';
  const capturing = audio.display.capturing || audio.mic.capturing;
  const canAnalyze = isReady && !isAnalyzing && answer.trim().length > 0;

  // Mirror the desktop: when the candidate (display) lane produces new FINAL
  // text, fill the analyze buffer. Only react to growth so manual notes between
  // turns are preserved.
  const lastDisplayFinalRef = useRef('');
  useEffect(() => {
    const displayFinal = transcripts.display.finalText;
    if (displayFinal && displayFinal !== lastDisplayFinalRef.current) {
      lastDisplayFinalRef.current = displayFinal;
      setAnswer(displayFinal);
    }
  }, [transcripts.display.finalText]);

  // Session timer — starts counting from the first time any channel goes live.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (capturing && startedAt === null) {
      setStartedAt(Date.now());
    }
  }, [capturing, startedAt]);
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  const timer = startedAt === null ? '00:00' : formatTimer(now - startedAt);

  const pushConfig = useCallback(
    (patch: Partial<SessionConfig>) => {
      sendConfigure(patch);
    },
    [sendConfigure]
  );

  const onModeChange = useCallback(
    (mode: InterviewerMode): void => {
      setConfig((prev) => ({ ...prev, mode }));
      pushConfig({ mode });
    },
    [pushConfig]
  );

  const onLanguageChange = useCallback(
    (outputLanguage: OutputLanguage): void => {
      setConfig((prev) => ({ ...prev, outputLanguage }));
      pushConfig({ outputLanguage });
    },
    [pushConfig]
  );

  const onJobDescriptionChange = useCallback(
    (jobDescription: string): void => {
      setConfig((prev) => ({ ...prev, jobDescription }));
      pushConfig({ jobDescription });
    },
    [pushConfig]
  );

  const onResumeTextChange = useCallback(
    (resumeText: string): void => {
      setConfig((prev) => ({ ...prev, resumeText }));
      pushConfig({ resumeText });
    },
    [pushConfig]
  );

  const onAnalyze = useCallback((): void => {
    const trimmed = answer.trim();
    if (!isReady || isAnalyzing || trimmed.length === 0) {
      return;
    }
    analyze(trimmed);
  }, [answer, isReady, isAnalyzing, analyze]);

  // "Add a note" appends to the candidate-answer buffer (the analyze input).
  const onAddNote = useCallback((note: string): void => {
    setAnswer((prev) => (prev.trim().length === 0 ? note : `${prev.trim()} ${note}`));
  }, []);

  const onClearSession = useCallback((): void => {
    setAnswer('');
    lastDisplayFinalRef.current = '';
  }, []);

  const sessionTitle = useMemo(() => (view === 'bank' ? 'Question bank' : 'New interview'), [view]);

  return (
    <div id="app" className="app-shell">
      <TitleBar railCollapsed={railCollapsed} onToggleRail={toggleRail} />

      <div className="layout">
        <Sidebar
          view={view}
          onSelectView={setView}
          onNewInterview={onClearSession}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main id="main" className="main">
          {view === 'bank' ? (
            <div className="main__view-bank">
              <QuestionBank />
            </div>
          ) : (
            <>
              <Topbar
                title={sessionTitle}
                mode={config.mode}
                status={status}
                capturing={capturing}
                timer={timer}
                isLive={capturing}
                screenshotCount={0}
                canAnalyze={canAnalyze}
                isAnalyzing={isAnalyzing}
                onAnalyze={onAnalyze}
                onClearSession={onClearSession}
              />
              <TranscriptStream
                transcripts={transcripts}
                lastResult={lastResult}
                progress={progress}
                isAnalyzing={isAnalyzing}
                error={error}
                autoScroll={autoScroll}
              />
              <Composer
                audio={audio}
                disabled={!isReady}
                autoScroll={autoScroll}
                onToggleAutoScroll={() => setAutoScroll((on) => !on)}
                onStartAudio={startAudio}
                onStopAudio={stopAudio}
                onAddNote={onAddNote}
              />
            </>
          )}
        </main>

        <RightRail
          jobDescription={config.jobDescription}
          resumeText={config.resumeText}
          onJobDescriptionChange={onJobDescriptionChange}
          onResumeTextChange={onResumeTextChange}
          hasSessionContext={false}
        />
      </div>

      <SettingsModal
        open={settingsOpen}
        mode={config.mode}
        outputLanguage={config.outputLanguage}
        onClose={() => setSettingsOpen(false)}
        onModeChange={onModeChange}
        onLanguageChange={onLanguageChange}
      />
    </div>
  );
}
