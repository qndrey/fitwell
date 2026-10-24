/**
 * Simple, explainable progression ("double progression" lite) for one exercise, from its recent sessions.
 * The rule, newest session first:
 *  - Every done working set reached its target reps (or, without targets, the reps of the first set) at one weight:
 *    add one step (2.5 kg; 2 kg for dumbbells and kettlebells, i.e. per hand). Bodyweight: one more rep.
 *    The effort the person tapped adjusts it: every set Easy adds two steps (two reps), any set Max holds the
 *    weight (the reps), Solid or Hard adds one step. Sets without an effort count as not Easy; no effort at all
 *    keeps the plain rule.
 *  - Some set fell short: keep the weight. Short at the same weight in the session before as well: deload 10 %
 *    (rounded to the step) to rebuild.
 *  - Mixed weights or no done working sets: no suggestion (the picture isn't clear enough to automate).
 */
import type { WorkoutSet } from '../schema';
import { isSetDone } from './workouts';

export interface SessionSets {
  day: string;
  sets: (Pick<WorkoutSet, 'type' | 'reps' | 'weightKg' | 'done' | 'bodyweightKg'> & { targetReps?: number; effort?: number })[];
}

export interface Progression {
  /** What to load next time (kg); absent for bodyweight exercises. */
  weightKg?: number;
  reps: number;
  action: 'increase' | 'repeat' | 'deload' | 'add_rep';
  reason: string;
}

/** The four effort taps of a logged working set, easiest first: effort n is `EFFORT_LABELS[n - 1]`. */
export const EFFORT_LABELS = ['Easy', 'Solid', 'Hard', 'Max'] as const;
const EASY = 1;
const MAX = 4;

const STEP_SMALL = new Set(['dumbbell', 'kettlebells', 'kettlebell']);

export const stepKg = (equipment: string | undefined) => (STEP_SMALL.has((equipment ?? '').toLowerCase()) ? 2 : 2.5);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

function working(s: SessionSets) {
  return s.sets.filter((x) => x.type === 'working' && isSetDone(x) && x.reps > 0);
}

/** How many steps a session that hit its target earns from its effort: 2 when every set was Easy, 0 when any was Max, else 1. */
function effortSteps(s: SessionSets): { steps: 0 | 1 | 2; note: string } {
  const efforts = working(s).map((x) => (x.effort && x.effort >= EASY && x.effort <= MAX ? x.effort : 0));
  if (efforts.includes(MAX)) return { steps: 0, note: ', but one felt Max' };
  if (efforts.every((e) => e === EASY)) return { steps: 2, note: ' and every one felt Easy' };
  const hardest = Math.max(...efforts);
  if (!hardest) return { steps: 1, note: '' };
  return { steps: 1, note: hardest === EASY ? ', the ones noted felt Easy' : `, the hardest felt ${EFFORT_LABELS[hardest - 1]}` };
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
  const effort = effortSteps(last);
  if (bodyweight) {
    if (!now.hit) return { reps: now.target, action: 'repeat', reason: `Not every set reached ${now.target} reps last time; repeat the target.` };
    if (!effort.steps) return { reps: now.target, action: 'repeat', reason: `All sets reached ${now.target} reps last time${effort.note}; repeat the target until it feels easier.` };
    const reps = now.target + effort.steps;
    return { reps, action: 'add_rep', reason: `All sets reached ${now.target} reps last time${effort.note}; aim for ${reps}.` };
  }
  const step = stepKg(equipment);
  if (now.hit) {
    if (!effort.steps) return { weightKg: now.weightKg, reps: now.target, action: 'repeat', reason: `All sets reached ${now.target} reps at ${now.weightKg} kg${effort.note}; stay there until it feels easier.` };
    const add = step * effort.steps;
    return { weightKg: now.weightKg + add, reps: now.target, action: 'increase', reason: `All sets reached ${now.target} reps at ${now.weightKg} kg${effort.note}; add ${add} kg.` };
  }
  const before = sessions[1] ? judge(sessions[1]) : null;
  if (before && !before.hit && Math.abs(before.weightKg - now.weightKg) < 0.01) {
    const deload = Math.max(0, roundTo(now.weightKg * 0.9, step));
    return { weightKg: deload, reps: now.target, action: 'deload', reason: `Missed ${now.target} reps at ${now.weightKg} kg twice in a row; drop about 10 % to ${deload} kg and build back up.` };
  }
  return { weightKg: now.weightKg, reps: now.target, action: 'repeat', reason: `Not every set reached ${now.target} reps at ${now.weightKg} kg; stay there until they do.` };
}
