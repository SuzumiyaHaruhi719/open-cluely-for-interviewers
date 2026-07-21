import type { FollowUpOutput, OutputLanguage, TokenUsage } from '@open-cluely/contract';
import { followUpCopyFor } from '../lib/followUpCopy';

interface FollowUpCardProps {
  output: FollowUpOutput;
  mode: string;
  tokensUsed: TokenUsage;
  elapsedMs: number;
  /** UI chrome follows the selected output language; empty preserves legacy labels. */
  outputLanguage?: OutputLanguage;
}

function totalTokens(tokens: TokenUsage): number {
  return tokens.total ?? tokens.input + tokens.output;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    fast: '专家',
    expert: '专家',
    expert2: '专家',
    customize: '自定义'
  };
  return labels[mode] ?? mode;
}

/**
 * Renders a `FollowUpOutput`: the primary suggested question is prominent, with
 * the alternative, rationale, anchor quotes (as chips), and expected evidence
 * yield below. A footer summarizes the run (mode / tokens / latency).
 */
export function FollowUpCard({ output, mode, tokensUsed, elapsedMs, outputLanguage = '' }: FollowUpCardProps) {
  const copy = followUpCopyFor(outputLanguage);
  const anchorQuotes = output.anchor_quotes ?? [];
  const modeLabel = formatModeLabel(mode);

  return (
    <article className="card followup" aria-label={copy.ariaFollowUp}>
      <div className="followup-label">{copy.suggestedLabel}</div>
      <h2 className="followup-primary">{output.primary_question}</h2>

      {output.alternative_question ? (
        <p className="followup-alt">
          <span className="followup-alt-label">{copy.alternativeShort}</span>
          {output.alternative_question}
        </p>
      ) : null}

      {output.rationale_for_interviewer ? (
        <div className="followup-block">
          <div className="followup-block-title">{copy.why}</div>
          <p className="followup-rationale">{output.rationale_for_interviewer}</p>
        </div>
      ) : null}

      {anchorQuotes.length > 0 ? (
        <div className="followup-block">
          <div className="followup-block-title">{copy.anchoredTo}</div>
          <div className="chips">
            {anchorQuotes.map((quote, index) => (
              <span key={`${index}-${quote}`} className="chip chip-quote" title={quote}>
                “{quote}”
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {output.expected_evidence_yield ? (
        <div className="followup-block">
          <div className="followup-block-title">{copy.expected}</div>
          <p className="followup-yield">{output.expected_evidence_yield}</p>
        </div>
      ) : null}

      <footer className="followup-footer">
        {mode ? (
          <>
            <span className="tag-mode">{modeLabel}</span>
            <span className="dot" aria-hidden="true" />
          </>
        ) : null}
        <span>{totalTokens(tokensUsed).toLocaleString()} 词元</span>
        <span className="dot" aria-hidden="true" />
        <span>{formatElapsed(elapsedMs)}</span>
        {output.iteration_version ? (
          <>
            <span className="dot" aria-hidden="true" />
            <span>v{output.iteration_version}</span>
          </>
        ) : null}
      </footer>
    </article>
  );
}
