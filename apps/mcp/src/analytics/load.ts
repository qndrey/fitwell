import { loadExercises } from '@fitwell/core/data/exercises';
import type { BodyData } from '../data/bodyData';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import type { WorkoutData } from '../data/workoutData';
import { addDays, dayDiff, dayNumber, weekStart as mondayOf } from '@fitwell/core/domain/dates';
import { bmr } from '@fitwell/core/domain/energy';
import { buildProgress, rangeStart, type Progress } from './progress';
import { buildWeeklyReview, weekEndOf, weeksIn, type ReviewPeriod, type WeekReview } from './review';
import type { SavedNotes } from './reviewTypes';

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
  const muscles = new Map(lib.exercises.map((e) => [e.ref, { primary: e.primary, secondary: e.secondary }]));
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
  return buildProgress({ from, to: end, weights, measurements, metrics, nutrition, workouts, goals, musclesOf: (ref) => muscles.get(ref) ?? { primary: [], secondary: [] }, bmrKcal });
}

export interface ReviewDeps extends ProgressDeps {
  plans: import('../data/planData').PlanData;
  notes: import('../data/reviewNotes').ReviewNotesData;
}

/**
 * The weekly review for the week starting on `weekStart` (a Monday); the default is the most useful week to look at now.
 * For `period: 'month'` it is the four weeks that end with that week, compared with the same days four weeks earlier.
 */
export async function loadWeeklyReview(deps: ReviewDeps, weekStart?: string, period: ReviewPeriod = 'week', write?: Partial<SavedNotes>): Promise<WeekReview> {
  const today = todayIn((await deps.data.profile()).timeZone);
  // Early in the week (Monday, Tuesday) there is hardly anything to review yet, so look at the week that just ended.
  const monday = mondayOf(today);
  const last = weekStart ?? (dayDiff(monday, today) < 2 ? addDays(monday, -7) : monday);
  if (last > today) throw new Error(`The week of ${last} has not started yet.`);
  const start = addDays(last, -7 * (weeksIn(period) - 1));
  const { end } = weekEndOf(start, today, period);
  const counted = dayNumber(end) - dayNumber(start) + 1;
  // Notes Claude wrote for this period are saved first, so the review below (and every later one) carries them.
  if (write && (write.training || write.nutrition)) {
    try {
      await deps.notes.save(period, start, write);
    } catch {
      throw new Error('The notes could not be saved. Try again.');
    }
  }
  const [saved, week, previous, history, plan] = await Promise.all([deps.notes.get(period, start), loadProgress(deps, counted, end), loadProgress(deps, counted, addDays(end, -7 * weeksIn(period))), loadProgress(deps, 120, end), period === 'week' ? deps.plans.plan(start) : null]);
  return buildWeeklyReview({
    weekStart: start,
    period,
    today,
    week,
    previous,
    history,
    saved,
    plan: plan ? { meals: plan.items.filter((i) => i.day <= end).length, logged: plan.items.filter((i) => i.day <= end && i.loggedAt).length } : null,
  });
}
