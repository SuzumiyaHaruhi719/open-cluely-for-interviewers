import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InterviewerMode, OutputLanguage, SessionConfig } from '@open-cluely/contract';
import { useCopilotSocket } from '../lib/useCopilotSocket';
import { QuestionBank } from '../views/QuestionBank';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { TranscriptStream, type TranscriptMessage, type TranscriptRole } from './TranscriptStream';
import { Composer } from './Composer';
import { RightRail } from './RightRail';
import { SettingsModal } from './SettingsModal';
import { InterviewTypeModal, type InterviewType, type InterviewTypeChoice } from './InterviewTypeModal';
import { ResultsPanel } from './ResultsPanel';
import { PipelineStudio } from './studio/PipelineStudio';
import { useRailCollapsed } from './useRailCollapsed';
import { useSessions } from './useSessions';
import { useAssistantPanel } from './useAssistantPanel';
import { useAppSettings, type VolcSettings } from './useAppSettings';
import type { AsrProvider } from '@open-cluely/contract';
import { formatTimer } from './helpers';
import { sampleTranscriptText } from './interviewSamples';
import type { AppView } from './types';

interface ConfigState {
  mode: InterviewerMode;
  outputLanguage: OutputLanguage;
  jobDescription: string;
  resumeText: string;
  /** Customize mode: the saved pipeline the session runs (null = Expert fallback). */
  activePipelineId: string | null;
  /**
   * Interview format from the loaded/created session. 'offline' routes ASR to
   * FunASR (single room mic + diarization); 'online' keeps the dual-lane flow.
   */
  interviewType: InterviewType;
}

const INITIAL_CONFIG: ConfigState = {
  mode: 'expert',
  outputLanguage: '',
  jobDescription: '',
  resumeText: '',
  activePipelineId: null,
  interviewType: 'online'
};

/** Coerce a persisted session's interviewType string onto the union (default online). */
function asInterviewType(value: string): InterviewType {
  return value === 'offline' ? 'offline' : 'online';
}

/**
 * Map a persisted session message role onto a transcript-stream lane. Persisted
 * roles are 'candidate' | 'interviewer' | 'ai' | 'note' | 'user' | 'assistant';
 * 'user' → candidate, 'assistant'/'ai' → ai, 'note' → skipped (returns null).
 */
function mapMessageRole(role: string): TranscriptRole | null {
  switch (role) {
    case 'candidate':
    case 'user':
      return 'candidate';
    case 'interviewer':
      return 'interviewer';
    case 'ai':
    case 'assistant':
      return 'ai';
    default:
      // 'note' and any unknown role have no lane — skip them.
      return null;
  }
}

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
    progressTokens,
    isAnalyzing,
    error,
    transcripts,
    audio,
    startAudio,
    stopAudio,
    speakerSegments,
    setSpeakerRole
  } = socket;

  const [view, setView] = useState<AppView>('copilot');
  const [config, setConfig] = useState<ConfigState>(INITIAL_CONFIG);
  const [answer, setAnswer] = useState('');
  // Seeded (sample) or loaded (session) conversation, rendered as chat lines in
  // the transcript stream BEFORE any live socket transcript. Cleared on new/clear.
  const [transcriptMessages, setTranscriptMessages] = useState<TranscriptMessage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [railCollapsed, toggleRail] = useRailCollapsed();
  // Transient "已选用" confirmation shown after picking a ranked candidate. Holds
  // the chosen text; cleared on a timer so it doesn't linger past the next turn.
  const [pickedHint, setPickedHint] = useState<string | null>(null);
  const pickedHintTimerRef = useRef<number | null>(null);

  const sessions = useSessions();
  const assistant = useAssistantPanel();
  const appSettings = useAppSettings();
  // Guards the one-time "restore the persisted active session on mount" effect.
  // Any user session action (new interview / explicit select) sets it true so the
  // auto-restore can't clobber a freshly-seeded or just-selected conversation.
  const hydratedRef = useRef(false);

  const isReady = status === 'open';
  const capturing = audio.display.capturing || audio.mic.capturing;
  const canAnalyze = isReady && !isAnalyzing && answer.trim().length > 0;
  // Offline (single-mic) interview: routes ASR to FunASR + diarized bubbles.
  const offline = config.interviewType === 'offline';

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
      void sessions.appendMessage(activeId, 'ai', question);
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

  // Toggle autonomous question generation: persist locally AND tell the server so
  // its trigger monitor starts/stops. The full-config re-push (above) carries
  // `autoGenerate` on every new sessionId, so this delta is enough for the live one.
  const { setAutoGenerate } = appSettings;
  const onToggleAuto = useCallback((): void => {
    const next = !appSettings.settings.autoGenerate;
    setAutoGenerate(next);
    pushConfig({ autoGenerate: next });
  }, [appSettings.settings.autoGenerate, setAutoGenerate, pushConfig]);

  // Promote a ranked candidate: copy it into the analyze buffer (so Generate Q /
  // the next analyze uses it) and flash a brief "已选用" confirmation. No server
  // round-trip — picking is a purely local selection.
  const onPickCandidate = useCallback((question: string): void => {
    setAnswer(question);
    setPickedHint(question);
    if (pickedHintTimerRef.current !== null) {
      window.clearTimeout(pickedHintTimerRef.current);
    }
    pickedHintTimerRef.current = window.setTimeout(() => {
      setPickedHint(null);
      pickedHintTimerRef.current = null;
    }, 2600);
  }, []);

  // Clear any pending "已选用" hint timer on unmount.
  useEffect(() => {
    return () => {
      if (pickedHintTimerRef.current !== null) {
        window.clearTimeout(pickedHintTimerRef.current);
      }
    };
  }, []);

  // ASR provider / Doubao creds → persist locally AND push to the server so the
  // NEXT audio-control start uses the chosen recognizer. We always send the Volc
  // creds alongside the provider so flipping to Doubao (or editing a cred while
  // already on Doubao) carries everything in one configure message. Creds are
  // sensitive: localStorage matches the desktop's local-store behaviour, and the
  // server (not the browser) makes the Volc connection and never logs them.
  const { setAsrProvider, setVolcSettings } = appSettings;
  const onAsrProviderChange = useCallback(
    (value: string): void => {
      const provider: AsrProvider = value === 'volc' ? 'volc' : 'paraformer';
      setAsrProvider(value);
      const s = appSettings.settings;
      pushConfig({
        asrProvider: provider,
        volcAppId: s.volcAppId,
        volcAccessToken: s.volcAccessToken,
        volcResourceId: s.volcResourceId,
        volcModel: s.volcModel
      });
    },
    [pushConfig, setAsrProvider, appSettings.settings]
  );

  const onVolcSettingsChange = useCallback(
    (patch: Partial<VolcSettings>): void => {
      setVolcSettings(patch);
      // Merge the patch over current settings for the push (state updates async).
      const s = { ...appSettings.settings, ...patch };
      pushConfig({
        asrProvider: 'volc',
        volcAppId: s.volcAppId,
        volcAccessToken: s.volcAccessToken,
        volcResourceId: s.volcResourceId,
        volcModel: s.volcModel
      });
    },
    [pushConfig, setVolcSettings, appSettings.settings]
  );

  // Open the node editor (from the Customize section in Settings). Close Settings
  // so the full-window studio overlay isn't competing with the modal.
  const onOpenStudio = useCallback((): void => {
    setSettingsOpen(false);
    setStudioOpen(true);
  }, []);

  // "Use this" in the Studio: flip the live session to Customize running the saved
  // pipeline. One configure carries both so the server never runs with a stale id.
  const onUseCustomPipeline = useCallback(
    (id: string): void => {
      setConfig((prev) => ({ ...prev, mode: 'customize', activePipelineId: id }));
      pushConfig({ mode: 'customize', activePipelineId: id });
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

  // ── Re-push the FULL config on every new server session (connect + reconnect) ─
  // The server spins up a fresh headless session (default mode 'fast') per WS
  // connection, identified by a new sessionId. The per-change pushConfig calls
  // only send deltas — so a fresh OR reconnected session silently ran Fast even
  // when the UI showed Expert (and lost JD/résumé/Customize/ASR on reconnect).
  // Keep the latest full config in a ref and resend it whenever a new sessionId
  // arrives. This is the fix for "selected Expert but the progress shows fast".
  const fullConfigRef = useRef<Partial<SessionConfig>>({});
  useEffect(() => {
    const s = appSettings.settings;
    fullConfigRef.current = {
      mode: config.mode,
      outputLanguage: config.outputLanguage,
      jobDescription: config.jobDescription,
      resumeText: config.resumeText,
      activePipelineId: config.activePipelineId,
      // Offline (single-mic) interviews route to FunASR (streaming-SPK
      // diarization) and carry the FunASR WS URL. Online keeps the existing
      // provider choice (volc when selected, else the default Paraformer relay).
      // The volc creds are always included so flipping back online with Doubao
      // selected re-applies them on the next audio start.
      asrProvider: offline ? 'funasr' : s.asrProvider === 'volc' ? 'volc' : 'paraformer',
      funasrUrl: s.funasrUrl,
      volcAppId: s.volcAppId,
      volcAccessToken: s.volcAccessToken,
      volcResourceId: s.volcResourceId,
      volcModel: s.volcModel,
      // Part of the full config: re-push so a fresh/reconnected server session
      // honours the auto-generate choice (the monitor is off until told on).
      autoGenerate: s.autoGenerate
    };
  }, [config, offline, appSettings.settings]);
  useEffect(() => {
    if (socket.sessionId) {
      sendConfigure(fullConfigRef.current);
    }
  }, [socket.sessionId, sendConfigure]);

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
    setTranscriptMessages([]);
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
      hydratedRef.current = true; // user-created session — skip the mount auto-restore
      const sample = choice.sample;
      const title = sample ? sample.name : 'New interview';
      const id = await sessions.create({ title, interviewType: choice.interviewType });

      // Reset the live buffers for the fresh session.
      onClearSession();
      persistedDisplayRef.current = '';
      persistedResultRef.current = null;

      // Seed the shell from the sample (or clear) and push to the server + session.
      // interviewType drives offline (FunASR single-mic) vs online routing.
      const jd = sample ? sample.jd : '';
      const resumeText = sample ? sample.resume : '';
      setConfig((prev) => ({
        ...prev,
        jobDescription: jd,
        resumeText,
        interviewType: choice.interviewType
      }));
      pushConfig({ jobDescription: jd, resumeText });
      if (id) {
        void sessions.patch(id, { jobDescription: jd, resumeText });
      }
      if (sample) {
        // Render the whole sample conversation as chat lines…
        setTranscriptMessages(
          sample.turns.map((turn) => ({
            role: turn.speaker === 'interviewer' ? 'interviewer' : 'candidate',
            text: turn.text
          }))
        );
        // …and seed the analyze buffer with the LAST candidate turn so Generate Q
        // has the most-recent answer to follow up on (falls back to the flattened
        // transcript if the sample has no candidate turn).
        const lastCandidate = [...sample.turns]
          .reverse()
          .find((turn) => turn.speaker === 'candidate');
        setAnswer(lastCandidate ? lastCandidate.text : sampleTranscriptText(sample));
        // Persist the seeded turns to the session so they survive a page refresh
        // (rehydrate-on-mount replays session.messages). Sequential awaits avoid
        // racing the server's read-modify-write message store.
        if (id) {
          for (const turn of sample.turns) {
            await sessions.appendMessage(
              id,
              turn.speaker === 'interviewer' ? 'interviewer' : 'candidate',
              turn.text
            );
          }
        }
      }
    },
    [sessions, onClearSession, pushConfig]
  );

  const onSelectSession = useCallback(
    async (id: string): Promise<void> => {
      hydratedRef.current = true;
      sessions.select(id);
      const detail = await sessions.load(id);
      if (!detail) {
        return;
      }
      // Hydrate the shell: JD + résumé to the server, messages into the buffer.
      // interviewType comes back on the detail — restore offline/online routing.
      setConfig((prev) => ({
        ...prev,
        jobDescription: detail.jobDescription,
        resumeText: detail.resumeText,
        interviewType: asInterviewType(detail.interviewType)
      }));
      pushConfig({ jobDescription: detail.jobDescription, resumeText: detail.resumeText });

      // Reset live buffers (also clears seeded messages), then hydrate the chat
      // stream from the saved messages and replay the last candidate message into
      // the analyze buffer so Generate Q has something to work with.
      onClearSession();
      persistedDisplayRef.current = '';
      persistedResultRef.current = null;
      const replayed: TranscriptMessage[] = [];
      for (const m of detail.messages) {
        const role = mapMessageRole(m.role);
        if (role) {
          replayed.push({ role, text: m.text });
        }
      }
      setTranscriptMessages(replayed);
      const lastCandidate = [...detail.messages]
        .reverse()
        .find((m) => m.role === 'candidate' || m.role === 'user');
      if (lastCandidate) {
        setAnswer(lastCandidate.text);
      }
    },
    [sessions, pushConfig, onClearSession]
  );

  // ── Rehydrate the active session on mount (survive a page refresh) ───────────
  // useSessions persists the active id to localStorage, but the transcript lives
  // in memory and is lost on reload. Once on mount, load the persisted session and
  // replay its saved messages into the stream so the conversation isn't lost.
  useEffect(() => {
    if (hydratedRef.current || !sessions.activeId) {
      return;
    }
    hydratedRef.current = true;
    void onSelectSession(sessions.activeId);
  }, [sessions.activeId, onSelectSession]);

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
                asrProvider={appSettings.settings.asrProvider}
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
                autoGenerate={appSettings.settings.autoGenerate}
                onToggleAuto={onToggleAuto}
              />
              <TranscriptStream
                transcripts={transcripts}
                transcriptMessages={transcriptMessages}
                lastResult={lastResult}
                progress={progress}
                progressTokens={progressTokens}
                isAnalyzing={isAnalyzing}
                error={error}
                autoScroll={autoScroll}
                pickedHint={pickedHint}
                onPickCandidate={onPickCandidate}
                offline={offline}
                speakerSegments={speakerSegments}
                onSetSpeakerRole={setSpeakerRole}
              />
              <Composer
                audio={audio}
                disabled={!isReady}
                autoScroll={autoScroll}
                onToggleAutoScroll={() => setAutoScroll((on) => !on)}
                onStartAudio={startAudio}
                onStopAudio={stopAudio}
                onAddNote={onAddNote}
                offline={offline}
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
        activePipelineId={config.activePipelineId}
        onClose={() => setSettingsOpen(false)}
        onModeChange={onModeChange}
        onLanguageChange={onLanguageChange}
        onAiModelChange={appSettings.setAiModel}
        onAsrProviderChange={onAsrProviderChange}
        onVolcSettingsChange={onVolcSettingsChange}
        onFunasrUrlChange={appSettings.setFunasrUrl}
        onOpacityChange={appSettings.setOpacityStep}
        onSelectPipeline={onUseCustomPipeline}
        onOpenStudio={onOpenStudio}
      />

      <PipelineStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        onUse={(id) => onUseCustomPipeline(id)}
      />
    </div>
  );
}
