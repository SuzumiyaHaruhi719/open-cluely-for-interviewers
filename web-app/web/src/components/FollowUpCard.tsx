import type { FollowUpOutput, TokenUsage } from '@open-cluely/contract';

interface FollowUpCardProps {
  output: FollowUpOutput;
  mode: string;
  tokensUsed: TokenUsage;
  elapsedMs: number;
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

/**
 * Renders a `FollowUpOutput`: the primary suggested question is prominent, with
 * the alternative, rationale, anchor quotes (as chips), and expected evidence
 * yield below. A footer summarizes the run (mode / tokens / latency).
 */
export function FollowUpCard({ output, mode, tokensUsed, elapsedMs }: FollowUpCardProps) {
  return (
    <article className="card followup" aria-label="Suggested follow-up">
      <div className="followup-label">Suggested follow-up</div>
      <h2 className="followup-primary">{output.primary_question}</h2>

      {output.alternative_question ? (
        <p className="followup-alt">
          <span className="followup-alt-label">Alt</span>
          {output.alternative_question}
        </p>
      ) : null}

      {output.rationale_for_interviewer ? (
        <div className="followup-block">
          <div className="followup-block-title">Why ask this</div>
          <p className="followup-rationale">{output.rationale_for_interviewer}</p>
        </div>
      ) : null}

      {output.anchor_quotes.length > 0 ? (
        <div className="followup-block">
          <div className="followup-block-title">Anchored to</div>
          <div className="chips">
            {output.anchor_quotes.map((quote, index) => (
              <span key={`${index}-${quote}`} className="chip chip-quote" title={quote}>
                “{quote}”
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {output.expected_evidence_yield ? (
        <div className="followup-block">
          <div className="followup-block-title">Expected evidence</div>
          <p className="followup-yield">{output.expected_evidence_yield}</p>
        </div>
      ) : null}

      <footer className="followup-footer">
        {mode ? (
          <>
            <span className="tag-mode">{mode}</span>
            <span className="dot" aria-hidden="true" />
          </>
        ) : null}
        <span>{totalTokens(tokensUsed).toLocaleString()} tokens</span>
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
