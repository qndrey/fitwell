import { estimatedOneRepMax } from '@fitwell/core/domain/workouts';
import type { StoredExercise, StoredSet } from '../data/workoutData';
import type { ExerciseBests } from './plan';

/** At most this many entries in each list of an exercise's bests (reps 1–12 give at most 12 anyway; weights are cut to the heaviest). */
export const BESTS_CAP = 12;

/** The best estimated 1RM among the done working sets of one session of an exercise: the basis of "New best" in the finish summary and of the live record cue. */
export const sessionBest = (sets: StoredSet[]): number => Math.max(0, ...sets.filter((s) => s.done !== false && s.type === 'working').map((s) => estimatedOneRepMax(s.weightKg, s.reps) ?? 0));

/**
 * What earlier sessions (up to the workout's day) say about an exercise, for the live record cue in the player:
 * the best estimated 1RM (same comparison as the finish summary), the heaviest weight for each rep count seen,
 * and the most reps at each weight seen. Undefined when there is no earlier working set it could compare with.
 */
export function exerciseBests(prior: { day: string; exercise: StoredExercise }[], day: string): ExerciseBests | undefined {
  const e1rm = Math.max(0, ...prior.filter((p) => p.day <= day).map((p) => sessionBest(p.exercise.sets)));
  if (!(e1rm > 0)) return undefined;
  const byReps = new Map<number, number>();
  const atWeight = new Map<number, number>();
  for (const p of prior) {
    if (p.day > day) continue;
    for (const s of p.exercise.sets) {
      if (s.done === false || s.type !== 'working' || estimatedOneRepMax(s.weightKg, s.reps) === undefined) continue;
      byReps.set(s.reps, Math.max(byReps.get(s.reps) ?? 0, s.weightKg));
      atWeight.set(s.weightKg, Math.max(atWeight.get(s.weightKg) ?? 0, s.reps));
    }
  }
  return {
    e1rm,
    byReps: [...byReps].sort((a, b) => a[0] - b[0]).slice(0, BESTS_CAP),
    atWeight: [...atWeight].sort((a, b) => b[0] - a[0]).slice(0, BESTS_CAP),
  };
}
