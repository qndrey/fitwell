// The shape of the muscle map. Pure types and constants, shared with the exercise view (which can't see server code).
import type { Day } from '@fitwell/core/domain/dates';

/** The library's muscle groups, in the order the body model packs them (see `BODY_MUSCLES` in ui/shared/humanBody.ts). */
export const MUSCLE_GROUPS = ['abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings', 'lats', 'lower back', 'middle back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps'] as const;

/**
 * Hard sets a week that are usually enough for a muscle to grow: about 10 to 20 in the training literature. A rough
 * guide for the big muscle groups; small ones (forearms, neck) often do fine on less, since they help in other lifts.
 */
export const WEEKLY_SET_RANGE = { low: 10, high: 20 } as const;

/** none: not trained; below: under the range; in_range; high: over it. */
export type MuscleLevel = 'none' | 'below' | 'in_range' | 'high';

export interface MuscleLoad {
  muscle: string;
  /** Working sets a week, averaged over the period: 1 for a set where the muscle is a main one, 0.5 where it helps. */
  setsPerWeek: number;
  level: MuscleLevel;
  /** The last day with a working set where this muscle is a main one. */
  lastTrained: Day | null;
  /** The exercises that gave it the most sets in the period. */
  topExercises: { name: string; sets: number }[];
}

export interface MuscleMap {
  from: Day;
  to: Day;
  weeks: number;
  sessions: number;
  range: { low: number; high: number };
  /** Every muscle group, in `MUSCLE_GROUPS` order. */
  muscles: MuscleLoad[];
}
