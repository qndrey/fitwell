// Builds the streak engine's input (packages/core domain/streaks) from a person's stored rows.
import { addDays } from '@fitwell/core/domain/dates';
import type { Day } from '@fitwell/core/domain/dates';
import { computeStreaks, type OptionalStreak, type Streak, type StreakResult } from '@fitwell/core/domain/streaks';
import type { AchievementKind } from '../data/achievements';
import type { BodyData } from '../data/bodyData';
import { todayIn } from '../data/time';
import type { DayTotal, UserData } from '../data/userData';
import type { Workout, WorkoutData } from '../data/workoutData';

export interface StreakDeps {
  data: UserData;
  workouts: WorkoutData;
  body: BodyData;
}

/** How far back the engine looks: two years of days. A run that reaches the first day is shown as "at least". */
export const HISTORY_DAYS = 730;
/** The trend of a weigh-in needs the days before it; the engine asks for 6. */
const TREND_LEAD_DAYS = 6;

export interface LoadedStreaks {
  today: Day;
  result: StreakResult;
  /** The rows the result was worked out from, for what the celebration says it took. */
  workouts: Workout[];
  food: DayTotal[];
}

export async function loadStreaks(deps: StreakDeps): Promise<LoadedStreaks> {
  const today = todayIn((await deps.data.profile()).timeZone);
  const [firstWorkout, firstFood, goals, goalSince] = await Promise.all([deps.workouts.firstDay(), deps.data.firstFoodDay(), deps.data.goals(), deps.data.goalWeightSince()]);
  const first = [firstWorkout, firstFood].filter((d): d is Day => d !== null).sort()[0] ?? today;
  const floor = addDays(today, -(HISTORY_DAYS - 1));
  const historyFrom = first < floor ? floor : first;
  const goalWeightSince = goals?.goalWeightKg != null ? goalSince : null;
  const weighFrom = goalWeightSince && addDays(goalWeightSince, -TREND_LEAD_DAYS) < historyFrom ? addDays(goalWeightSince, -TREND_LEAD_DAYS) : historyFrom;

  const [workouts, food, weighIns] = await Promise.all([deps.workouts.between(historyFrom, today), deps.data.dayTotals(historyFrom, today), deps.body.weights(weighFrom, today)]);
  const result = computeStreaks({
    today,
    historyFrom,
    olderDataExists: first < floor,
    workouts: workouts.map((w) => ({ day: w.day, type: w.type, finished: w.finishedAt !== null, hasDetails: w.session !== null })),
    // The engine groups entries by day; the totals already are one row a day, so each is one entry carrying the day's protein.
    food: food.map((d) => ({ day: d.day, proteinG: d.protein })),
    weighIns: weighIns.map((w) => ({ day: w.day, kg: w.kg })),
    goals: { workoutsPerWeek: goals?.workoutsPerWeek ?? null, proteinG: goals?.proteinG ?? null, goalWeightKg: goals?.goalWeightKg ?? null, goalWeightSince },
  });
  return { today, result, workouts, food };
}

/** The streaks in a line each, for tools that only mention them (get_progress); get_streaks has the full result. */
export function streakSummary(result: StreakResult) {
  const line = (s: Streak) => ({ unit: s.unit, current: s.current, best: s.best.length, atLeast: s.atLeast, next: s.next });
  const optional = (s: OptionalStreak) => (s.status === 'ok' ? line(s.streak) : null);
  return { training: optional(result.training), loggingDays: line(result.loggingDays), loggingWeeks: line(result.loggingWeeks), proteinDays: optional(result.proteinDays), weightGoal: result.weightGoal };
}

/** Every milestone reached and the goal weight, as what the achievements table records. */
export function achievementsOf(result: StreakResult): { kind: AchievementKind; threshold: number; achievedAt: Day }[] {
  const from = (kind: AchievementKind, s: OptionalStreak | StreakResult['loggingDays']) => {
    const streak = 'status' in s ? (s.status === 'ok' ? s.streak : null) : s;
    return (streak?.milestones ?? []).map((m) => ({ kind, threshold: m.threshold, achievedAt: m.day }));
  };
  return [
    ...from('training_weeks', result.training),
    ...from('logging_days', result.loggingDays),
    ...from('logging_weeks', result.loggingWeeks),
    ...from('protein_days', result.proteinDays),
    ...(result.weightGoal.status === 'reached' ? [{ kind: 'goal_weight' as const, threshold: 1, achievedAt: result.weightGoal.reachedOn }] : []),
  ];
}
