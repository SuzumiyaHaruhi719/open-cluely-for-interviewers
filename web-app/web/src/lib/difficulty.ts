/** Difficulty levels as encoded by the question bank. */
export type DifficultyLevel = 0 | 1 | 2 | 3;

const LABELS: Record<DifficultyLevel, string> = {
  0: '未标注',
  1: '简单',
  2: '中等',
  3: '困难'
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
  { value: null, label: '全部' },
  { value: 1, label: '简单' },
  { value: 2, label: '中等' },
  { value: 3, label: '困难' },
  { value: 0, label: '未标注' }
];
