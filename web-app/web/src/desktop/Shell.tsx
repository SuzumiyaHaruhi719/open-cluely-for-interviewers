import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InterviewerMode, OutputLanguage, SessionConfig } from '@open-cluely/contract';
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
import { PipelineStudio } from './studio/PipelineStudio';
import { SpotlightTour } from './SpotlightTour';
import { useRailCollapsed } from './useRailCollapsed';
import { useAssistantPanel } from './useAssistantPanel';
import { useAppSettings, type VolcSettings } from './useAppSettings';
import type { AsrProvider } from '@open-cluely/contract';
import { formatTimer } from './helpers';
import { sampleTranscriptText } from './interviewSamples';
import { SIM_SCENARIOS } from './simScenarios';
import type { AppView } from './types';

interface ConfigState {
  mode: InterviewerMode;
  outputLanguage: OutputLanguage;
  jobDescription: string;
  resumeText: string;
  /** Customize mode: the saved pipeline the session runs (null = Expert fallback). */
  activePipelineId: string | null;
  /**
   * Interview format from the loaded/created session. 'offline' uses one room
   * microphone plus automatic speaker-role partitioning; 'online' keeps two lanes.
   */
  interviewType: InterviewType;
}

const INITIAL_CONFIG: ConfigState = {
  mode: 'expert',
  outputLanguage: 'zh',
  jobDescription: '',
  resumeText: '',
  activePipelineId: null,
  interviewType: 'online'
};

function normalizeAsrProvider(value: string): AsrProvider {
  if (value === 'volc' || value === 'xfyun' || value === 'sim') return value;
  return 'paraformer';
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
 * upload/chat rail, the topbar assistant actions (Ask AI / notes / insights →
 * results panel), and the functional settings (opacity, mic enumerate,
 * model/provider persistence).
 */
export function Shell() {
  const socket = useCopilotSocket();
  const {
    status,
    sendConfigure,
    analyze,
    addContextNote,
    lastResult,
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

  const [view, setView] = useState<AppView>('copilot');
  const [config, setConfig] = useState<ConfigState>(INITIAL_CONFIG);
  const [answer, setAnswer] = useState('');
  // Seeded (sample) or loaded (session) conversation, rendered as chat lines in
  // the transcript stream BEFORE any live socket transcript. Cleared on new/clear.
  const [transcriptMessages, setTranscriptMessages] = useState<TranscriptMessage[]>([]);
  const [clientSummaryTranscript, setClientSummaryTranscript] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  // Topbar title for the current in-memory interview (sample name, else default).
  const [interviewTitle, setInterviewTitle] = useState('新面试');
  const [studioOpen, setStudioOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [railCollapsed, toggleRail] = useRailCollapsed();
  // Transient "已选用" confirmation shown after picking a ranked candidate. Holds
  // the chosen text; cleared on a timer so it doesn't linger past the next turn.
  const [pickedHint, setPickedHint] = useState<string | null>(null);
  const pickedHintTimerRef = useRef<number | null>(null);

  const assistant = useAssistantPanel();
  const appSettings = useAppSettings();

  const isReady = status === 'open';
  const capturing = audio.display.capturing || audio.mic.capturing;
  // The Generate Q button's `disabled` must NOT depend on `isAnalyzing`. Toggling
  // the native `disabled` on the *focused* button blurs it (focus jumps to <body>)
  // and the click landing the instant it flips to disabled is silently eaten — the
  // "点了浏览器会失焦 / 要点很多次才能点动" bug, made constant when Auto fires. `onAnalyze`
  // already guards `isAnalyzing` (no double-fire), so keep the button enabled and
  // focusable and gate only on the STABLE ready + has-text conditions.
  const canAnalyze = isReady && answer.trim().length > 0;
  // Offline (single-mic) interview: enables automatic speaker-role partitioning.
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

  // ── Auto-clear the candidate speech cache when the interview ENDS ────────────
  // "Interview ends" = the LAST active audio source is stopped (capture goes from
  // some-source-capturing → none). At that transition we clear the candidate
  // cache the same way "New interview" does: frontend speakerSegments + transcripts
  // + in-flight summary/context (resetSpeakerSegments/resetTranscripts) AND the
  // server-side candidate buffers via a resetGeneration configure (mirrors
  // onClearSession's pushConfig). A mere PARTIAL stop (another source still live)
  // does NOT clear. We track the previous capturing state so the clear fires once
  // per end transition and never repeats while idle (idempotent). The manual
  // "New interview" clear stays as-is.
  const wasCapturingRef = useRef(false);
  useEffect(() => {
    if (wasCapturingRef.current && !capturing) {
      // All sources just stopped → interview ended → clear the candidate cache.
      pushConfig({ resetGeneration: true });
      setAnswer('');
      setTranscriptMessages([]);
      lastDisplayFinalRef.current = '';
      resetSpeakerSegments();
      resetTranscripts();
    }
    wasCapturingRef.current = capturing;
  }, [capturing, pushConfig, resetSpeakerSegments, resetTranscripts]);

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

  // Autonomous follow-up trigger MODE: persist locally AND tell the server so its
  // monitor switches between the AI-decided ('agent') and fixed-30s ('interval')
  // cadence. The full-config re-push carries `autoMode` on every new sessionId, so
  // this delta is enough for the live one (mirrors onModeChange/onToggleAuto).
  const { setAutoMode } = appSettings;
  const onAutoModeChange = useCallback(
    (mode: 'agent' | 'interval'): void => {
      setAutoMode(mode);
      pushConfig({ autoMode: mode });
    },
    [setAutoMode, pushConfig]
  );

  // Interviewer-adjustable interval (cooldown) for interval mode: persist locally
  // AND push to the server as autoIntervalMs so its monitor uses the new cadence.
  // The full-config re-push carries autoIntervalMs on every new sessionId, so this
  // delta is enough for the live one (mirrors onAutoModeChange).
  const { setAutoIntervalSec } = appSettings;
  const onAutoIntervalChange = useCallback(
    (sec: number): void => {
      setAutoIntervalSec(sec);
      pushConfig({ autoIntervalMs: sec * 1000 });
    },
    [setAutoIntervalSec, pushConfig]
  );

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

  // "?" (Shift+/) — reset the spotlight tour and replay it. Mirrors the desktop
  // app: ignored inside form fields so normal text entry is never hijacked. The
  // tour reads its "have I shown already?" flag from localStorage on mount, so
  // clearing it + reload is the simplest reliable way to re-trigger SpotlightTour
  // (which is mounted once at the top of the shell).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        try { sessionStorage.removeItem('tour-shown-this-session'); } catch {}
        window.location.reload();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
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
      const provider = normalizeAsrProvider(value);
      setAsrProvider(value);
      const s = appSettings.settings;
      pushConfig({
        asrProvider: provider,
        simScript: simScriptFor(provider),
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
      interviewerModel: s.aiModel,
      outputLanguage: config.outputLanguage,
      jobDescription: config.jobDescription,
      resumeText: config.resumeText,
      activePipelineId: config.activePipelineId,
      // Both interview formats keep the selected text engine. Offline enables the
      // server's single-mic partition lifecycle; online keeps dual-lane routing.
      // The volc creds are always included so flipping back online with Doubao
      // selected re-applies them on the next audio start.
      // `diarize` is the wire-compatible single-room-mic partition flag.
      asrProvider: normalizeAsrProvider(s.asrProvider),
      simScript: simScriptFor(normalizeAsrProvider(s.asrProvider)),
      diarize: offline,
      volcAppId: s.volcAppId,
      volcAccessToken: s.volcAccessToken,
      volcResourceId: s.volcResourceId,
      volcModel: s.volcModel,
      // Part of the full config: re-push so a fresh/reconnected server session
      // honours the auto-generate choice (the monitor is off until told on).
      autoGenerate: s.autoGenerate,
      // Re-push the trigger mode too so a fresh/reconnected session uses the
      // chosen cadence (AI-decided 'agent' vs fixed-30s 'interval').
      autoMode: s.autoMode,
      // Re-push the interviewer-adjustable interval so a fresh/reconnected session
      // honours the chosen cooldown (only used when autoMode === 'interval').
      autoIntervalMs: s.autoIntervalSec * 1000,
      // Re-push the per-session summary model so a fresh/reconnected session uses
      // the user's chosen model for the next summarize call (Feature 2).
      summaryModel: s.summaryModel,
      // Re-push prompt mode + text (Feature 3) so a fresh/reconnected session
      // honours the user's prompt choice on the next summarize call.
      summaryPromptMode: s.summaryPromptMode,
      summaryPromptText: s.summaryPromptMode === 'custom' ? s.summaryPromptText : undefined
    };
  }, [config, offline, appSettings.settings]);
  useEffect(() => {
    if (socket.sessionId) {
      sendConfigure(fullConfigRef.current);
    }
    // Re-push the FULL config (which carries diarize=offline) whenever the mode
    // flips — not just on connect — or switching online<->offline mid-session
    // leaves the server's diarize flag stale (offline shows no speaker bubbles).
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

  const onAskAi = useCallback((): void => {
    // Use the candidate-answer buffer as the prompt, grounded by the transcript.
    const prompt = answer.trim() || transcriptText.trim();
    if (prompt.length === 0) {
      void assistant.ask('总结目前的对话，并建议一个有力的追问。', transcriptText);
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

  // Picking a type starts a fresh in-memory interview: reset live state, apply the
  // online/offline choice (drives ASR routing), seed the sample conversation when
  // chosen, and push the config to the server. No session is created or persisted.
  const onPickInterviewType = useCallback(
    (choice: InterviewTypeChoice): void => {
      setTypePickerOpen(false);
      const sample = choice.sample;
      setInterviewTitle(sample ? sample.name : '新面试');

      // Reset the live buffers for the fresh interview.
      onClearSession();

      // Apply the picked type + sample JD/résumé. interviewType drives offline
      // (single-mic role partitioning) vs online routing.
      const jd = sample ? sample.jd : '';
      const resumeText = sample ? sample.resume : '';
      setConfig((prev) => ({
        ...prev,
        jobDescription: jd,
        resumeText,
        interviewType: choice.interviewType
      }));
      pushConfig({ jobDescription: jd, resumeText });

      if (sample) {
        const sampleText = sampleTranscriptText(sample);
        // Render the whole sample conversation as chat lines…
        setTranscriptMessages(
          sample.turns.map((turn) => ({
            role: turn.speaker === 'interviewer' ? 'interviewer' : 'candidate',
            text: turn.text
          }))
        );
        setClientSummaryTranscript(sampleText);
        // …and seed the analyze buffer with the LAST candidate turn so Generate Q
        // has the most-recent answer to follow up on (falls back to the flattened
        // transcript if the sample has no candidate turn).
        const lastCandidate = [...sample.turns]
          .reverse()
          .find((turn) => turn.speaker === 'candidate');
        setAnswer(lastCandidate ? lastCandidate.text : sampleText);
      }
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
                lastResult={lastResult}
                outputLanguage={config.outputLanguage}
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
                autoMode={appSettings.settings.autoMode}
                autoIntervalMs={appSettings.settings.autoIntervalSec * 1000}
                autoGenerate={appSettings.settings.autoGenerate}
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
        mode={config.mode}
        outputLanguage={config.outputLanguage}
        settings={appSettings.settings}
        activePipelineId={config.activePipelineId}
        onClose={() => setSettingsOpen(false)}
        onModeChange={onModeChange}
        onLanguageChange={onLanguageChange}
        onSummaryModelChange={(value) => {
          appSettings.setSummaryModel(value);
          pushConfig({ summaryModel: value });
        }}
        onSummaryPromptModeChange={(mode) => {
          appSettings.setSummaryPromptMode(mode);
          pushConfig({
            summaryPromptMode: mode,
            summaryPromptText: mode === 'custom' ? appSettings.settings.summaryPromptText : undefined
          });
        }}
        onSummaryPromptTextChange={(text) => {
          appSettings.setSummaryPromptText(text);
          // Only push to server when in custom mode (no-op in default mode).
          if (appSettings.settings.summaryPromptMode === 'custom') {
            pushConfig({ summaryPromptMode: 'custom', summaryPromptText: text });
          }
        }}
        onAsrProviderChange={onAsrProviderChange}
        onMicDeviceChange={appSettings.setMicDeviceId}
        micDeviceDisabled={capturing}
        onAutoModeChange={onAutoModeChange}
        onAutoIntervalChange={onAutoIntervalChange}
        onVolcSettingsChange={onVolcSettingsChange}
        onOpacityChange={appSettings.setOpacityStep}
        onSelectPipeline={onUseCustomPipeline}
        onOpenStudio={onOpenStudio}
      />

      <PipelineStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        onUse={(id) => onUseCustomPipeline(id)}
      />

      <SpotlightTour />
    </div>
  );
}
