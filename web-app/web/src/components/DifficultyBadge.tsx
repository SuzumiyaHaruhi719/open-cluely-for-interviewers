import { difficultyLabel, normalizeDifficulty } from '../lib/difficulty';

interface DifficultyBadgeProps {
  difficulty: number;
}

/** Renders a question's difficulty as a colored pip + label. */
export function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const level = normalizeDifficulty(difficulty);
  return (
    <span className="diff-badge" data-level={level}>
      <span className="diff-pip" aria-hidden="true" />
      {difficultyLabel(difficulty)}
    </span>
  );
}
