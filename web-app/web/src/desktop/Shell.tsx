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
import { InterviewTypeModal, type InterviewTypeChoice } from './InterviewTypeModal';
import { ResultsPanel } from './ResultsPanel';
import { useRailCollapsed } from './useRailCollapsed';
import { useSessions } from './useSessions';
import { useAssistantPanel } from './useAssistantPanel';
import { useAppSettings } from './useAppSettings';
import { formatTimer } from './helpers';
import { sampleTranscriptText } from './interviewSamples';
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
 *
 * Wave B additions wired here: session history (`useSessions`) with the
 * interview-type picker + hydration, the résumé upload/chat rail, the topbar
 * assistant actions (Ask AI / notes / insights → results panel), and the
 * functional settings (opacity, mic enumerate, model/provider persistence).
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
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [railCollapsed, toggleRail] = useRailCollapsed();

  const sessions = useSessions();
  const assistant = useAssistantPanel();
  const appSettings = useAppSettings();

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

  // Persist newly-committed candidate finals to the active session.
  const persistedDisplayRef = useRef('');
  useEffect(() => {
    const displayFinal = transcripts.display.finalText;
    const activeId = sessions.activeId;
    if (!activeId || !displayFinal || displayFinal === persistedDisplayRef.current) {
      return;
    }
    // Append only the delta committed since the last persisted final.
    const prior = persistedDisplayRef.current;
    const delta = displayFinal.startsWith(prior)
      ? displayFinal.slice(prior.length).trim()
      : displayFinal;
    persistedDisplayRef.current = displayFinal;
    if (delta) {
      void sessions.appendMessage(activeId, 'candidate', delta);
    }
  }, [transcripts.display.finalText, sessions]);

  // Persist each AI follow-up question to the active session.
  const persistedResultRef = useRef<string | null>(null);
  useEffect(() => {
    const activeId = sessions.activeId;
    if (!activeId || !lastResult) {
      return;
    }
    if (lastResult.requestId === persistedResultRef.current) {
      return;
    }
    persistedResultRef.current = lastResult.requestId;
    const question = lastResult.output.primary_question;
    if (question) {
      void sessions.appendMessage(activeId, 'assistant', question);
    }
  }, [lastResult, sessions]);

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
      if (sessions.activeId) {
        void sessions.patch(sessions.activeId, { jobDescription });
      }
    },
    [pushConfig, sessions]
  );

  const onResumeTextChange = useCallback(
    (resumeText: string): void => {
      setConfig((prev) => ({ ...prev, resumeText }));
      pushConfig({ resumeText });
      if (sessions.activeId) {
        void sessions.patch(sessions.activeId, { resumeText });
      }
    },
    [pushConfig, sessions]
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

  // ── Topbar assistant actions ───────────────────────────────────────────────
  // Build the running transcript text (both lanes, finals only) for notes/insights.
  const transcriptText = useMemo(() => {
    const lines: string[] = [];
    if (transcripts.display.finalText) {
      lines.push(`Candidate: ${transcripts.display.finalText}`);
    }
    if (transcripts.mic.finalText) {
      lines.push(`Interviewer: ${transcripts.mic.finalText}`);
    }
    return lines.join('\n\n');
  }, [transcripts.display.finalText, transcripts.mic.finalText]);

  const onAskAi = useCallback((): void => {
    // Use the candidate-answer buffer as the prompt, grounded by the transcript.
    const prompt = answer.trim() || transcriptText.trim();
    if (prompt.length === 0) {
      void assistant.ask('Summarise the conversation so far and suggest a strong follow-up.', transcriptText);
      return;
    }
    void assistant.ask(prompt, transcriptText || undefined);
  }, [answer, transcriptText, assistant]);

  const onMeetingNotes = useCallback((): void => {
    void assistant.notes(transcriptText);
  }, [assistant, transcriptText]);

  const onInsights = useCallback((): void => {
    void assistant.insights(transcriptText);
  }, [assistant, transcriptText]);

  // ── Session lifecycle ──────────────────────────────────────────────────────
  const onNewInterview = useCallback((): void => {
    setTypePickerOpen(true);
  }, []);

  const onPickInterviewType = useCallback(
    async (choice: InterviewTypeChoice): Promise<void> => {
      setTypePickerOpen(false);
      const sample = choice.sample;
      const title = sample ? sample.name : 'New interview';
      const id = await sessions.create({ title, interviewType: choice.interviewType });

      // Reset the live buffers for the fresh session.
      onClearSession();
      persistedDisplayRef.current = '';
      persistedResultRef.current = null;

      // Seed the shell from the sample (or clear) and push to the server + session.
      const jd = sample ? sample.jd : '';
      const resumeText = sample ? sample.resume : '';
      setConfig((prev) => ({ ...prev, jobDescription: jd, resumeText }));
      pushConfig({ jobDescription: jd, resumeText });
      if (id) {
        void sessions.patch(id, { jobDescription: jd, resumeText });
      }
      if (sample) {
        const seeded = sampleTranscriptText(sample);
        setAnswer(seeded);
      }
    },
    [sessions, onClearSession, pushConfig]
  );

  const onSelectSession = useCallback(
    async (id: string): Promise<void> => {
      sessions.select(id);
      const detail = await sessions.load(id);
      if (!detail) {
        return;
      }
      // Hydrate the shell: JD + résumé to the server, messages into the buffer.
      setConfig((prev) => ({
        ...prev,
        jobDescription: detail.jobDescription,
        resumeText: detail.resumeText
      }));
      pushConfig({ jobDescription: detail.jobDescription, resumeText: detail.resumeText });

      // Reset live buffers, then replay the last candidate message into the
      // analyze buffer so Generate Q has something to work with.
      onClearSession();
      persistedDisplayRef.current = '';
      persistedResultRef.current = null;
      const lastCandidate = [...detail.messages]
        .reverse()
        .find((m) => m.role === 'candidate' || m.role === 'user');
      if (lastCandidate) {
        setAnswer(lastCandidate.text);
      }
    },
    [sessions, pushConfig, onClearSession]
  );

  const sessionTitle = useMemo(() => {
    if (view === 'bank') {
      return 'Question bank';
    }
    const active = sessions.sessions.find((s) => s.id === sessions.activeId);
    return active?.title || 'New interview';
  }, [view, sessions.sessions, sessions.activeId]);

  return (
    <div id="app" className="app-shell">
      <TitleBar railCollapsed={railCollapsed} onToggleRail={toggleRail} />

      <div className="layout">
        <Sidebar
          view={view}
          onSelectView={setView}
          onNewInterview={onNewInterview}
          onOpenSettings={() => setSettingsOpen(true)}
          sessions={sessions.sessions}
          activeId={sessions.activeId}
          onSelectSession={(id) => void onSelectSession(id)}
          onRenameSession={(id, title) => void sessions.rename(id, title)}
          onDeleteSession={(id) => void sessions.remove(id)}
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
                onAskAi={onAskAi}
                onMeetingNotes={onMeetingNotes}
                onInsights={onInsights}
                assistantBusy={assistant.busy}
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
          resumeChatResetKey={sessions.activeId}
        />
      </div>

      <ResultsPanel
        open={assistant.panel.open}
        title={assistant.panel.title}
        text={assistant.panel.text}
        loading={assistant.panel.loading}
        error={assistant.panel.error}
        onClose={assistant.close}
      />

      <InterviewTypeModal
        open={typePickerOpen}
        onClose={() => setTypePickerOpen(false)}
        onPick={(choice) => void onPickInterviewType(choice)}
      />

      <SettingsModal
        open={settingsOpen}
        mode={config.mode}
        outputLanguage={config.outputLanguage}
        settings={appSettings.settings}
        onClose={() => setSettingsOpen(false)}
        onModeChange={onModeChange}
        onLanguageChange={onLanguageChange}
        onAiModelChange={appSettings.setAiModel}
        onAsrProviderChange={appSettings.setAsrProvider}
        onOpacityChange={appSettings.setOpacityStep}
      />
    </div>
  );
}
