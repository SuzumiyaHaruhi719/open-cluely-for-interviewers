import { useCallback, useState } from 'react';
import type { InterviewerMode, OutputLanguage, SessionConfig } from '@open-cluely/contract';
import { INTERVIEWER_MODES } from '@open-cluely/contract';
import { useCopilotSocket } from '../lib/useCopilotSocket';
import { FollowUpCard } from '../components/FollowUpCard';
import { ProgressBar } from '../components/ProgressBar';
import { ErrorAlert } from '../components/ErrorAlert';
import { ConnectionStatus } from '../components/ConnectionStatus';

const MODE_LABELS: Record<InterviewerMode, string> = {
  fast: 'Fast',
  expert: 'Expert',
  expert2: 'Expert II',
  customize: 'Customize'
};

const LANGUAGE_OPTIONS: ReadonlyArray<{ value: OutputLanguage; label: string }> = [
  { value: '', label: 'Auto' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' }
];

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

interface LiveCopilotProps {
  /** Hoisted so the connection persists across view switches. */
  socket: ReturnType<typeof useCopilotSocket>;
}

export function LiveCopilot({ socket }: LiveCopilotProps) {
  const { status, sessionId, sendConfigure, analyze, lastResult, progress, isAnalyzing, error } =
    socket;

  const [config, setConfig] = useState<ConfigState>(INITIAL_CONFIG);
  const [answer, setAnswer] = useState('');

  const isReady = status === 'open';
  const canAnalyze = isReady && !isAnalyzing && answer.trim().length > 0;

  // Send a single config field, merging into local state immutably.
  const pushConfig = useCallback(
    (patch: Partial<SessionConfig>) => {
      sendConfigure(patch);
    },
    [sendConfigure]
  );

  const onModeChange = (mode: InterviewerMode): void => {
    setConfig((prev) => ({ ...prev, mode }));
    pushConfig({ mode });
  };

  const onLanguageChange = (outputLanguage: OutputLanguage): void => {
    setConfig((prev) => ({ ...prev, outputLanguage }));
    pushConfig({ outputLanguage });
  };

  const onAnalyze = (): void => {
    if (!canAnalyze) {
      return;
    }
    analyze(answer.trim());
  };

  const onAnswerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onAnalyze();
    }
  };

  return (
    <div className="copilot">
      <aside className="copilot-config">
        <div className="section-title">Session</div>

        <div className="field">
          <label htmlFor="cfg-mode">Mode</label>
          <select
            id="cfg-mode"
            value={config.mode}
            onChange={(e) => onModeChange(e.target.value as InterviewerMode)}
          >
            {INTERVIEWER_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="cfg-lang">Output language</label>
          <select
            id="cfg-lang"
            value={config.outputLanguage}
            onChange={(e) => onLanguageChange(e.target.value as OutputLanguage)}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="cfg-jd">Job description</label>
          <textarea
            id="cfg-jd"
            rows={5}
            placeholder="Paste the role's job description…"
            value={config.jobDescription}
            onChange={(e) => setConfig((prev) => ({ ...prev, jobDescription: e.target.value }))}
            onBlur={(e) => pushConfig({ jobDescription: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="cfg-resume">Candidate resume</label>
          <textarea
            id="cfg-resume"
            rows={6}
            placeholder="Paste the candidate's resume…"
            value={config.resumeText}
            onChange={(e) => setConfig((prev) => ({ ...prev, resumeText: e.target.value }))}
            onBlur={(e) => pushConfig({ resumeText: e.target.value })}
          />
        </div>

        <p className="hint">
          Config is sent to the session as you edit. Live audio capture arrives in a later
          release; for now, paste the candidate's answer to get a follow-up.
        </p>
      </aside>

      <section className="copilot-work">
        <div className="answer-bar">
          <div>
            <label htmlFor="answer">Candidate's latest answer</label>
            <textarea
              id="answer"
              rows={5}
              placeholder="Type or paste what the candidate just said…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={onAnswerKeyDown}
            />
          </div>
          <div className="answer-actions">
            <ConnectionStatus status={status} sessionId={sessionId} />
            <span className="spacer" />
            <span className="hint">⌘/Ctrl + Enter</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onAnalyze}
              disabled={!canAnalyze}
            >
              {isAnalyzing ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
        </div>

        {error ? <ErrorAlert message={error} /> : null}

        {isAnalyzing ? <ProgressBar progress={progress} fallbackLabel="Analyzing answer…" /> : null}

        {lastResult && !isAnalyzing ? (
          <FollowUpCard
            output={lastResult.output}
            mode={lastResult.mode}
            tokensUsed={lastResult.tokensUsed}
            elapsedMs={lastResult.elapsedMs}
          />
        ) : null}

        {!lastResult && !isAnalyzing && !error ? (
          <div className="empty">
            <div className="empty-icon" aria-hidden="true" />
            <div className="empty-title">No suggestion yet</div>
            <p>Paste the candidate's answer and run Analyze to get a follow-up question.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
