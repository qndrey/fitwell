import type { CardioDetails, SetType, Workout, WorkoutExercise, WorkoutSet } from '../db/schema';
import { displayWeight, weightUnit, type UnitSystem } from './units';

/** What counts toward the calorie total for a cardio workout: the user's own number wins over the estimate. */
export const cardioKcal = (c: CardioDetails): number | undefined => c.kcalOverride ?? c.kcalEstimated;

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * "3×8 @ 60 kg" when all working sets match, otherwise "8 @ 60, 8 @ 60, 6 @ 62.5 kg". Warm-ups are left out.
 * Used for "Last time: …" so you know what to beat at a glance.
 */
export function summarizeSets(sets: Pick<WorkoutSet, 'type' | 'reps' | 'weightKg'>[], units: UnitSystem): string {
  const working = sets.filter((s) => s.type === 'working' && s.reps > 0);
  if (working.length === 0) return '';
  const w = (kg: number) => fmt(displayWeight(kg, units));
  const unit = weightUnit(units);
  const first = working[0]!;
  const same = working.every((s) => s.reps === first.reps && s.weightKg === first.weightKg);
  if (same) return first.weightKg > 0 ? `${working.length}×${first.reps} @ ${w(first.weightKg)} ${unit}` : `${working.length}×${first.reps}`;
  const parts = working.map((s) => (s.weightKg > 0 ? `${s.reps} @ ${w(s.weightKg)}` : `${s.reps}`));
  return `${parts.join(', ')}${working.some((s) => s.weightKg > 0) ? ` ${unit}` : ''}`;
}

/** Epley estimate of the one-rep max. Only meaningful for working sets of up to 12 reps. */
export function estimatedOneRepMax(weightKg: number, reps: number): number | undefined {
  if (!(weightKg > 0) || !(reps >= 1) || reps > 12) return undefined;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export function newSet(id: string, type: SetType = 'working', from?: Pick<WorkoutSet, 'reps' | 'weightKg'>): WorkoutSet {
  return { id, type, reps: from?.reps ?? 0, weightKg: from?.weightKg ?? 0 };
}

/** A fresh copy of a workout on another day: new set ids, nothing shared with the original. */
export function copyExercises(exercises: WorkoutExercise[], newId: () => string): WorkoutExercise[] {
  return exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, id: newId() })) }));
}

/** One-line description for lists. */
export function describeWorkout(w: Pick<Workout, 'type' | 'cardio' | 'exercises' | 'name'>): { title: string; detail: string } {
  if (w.type === 'cardio' && w.cardio) {
    const c = w.cardio;
    return { title: c.activityName, detail: `${Math.round(c.durationMin)} min` };
  }
  const ex = w.exercises ?? [];
  const sets = ex.reduce((n, e) => n + e.sets.filter((s) => s.reps > 0 || s.weightKg > 0).length, 0);
  return { title: w.name?.trim() || 'Strength', detail: `${ex.length} ${ex.length === 1 ? 'exercise' : 'exercises'} · ${sets} ${sets === 1 ? 'set' : 'sets'}` };
}
