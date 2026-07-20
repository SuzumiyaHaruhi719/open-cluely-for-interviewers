import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AsrProvider, SessionConfig } from '@open-cluely/contract';
import { useCopilotSocket } from '../lib/useCopilotSocket';
import { QuestionBank } from '../views/QuestionBank';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { TranscriptStream, type TranscriptMessage } from './TranscriptStream';
import { Composer } from './Composer';
import { RightRail } from './RightRail';
import { SettingsModal } from './SettingsModal';
import { InterviewTypeModal, type InterviewType, type InterviewTypeChoice } from './InterviewTypeModal';
import { ResultsPanel } from './ResultsPanel';
import { SummaryModal } from './SummaryModal';
import { SpotlightTour } from './SpotlightTour';
import { useRailCollapsed } from './useRailCollapsed';
import { useAssistantPanel } from './useAssistantPanel';
import { useAppSettings, type UserAsrProvider } from './useAppSettings';
import { formatTimer } from './helpers';
import { JOB_PROFILES } from './jobProfiles';
import { SIM_SCENARIOS } from './simScenarios';
import type { AppView } from './types';

interface ConfigState {
  jobDescription: string;
  resumeText: string;
  /** Evidence-oriented scorecard supplied as Expert context, never as a prompt. */
  interviewGuide: string[];
  /**
   * Interview format from the loaded/created session. 'offline' uses one room
   * microphone plus automatic speaker-role partitioning; 'online' keeps two lanes.
   */
  interviewType: InterviewType;
}

const INITIAL_CONFIG: ConfigState = {
  jobDescription: '',
  resumeText: '',
  interviewGuide: [],
  interviewType: 'online'
};

/** Product policy: one truthful realtime path, independent from user preferences. */
const EXPERT_CONFIG = {
  mode: 'expert',
  interviewerModel: 'deepseek-v4-flash',
  outputLanguage: 'zh'
} as const;

function normalizeAsrProvider(value: string): AsrProvider {
  if (value === 'volc' || value === 'xfyun' || value === 'paraformer' || value === 'sim') return value;
  return 'xfyun';
}

function simScriptFor(provider: AsrProvider): SessionConfig['simScript'] | undefined {
  return provider === 'sim' ? SIM_SCENARIOS[0]?.turns : undefined;
}

/**
 * The re-skinned app shell. Reproduces the desktop `renderer.html` structure
 * (`.app-shell` > `.titlebar` + `.layout`(`.sidebar`,`.main`,`.right-rail`) +
 * the settings modal) and wires the existing `useCopilotSocket` hook into it.
 *
 * Interviews are EPHEMERAL: nothing persists across reload. On mount the
 * interview-type picker opens for a fresh in-memory interview; "New interview"
 * resets all live state and re-opens the picker. Also wired here: the résumé
 * upload/chat rail, notes/insights actions, and the compact environment-backed
 * audio/model preferences.
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
  const [view, setView] = useState<AppView>('copilot');
  const [config, setConfig] = useState<ConfigState>(INITIAL_CONFIG);
  const [answer, setAnswer] = useState('');
  // Local notes rendered before live socket transcript lines. Cleared only for a
  // genuinely new interview / explicit clear, not when audio capture stops.
  const [transcriptMessages, setTranscriptMessages] = useState<TranscriptMessage[]>([]);
  const [clientSummaryTranscript, setClientSummaryTranscript] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourReplayToken, setTourReplayToken] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  // Topbar title for the current in-memory interview.
  const [interviewTitle, setInterviewTitle] = useState('新面试');
  const [autoScroll, setAutoScroll] = useState(true);
  const [railCollapsed, toggleRail] = useRailCollapsed();
  // Transient "已选用" confirmation shown after picking a ranked candidate. Holds
  // the chosen text; cleared on a timer so it doesn't linger past the next turn.
  const [pickedHint, setPickedHint] = useState<string | null>(null);
  const pickedHintTimerRef = useRef<number | null>(null);

  const assistant = useAssistantPanel();

  const isReady = status === 'open';
  const capturing = audio.display.capturing || audio.mic.capturing;
  // Browser capture and cloud recognition are separate lifecycles. Keep the
  // timer/settings lock tied to the local graph, but show global “实时” only
  // when at least one captured lane is actually recognized by its provider.
  const recognitionLive = (['display', 'mic'] as const).some((source) => {
    const lane = audio[source];
    return lane.capturing && (lane.runtimeState === 'live' || lane.runtimeState === undefined);
  });
  // The Generate Q button's `disabled` must NOT depend on `isAnalyzing`. Toggling
  // the native `disabled` on the *focused* button blurs it (focus jumps to <body>)
  // and the click landing the instant it flips to disabled is silently eaten — the
  // "点了浏览器会失焦 / 要点很多次才能点动" bug, made constant when Auto fires. `onAnalyze`
  // already guards `isAnalyzing` (no double-fire), so keep the button enabled and
  // focusable and gate only on the STABLE ready + has-text conditions.
  const canAnalyze = isReady && answer.trim().length > 0;
  // Offline controls capture layout only; semantic role partitioning is enabled
  // for both formats because a shared online stream can contain both voices.
  const offline = config.interviewType === 'offline';

  // Mirror the desktop: when the candidate (display) lane produces new FINAL
  // text, fill the analyze buffer. Only react to growth so manual notes between
  // turns are preserved.
  const lastDisplayFinalRef = useRef('');
  useEffect(() => {
    // Feed the manual Generate Q buffer (`answer`) with the candidate's latest
    // words. Whenever diarized speakerSegments exist, the candidate is identified
    // by ROLE, not by lane — this covers OFFLINE single-mic partitioning AND ONLINE
    // iFlytek (讯飞), which carries its own speaker id on finals. Use the
    // candidate-labeled segment text so the buffer fills once the interviewer taps
    // 候选人 ("使用讯飞的时候也要能点候选人"); without this, online iFlytek fed only
    // from the empty 'display' lane and Generate Q stayed disabled all interview.
    // OFFLINE additionally falls back to the raw room-mic transcript before any
    // speaker is labelled. PURE ONLINE with a non-diarizing provider
    // (paraformer/volc) has no segments → keep feeding from the 'display' lane.
    let next = '';
    if (speakerSegments.length) {
      const candidateText = speakerSegments
        .filter((s) => s.role === 'candidate')
        .map((s) => s.text)
        .join(' ')
        .trim();
      next = candidateText || (offline ? transcripts.mic.finalText.trim() : '');
    } else if (offline) {
      next = transcripts.mic.finalText.trim();
    } else {
      next = transcripts.display.finalText;
    }
    if (next && next !== lastDisplayFinalRef.current) {
      lastDisplayFinalRef.current = next;
      setAnswer(next);
    }
  }, [offline, transcripts.display.finalText, transcripts.mic.finalText, speakerSegments]);

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

  // Toggle autonomous question generation: persist locally AND tell the server so
  // its trigger monitor starts/stops. The full-config re-push (above) carries
  // `autoGenerate` on every new sessionId, so this delta is enough for the live one.
  const { setAutoGenerate } = appSettings;
  const onAutoGenerateChange = useCallback(
    (enabled: boolean): void => {
      setAutoGenerate(enabled);
      pushConfig({ autoGenerate: enabled });
    },
    [setAutoGenerate, pushConfig]
  );
  const onToggleAuto = useCallback((): void => {
    onAutoGenerateChange(!appSettings.settings.autoGenerate);
  }, [appSettings.settings.autoGenerate, onAutoGenerateChange]);

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

  // Ctrl/Cmd+B toggles the right rail (parity with the desktop app). Ignored when
  // a modifier combo other than Ctrl/Cmd is held, and when focus is in an editable
  // field so it never hijacks normal text entry.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase() ?? '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        toggleRail();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleRail]);

  const onReplayTour = useCallback((): void => {
    setSettingsOpen(false);
    setTourReplayToken((token) => token + 1);
  }, []);

  // "?" (Shift+/) — replay the mounted spotlight tour without destroying the
  // current interview. Ignore form fields so normal text entry is never hijacked.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        onReplayTour();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onReplayTour]);

  // Credentials are environment-owned. The renderer sends only the provider name
  // so changing engines cannot leak or shadow deployment configuration.
  const { setAsrProvider } = appSettings;
  const onAsrProviderChange = useCallback(
    (value: UserAsrProvider): void => {
      const provider = normalizeAsrProvider(value);
      setAsrProvider(value);
      pushConfig({
        asrProvider: provider,
        simScript: simScriptFor(provider)
      });
    },
    [pushConfig, setAsrProvider]
  );

  const onStartAudio = useCallback(
    (source: Parameters<typeof startAudio>[0]): Promise<void> =>
      startAudio(source, { skipLocalCapture: appSettings.settings.asrProvider === 'sim' }),
    [startAudio, appSettings.settings.asrProvider]
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

  // ── Re-push the FULL config on every new server session (connect + reconnect) ─
  // Every new/reconnected server session receives one complete, truthful product
  // policy. JD and résumé remain context; they never become a separate prompt mode.
  const fullConfigRef = useRef<Partial<SessionConfig>>({});
  useEffect(() => {
    const s = appSettings.settings;
    fullConfigRef.current = {
      ...EXPERT_CONFIG,
      jobDescription: config.jobDescription,
      resumeText: config.resumeText,
      interviewGuide: config.interviewGuide,
      asrProvider: normalizeAsrProvider(s.asrProvider),
      simScript: simScriptFor(normalizeAsrProvider(s.asrProvider)),
      // A shared tab/window may carry both interviewer and candidate voices.
      // Keep semantic role partitioning enabled in online and room-mic modes;
      // capture routing is still controlled separately by `offline`.
      diarize: true,
      autoGenerate: s.autoGenerate,
      // Product policy: one evidence-aware quiet-period trigger. Legacy interval
      // wire support remains server-side only for older clients.
      autoMode: 'agent',
      summaryModel: s.summaryModel
    };
  }, [config, offline, appSettings.settings]);
  useEffect(() => {
    if (socket.sessionId) {
      sendConfigure(fullConfigRef.current);
    }
    // Re-push when the interview format flips so capture/context policy stays current.
  }, [socket.sessionId, offline, sendConfigure]);

  const onAnalyze = useCallback((): void => {
    const trimmed = answer.trim();
    if (!isReady || isAnalyzing || trimmed.length === 0) {
      return;
    }
    analyze(trimmed);
  }, [answer, isReady, isAnalyzing, analyze]);

  // "Add a note to the context": (1) feed the manual analyze buffer (Generate Q
  // button), (2) send it to the server so the AUTONOMOUS trigger's candidate context
  // includes it too — otherwise auto-generation never sees a manual note, (3) show it
  // in the stream as a Note line so the interviewer sees it landed.
  const onAddNote = useCallback(
    (note: string): void => {
      setAnswer((prev) => (prev.trim().length === 0 ? note : `${prev.trim()} ${note}`));
      addContextNote(note);
      setTranscriptMessages((prev) => [...prev, { role: 'note', text: note }]);
    },
    [addContextNote]
  );

  const onClearSession = useCallback((): void => {
    pushConfig({ resetGeneration: true });
    setAnswer('');
    setTranscriptMessages([]);
    setClientSummaryTranscript('');
    lastDisplayFinalRef.current = '';
    resetSpeakerSegments();
    resetTranscripts();
  }, [pushConfig, resetSpeakerSegments, resetTranscripts]);

  // ── Topbar assistant actions ───────────────────────────────────────────────
  // Build the running transcript text (both lanes, finals only) for notes/insights.
  const transcriptText = useMemo(() => {
    const lines: string[] = [];
    if (transcripts.display.finalText) {
      lines.push(`候选人：${transcripts.display.finalText}`);
    }
    if (transcripts.mic.finalText) {
      lines.push(`面试官：${transcripts.mic.finalText}`);
    }
    return lines.join('\n\n');
  }, [transcripts.display.finalText, transcripts.mic.finalText]);

  const onMeetingNotes = useCallback((): void => {
    void assistant.notes(transcriptText);
  }, [assistant, transcriptText]);

  const onInsights = useCallback((): void => {
    void assistant.insights(transcriptText);
  }, [assistant, transcriptText]);

  // ── Interview summary (DeepSeek v4 pro) ─────────────────────────────────────
  // Open the modal AND kick off a fresh summary. The server builds the report from
  // its own accumulated transcript (both lanes) + JD/résumé — no payload needed
  // from the client beyond the requestId startSummary mints.
  const onSummarize = useCallback((): void => {
    setSummaryOpen(true);
    startSummary(clientSummaryTranscript);
  }, [clientSummaryTranscript, startSummary]);

  // ── Interview lifecycle (ephemeral — nothing persists across reload) ─────────
  // "New interview": reset all in-memory state and re-open the type picker.
  const onNewInterview = useCallback((): void => {
    onClearSession();
    setInterviewTitle('新面试');
    setTypePickerOpen(true);
  }, [onClearSession]);

  // Starting from the reviewed modal resets live state, applies capture routing,
  // and sends the selected JD + scorecard as Expert context. No prompt is authored
  // and no session is persisted.
  const onPickInterviewType = useCallback(
    (choice: InterviewTypeChoice): void => {
      setTypePickerOpen(false);
      const profile = JOB_PROFILES.find((item) => item.id === choice.jobProfileId);
      setInterviewTitle(profile ? `${profile.title}面试` : '自定义职位面试');

      // Reset the live buffers for the fresh interview.
      onClearSession();

      setConfig((prev) => ({
        ...prev,
        jobDescription: choice.jobDescription,
        resumeText: '',
        interviewGuide: choice.interviewGuide,
        interviewType: choice.interviewType
      }));
      pushConfig({
        jobDescription: choice.jobDescription,
        resumeText: '',
        interviewGuide: choice.interviewGuide,
        diarize: true
      });
    },
    [onClearSession, pushConfig]
  );

  // On mount: land directly on the main interview screen.
  // The type picker opens only when the user clicks "新建面试".
  // (Previously this auto-opened the modal on mount, blocking the main UI.)

  const sessionTitle = view === 'bank' ? '题库' : interviewTitle;

  return (
    <div id="app" className="app-shell">
      <TitleBar railCollapsed={railCollapsed} onToggleRail={toggleRail} />

      <div className="layout">
        <Sidebar
          view={view}
          onSelectView={setView}
          onNewInterview={onNewInterview}
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
                mode="expert"
                asrProvider={appSettings.settings.asrProvider}
                status={status}
                capturing={recognitionLive}
                timer={timer}
                isLive={recognitionLive}
                screenshotCount={0}
                canAnalyze={canAnalyze}
                isAnalyzing={isAnalyzing}
                onAnalyze={onAnalyze}
                onClearSession={onClearSession}
                onSummarize={onSummarize}
                onMeetingNotes={onMeetingNotes}
                onInsights={onInsights}
                assistantBusy={assistant.busy}
                autoGenerate={appSettings.settings.autoGenerate}
                onToggleAuto={onToggleAuto}
              />
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
                autoScroll={autoScroll}
                pickedHint={pickedHint}
                onPickCandidate={onPickCandidate}
                offline={offline}
                speakerSegments={speakerSegments}
                onSetSpeakerRole={setSpeakerRole}
                autoGenerate={appSettings.settings.autoGenerate}
                capturing={recognitionLive}
                lastAutoFireAt={lastAutoFireAt}
              />
              <Composer
                audio={audio}
                disabled={!isReady}
                autoScroll={autoScroll}
                onToggleAutoScroll={() => setAutoScroll((on) => !on)}
                onStartAudio={onStartAudio}
                onStopAudio={stopAudio}
                micDeviceId={appSettings.settings.micDeviceId}
                onMicDeviceChange={appSettings.setMicDeviceId}
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
          sessionContext={sessionContext}
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

      <SummaryModal
        open={summaryOpen}
        summary={summary}
        onRegenerate={startSummary}
        onClose={() => setSummaryOpen(false)}
      />

      <InterviewTypeModal
        open={typePickerOpen}
        onClose={() => setTypePickerOpen(false)}
        onPick={(choice) => void onPickInterviewType(choice)}
      />

      <SettingsModal
        open={settingsOpen}
        settings={appSettings.settings}
        onClose={() => setSettingsOpen(false)}
        onSummaryModelChange={(value) => {
          appSettings.setSummaryModel(value);
          pushConfig({ summaryModel: value });
        }}
        onAsrProviderChange={onAsrProviderChange}
        onMicDeviceChange={appSettings.setMicDeviceId}
        micDeviceDisabled={capturing}
        onAutoGenerateChange={onAutoGenerateChange}
      />

      <SpotlightTour replayToken={tourReplayToken} />
    </div>
  );
}
