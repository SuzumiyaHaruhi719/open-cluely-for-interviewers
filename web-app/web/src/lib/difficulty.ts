/** Difficulty levels as encoded by the question bank. */
export type DifficultyLevel = 0 | 1 | 2 | 3;

const LABELS: Record<DifficultyLevel, string> = {
  0: 'Unspecified',
  1: 'Easy',
  2: 'Medium',
  3: 'Hard'
};

/** Maps a numeric difficulty to a human label, clamping unknown values. */
export function difficultyLabel(value: number): string {
  return LABELS[normalizeDifficulty(value)];
}

export function normalizeDifficulty(value: number): DifficultyLevel {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return 0;
}

/** Filter options for the difficulty selector (All + the four levels). */
export const DIFFICULTY_FILTERS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 1, label: 'Easy' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Hard' },
  { value: 0, label: 'Unspecified' }
];
