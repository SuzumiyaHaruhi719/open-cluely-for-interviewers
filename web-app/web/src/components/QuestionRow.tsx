import type { QuestionBankHit } from '@open-cluely/contract';
import { DifficultyBadge } from './DifficultyBadge';
import { CompanyChips } from './CompanyChips';

interface QuestionRowProps {
  item: QuestionBankHit;
  /** Show the semantic relevance score (only meaningful in Semantic mode). */
  showScore?: boolean;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

/** A single question-bank result row. */
export function QuestionRow({ item, showScore = false }: QuestionRowProps) {
  return (
    <li className="q-row">
      <div className="q-row-head">
        <span className="q-text">{item.question}</span>
        {showScore ? <span className="q-score">{formatScore(item.score)}</span> : null}
      </div>
      <div className="q-row-meta">
        <DifficultyBadge difficulty={item.difficulty} />
        <span className="q-vote" title="票数">
          ▲ {item.vote}
        </span>
        <CompanyChips companies={item.companies} />
        <span className="spacer" />
        {item.url ? (
          <a className="q-link" href={item.url} target="_blank" rel="noopener noreferrer">
            来源 ↗
          </a>
        ) : null}
      </div>
    </li>
  );
}
