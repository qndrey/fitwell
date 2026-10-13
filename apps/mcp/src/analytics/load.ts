import { loadExercises } from '@fitwell/core/data/exercises';
import type { BodyData } from '../data/bodyData';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import type { WorkoutData } from '../data/workoutData';
import { buildProgress, rangeStart, type Progress } from './progress';

export interface ProgressDeps {
  data: UserData;
  workouts: WorkoutData;
  body: BodyData;
}

/** Reads the rows for a period (a handful of indexed queries) and computes the progress numbers. */
export async function loadProgress(deps: ProgressDeps, days: number, to?: string): Promise<Progress> {
  const end = to ?? todayIn((await deps.data.profile()).timeZone);
  const from = rangeStart(end, days);
  const lib = await loadExercises();
  const primary = new Map(lib.exercises.map((e) => [e.ref, e.primary]));
  const [weights, measurements, nutrition, workouts, goals] = await Promise.all([
    deps.body.weights(from, end),
    deps.body.measurements(from, end),
    deps.data.dayTotals(from, end),
    deps.workouts.between(from, end),
    deps.data.goals(),
  ]);
  return buildProgress({ from, to: end, weights, measurements, nutrition, workouts, goals, musclesOf: (ref) => primary.get(ref) ?? [] });
}
