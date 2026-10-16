import { loadExercises } from '@fitwell/core/data/exercises';
import type { BodyData } from '../data/bodyData';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import type { WorkoutData } from '../data/workoutData';
import { addDays, dayDiff, dayNumber, weekStart as mondayOf } from '@fitwell/core/domain/dates';
import { bmr } from '@fitwell/core/domain/energy';
import { buildProgress, rangeStart, type Progress } from './progress';
import { buildWeeklyReview, weekEndOf, type WeekReview } from './review';

export interface ProgressDeps {
  data: UserData;
  workouts: WorkoutData;
  body: BodyData;
}

/** Reads the rows for a period (a handful of indexed queries) and computes the progress numbers. */
export async function loadProgress(deps: ProgressDeps, days: number, to?: string): Promise<Progress> {
  const profile = await deps.data.profile();
  const end = to ?? todayIn(profile.timeZone);
  const from = rangeStart(end, days);
  const lib = await loadExercises();
  const primary = new Map(lib.exercises.map((e) => [e.ref, e.primary]));
  const [weights, measurements, metrics, nutrition, workouts, goals] = await Promise.all([
    deps.body.weights(from, end),
    deps.body.measurements(from, end),
    deps.body.metrics(from, end),
    deps.data.dayTotals(from, end),
    deps.workouts.between(from, end),
    deps.data.goals(),
  ]);
  const weightKg = weights.at(-1)?.kg ?? profile.weightKg;
  const bmrKcal = profile.sex && profile.birthYear && profile.heightCm && weightKg ? bmr({ sex: profile.sex, ageYears: Number(end.slice(0, 4)) - profile.birthYear, heightCm: profile.heightCm, weightKg }) : undefined;
  return buildProgress({ from, to: end, weights, measurements, metrics, nutrition, workouts, goals, musclesOf: (ref) => primary.get(ref) ?? [], bmrKcal });
}

export interface ReviewDeps extends ProgressDeps {
  plans: import('../data/planData').PlanData;
}

/** The weekly review for the week starting on `weekStart` (a Monday); the default is the most useful week to look at now. */
export async function loadWeeklyReview(deps: ReviewDeps, weekStart?: string): Promise<WeekReview> {
  const today = todayIn((await deps.data.profile()).timeZone);
  // Early in the week (Monday, Tuesday) there is hardly anything to review yet, so look at the week that just ended.
  const monday = mondayOf(today);
  const start = weekStart ?? (dayDiff(monday, today) < 2 ? addDays(monday, -7) : monday);
  if (start > today) throw new Error(`The week of ${start} has not started yet.`);
  const { end } = weekEndOf(start, today);
  const counted = dayNumber(end) - dayNumber(start) + 1;
  const [week, previous, history, plan] = await Promise.all([loadProgress(deps, counted, end), loadProgress(deps, counted, addDays(start, counted - 8)), loadProgress(deps, 120, end), deps.plans.plan(start)]);
  return buildWeeklyReview({
    weekStart: start,
    today,
    week,
    previous,
    history,
    plan: plan ? { meals: plan.items.filter((i) => i.day <= end).length, logged: plan.items.filter((i) => i.day <= end && i.loggedAt).length } : null,
  });
}
