/**
 * Simple, explainable progression ("double progression" lite) for one exercise, from its recent sessions.
 * The rule, newest session first:
 *  - Every done working set reached its target reps (or, without targets, the reps of the first set) at one weight:
 *    add one step (2.5 kg; 2 kg for dumbbells and kettlebells, i.e. per hand). Bodyweight: one more rep.
 *  - Some set fell short: keep the weight. Short at the same weight in the session before as well: deload 10 %
 *    (rounded to the step) to rebuild.
 *  - Mixed weights or no done working sets: no suggestion (the picture isn't clear enough to automate).
 */
import type { WorkoutSet } from '../schema';
import { isSetDone } from './workouts';

export interface SessionSets {
  day: string;
  sets: (Pick<WorkoutSet, 'type' | 'reps' | 'weightKg' | 'done' | 'bodyweightKg'> & { targetReps?: number })[];
}

export interface Progression {
  /** What to load next time (kg); absent for bodyweight exercises. */
  weightKg?: number;
  reps: number;
  action: 'increase' | 'repeat' | 'deload' | 'add_rep';
  reason: string;
}

const STEP_SMALL = new Set(['dumbbell', 'kettlebells', 'kettlebell']);

export const stepKg = (equipment: string | undefined) => (STEP_SMALL.has((equipment ?? '').toLowerCase()) ? 2 : 2.5);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

function working(s: SessionSets) {
  return s.sets.filter((x) => x.type === 'working' && isSetDone(x) && x.reps > 0);
}

/** Did every working set reach its target at a single weight? null when the session can't be judged. */
function judge(s: SessionSets): { weightKg: number; target: number; hit: boolean } | null {
  const w = working(s);
  if (!w.length) return null;
  const weight = w[0]!.weightKg;
  if (!w.every((x) => Math.abs(x.weightKg - weight) < 0.01)) return null;
  const target = w[0]!.targetReps ?? w[0]!.reps;
  return { weightKg: weight, target, hit: w.every((x) => x.reps >= (x.targetReps ?? target)) };
}

/** `sessions`: the exercise's past sessions, newest first. */
export function suggestProgression(sessions: SessionSets[], equipment?: string): Progression | null {
  const last = sessions[0];
  if (!last) return null;
  const now = judge(last);
  if (!now) return null;
  const bodyweight = working(last).every((x) => x.bodyweightKg !== undefined) || equipment === 'body only';
  if (bodyweight) {
    return now.hit
      ? { reps: now.target + 1, action: 'add_rep', reason: `All sets reached ${now.target} reps last time; aim for ${now.target + 1}.` }
      : { reps: now.target, action: 'repeat', reason: `Not every set reached ${now.target} reps last time; repeat the target.` };
  }
  const step = stepKg(equipment);
  if (now.hit) {
    return { weightKg: now.weightKg + step, reps: now.target, action: 'increase', reason: `All sets reached ${now.target} reps at ${now.weightKg} kg; add ${step} kg.` };
  }
  const before = sessions[1] ? judge(sessions[1]) : null;
  if (before && !before.hit && Math.abs(before.weightKg - now.weightKg) < 0.01) {
    const deload = Math.max(0, roundTo(now.weightKg * 0.9, step));
    return { weightKg: deload, reps: now.target, action: 'deload', reason: `Missed ${now.target} reps at ${now.weightKg} kg twice in a row; drop about 10 % to ${deload} kg and build back up.` };
  }
  return { weightKg: now.weightKg, reps: now.target, action: 'repeat', reason: `Not every set reached ${now.target} reps at ${now.weightKg} kg; stay there until they do.` };
}
