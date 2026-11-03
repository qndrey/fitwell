// What the celebration view draws (F3). Plain data: the words are the server's, so the view only lays them out.
/** Defined here, not in data/achievements.ts, so the view can import it without the Workers types of the data layer. */
export type AchievementKind = 'training_weeks' | 'logging_days' | 'logging_weeks' | 'protein_days' | 'goal_weight';

export interface Celebration {
  kind: AchievementKind;
  /** The milestone: weeks or days, 1 for the goal weight. */
  threshold: number;
  /** The local day it was reached. */
  achievedAt: string;
  /** "7 weeks of training". */
  title: string;
  /** The rule behind it, e.g. "3 or more workouts a week"; null when there is nothing to add. */
  detail: string | null;
  /** The run reaches the first day Fitwell looked at, so the number is a minimum. */
  atLeast: boolean;
  /** The goal weight in kg, for the goal-weight milestone only; null otherwise. Kept off a share card unless the person turns it on for that card. */
  goalKg: number | null;
  /** What it took, in the person's own numbers. */
  took: { label: string; value: number }[];
  /** The next milestone of the same streak; null for the goal weight or a run that has ended since. */
  next: { threshold: number; remaining: number; unit: 'week' | 'day' } | null;
}

export interface CelebrationResult {
  celebrations: Celebration[];
}
