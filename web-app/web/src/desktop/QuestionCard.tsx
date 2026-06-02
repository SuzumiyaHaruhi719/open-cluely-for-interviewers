import type { FollowUpOutput, TokenUsage } from '@open-cluely/contract';

interface QuestionCardProps {
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
 * The AI follow-up question card — the product's hero output surface. Rendered
 * as the desktop `.chat-message.is-question-card` (glowing indigo lane) so it
 * inherits the entrance animation + bloom from the copied chat.css. Maps a
 * `FollowUpOutput`: primary question prominent, anchor quotes as
 * `.question-card__anchor`, alternative + rationale + expected evidence below,
 * and a footer with mode / tokens / latency.
 */
export function QuestionCard({ output, mode, tokensUsed, elapsedMs }: QuestionCardProps) {
  return (
    <article className="chat-message lane-ai is-question-card" aria-label="Suggested follow-up">
      <div className="message-header question-card__header">
        <span className="message-icon" aria-hidden="true">
          ✦
        </span>
        <span className="message-label">AI follow-up</span>
        <span className="question-card__priority" data-priority="high">
          {mode}
        </span>
        <span className="message-time">{formatElapsed(elapsedMs)}</span>
      </div>

      <div className="message-content question-card__body">{output.primary_question}</div>

      {output.anchor_quotes.length > 0 ? (
        <div className="question-card__anchors">
          {output.anchor_quotes.map((quote, index) => (
            <div className="question-card__anchor" key={`${index}-${quote}`}>
              “{quote}”
            </div>
          ))}
        </div>
      ) : null}

      {output.alternative_question ? (
        <div className="question-card__alt">
          <span className="message-label">Alternative</span>
          <div className="message-content">{output.alternative_question}</div>
        </div>
      ) : null}

      {output.rationale_for_interviewer ? (
        <div className="question-card__rationale">
          <span className="message-label">Why ask this</span>
          <div className="message-content">{output.rationale_for_interviewer}</div>
        </div>
      ) : null}

      {output.expected_evidence_yield ? (
        <div className="question-card__yield">
          <span className="message-label">Expected evidence</span>
          <div className="message-content">{output.expected_evidence_yield}</div>
        </div>
      ) : null}

      <footer className="question-card__footer">
        <span className="tag-mode">{mode}</span>
        <span>{totalTokens(tokensUsed).toLocaleString()} tokens</span>
        <span>{formatElapsed(elapsedMs)}</span>
        {output.iteration_version ? <span>v{output.iteration_version}</span> : null}
      </footer>
    </article>
  );
}
