// The weekly review: one week against the one before it, plus what to look at next. Pure: no I/O.
import { addDays, dayNumber, type Day } from '@fitwell/core/domain/dates';
import type { Progress } from './types';
import type { WeekReview } from './reviewTypes';

export type { WeekReview } from './reviewTypes';

export interface ReviewInput {
  weekStart: Day;
  /** Today in the person's time zone; the week ends there if it has not finished. */
  today: Day;
  /** Progress over exactly the days counted this week, and the same number of days before it. */
  week: Progress;
  previous: Progress;
  /** Progress over a longer period ending the same day (weight trend, records history). */
  history: Progress;
  plan: { meals: number; logged: number } | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);

export function weekEndOf(weekStart: Day, today: Day): { end: Day; inProgress: boolean } {
  const sunday = addDays(weekStart, 6);
  return today < sunday ? { end: today, inProgress: true } : { end: sunday, inProgress: false };
}

export function buildWeeklyReview(i: ReviewInput): WeekReview {
  const { week: w, previous: pv, history: h } = i;
  const { end, inProgress } = weekEndOf(i.weekStart, i.today);
  const daysCounted = dayNumber(end) - dayNumber(i.weekStart) + 1;
  const goals = w.nutrition.goals;

  // Records: a day in this week whose estimate is higher than every earlier point of that exercise.
  const records: WeekReview['training']['records'] = [];
  for (const e of h.records.exercises) {
    const inWeek = e.points.filter((p) => p.day >= i.weekStart && p.day <= end);
    if (!inWeek.length) continue;
    const best = inWeek.reduce((b, p) => (p.e1rmKg > b.e1rmKg ? p : b), inWeek[0]!);
    const before = e.points.filter((p) => p.day < i.weekStart);
    const previousBest = before.length ? Math.max(...before.map((p) => p.e1rmKg)) : null;
    if (previousBest !== null && best.e1rmKg > previousBest) records.push({ name: e.name, e1rmKg: best.e1rmKg, previousKg: previousBest });
  }

  const avgAt = (p: Progress, last: Day) => [...p.weight.average].reverse().find((a) => a.day <= last)?.kg ?? null;
  const averageKg = avgAt(h, end);
  const previousAverageKg = avgAt(h, addDays(i.weekStart, -1));

  const review: WeekReview = {
    weekStart: i.weekStart,
    weekEnd: end,
    inProgress,
    daysCounted,
    nutrition: {
      daysLogged: w.nutrition.daysLogged,
      average: w.nutrition.averagePerLoggedDay,
      previousAverage: pv.nutrition.averagePerLoggedDay ? { kcal: pv.nutrition.averagePerLoggedDay.kcal, protein: pv.nutrition.averagePerLoggedDay.protein } : null,
      goals: { kcal: goals.kcal, proteinG: goals.proteinG },
      kcalWithin10Pct: w.nutrition.adherence.kcalWithin10Pct,
      proteinReached: w.nutrition.adherence.proteinReached,
    },
    training: {
      strength: w.training.sessions.strength,
      cardio: w.training.sessions.cardio,
      cardioMin: r0(w.training.weeks.reduce((n, x) => n + x.cardioMin, 0)),
      previousSessions: pv.training.sessions.strength + pv.training.sessions.cardio,
      goalPerWeek: w.training.goalWorkoutsPerWeek,
      records,
    },
    weight: {
      weighIns: w.weight.daily.length,
      averageKg,
      previousAverageKg,
      changeKg: averageKg !== null && previousAverageKg !== null ? r1(averageKg - previousAverageKg) : null,
      goalKg: w.weight.goalKg,
    },
    habits: {
      sleepHours: w.metrics.sleep.averageHours,
      previousSleepHours: pv.metrics.sleep.averageHours,
      steps: w.metrics.steps.average,
      previousSteps: pv.metrics.steps.average,
      waterMl: w.metrics.water.averageMl,
      previousWaterMl: pv.metrics.water.averageMl,
    },
    energy: h.energy,
    plan: i.plan,
    highlights: [],
    suggestions: [],
  };

  // ---- highlights: what went well, said plainly
  const sessions = review.training.strength + review.training.cardio;
  for (const r of records) review.highlights.push(`New estimated 1RM on ${r.name}: ${r.e1rmKg} kg (was ${r.previousKg} kg).`);
  if (review.training.goalPerWeek && sessions >= review.training.goalPerWeek && !inProgress) review.highlights.push(`Trained ${sessions} times, on or above the goal of ${review.training.goalPerWeek}.`);
  if (goals.proteinG && review.nutrition.proteinReached !== null && review.nutrition.daysLogged >= 3 && review.nutrition.proteinReached >= review.nutrition.daysLogged * 0.8) review.highlights.push(`Protein goal reached on ${review.nutrition.proteinReached} of ${review.nutrition.daysLogged} logged days.`);
  if (review.nutrition.daysLogged === daysCounted && daysCounted >= 5) review.highlights.push(`Food logged every day (${daysCounted} of ${daysCounted}).`);
  const en = review.energy;
  if (en.goalDate && en.trendKgPerWeek !== null && w.weight.goalKg !== null) review.highlights.push(`At the current trend (${en.trendKgPerWeek > 0 ? '+' : ''}${en.trendKgPerWeek} kg a week) the goal weight of ${w.weight.goalKg} kg is reached around ${en.goalDate}.`);
  if (review.plan && review.plan.meals > 0 && review.plan.logged / review.plan.meals >= 0.75) review.highlights.push(`Stuck to the meal plan: ${review.plan.logged} of ${review.plan.meals} planned meals logged.`);

  // ---- suggestions: observations with a possible next step
  const n = review.nutrition;
  if (n.daysLogged < Math.min(5, daysCounted)) review.suggestions.push(`Food was logged on ${n.daysLogged} of ${daysCounted} days, so the nutrition averages are rough. Logging more days makes the numbers trustworthy.`);
  if (n.average && goals.proteinG && n.average.protein < goals.proteinG * 0.9) review.suggestions.push(`Protein averaged ${r0(n.average.protein)} g, ${r0(goals.proteinG - n.average.protein)} g under the ${goals.proteinG} g goal. A protein-rich snack or a larger portion at one meal would close most of it.`);
  if (n.average && goals.kcal) {
    const diff = n.average.kcal - goals.kcal;
    if (Math.abs(diff) > goals.kcal * 0.1) review.suggestions.push(`Calories averaged ${r0(n.average.kcal)} kcal, ${r0(Math.abs(diff))} ${diff < 0 ? 'under' : 'over'} the ${goals.kcal} kcal goal. Either the goal or the eating pattern could be adjusted; ask which fits.`);
  }
  if (!inProgress && review.training.goalPerWeek && sessions < review.training.goalPerWeek) review.suggestions.push(`${sessions} of ${review.training.goalPerWeek} planned workouts were done. Putting next week's sessions on fixed days, or planning shorter ones, can help.`);
  const gw = review.weight;
  if (gw.weighIns < 3 && !inProgress) review.suggestions.push(`Only ${gw.weighIns} weigh-in${gw.weighIns === 1 ? '' : 's'} this week. Three or more per week make the 7-day average meaningful.`);
  if (gw.changeKg !== null && gw.goalKg !== null && gw.averageKg !== null && gw.previousAverageKg !== null) {
    const wantsDown = gw.goalKg < gw.previousAverageKg - 0.5;
    const wantsUp = gw.goalKg > gw.previousAverageKg + 0.5;
    if (wantsDown && gw.changeKg >= 0.2) review.suggestions.push(`The 7-day average is up ${gw.changeKg} kg while the goal weight is lower. One week is a short time, so it is worth watching a second week before changing anything.`);
    if (wantsUp && gw.changeKg <= -0.2) review.suggestions.push(`The 7-day average is down ${Math.abs(gw.changeKg)} kg while the goal weight is higher. Watch one more week before changing anything.`);
  }
  // The check-in: the measured burn against the calorie goal. Only once the estimate is more than an early guess.
  if (en.expenditureKcal !== null && en.confidence !== 'low' && en.suggestedKcal !== null && goals.kcal && Math.abs(en.suggestedKcal - goals.kcal) >= 100) {
    const aim = en.direction === 'maintain' ? 'to keep the weight' : `to ${en.direction} ${en.suggestedRateKgPerWeek} kg a week`;
    const n = (x: number) => x.toLocaleString('en-GB');
    review.suggestions.push(`Over the last 4 weeks the logs and weigh-ins show a burn of about ${n(en.expenditureKcal)} kcal a day. ${aim[0]!.toUpperCase()}${aim.slice(1)}, that means about ${n(en.suggestedKcal)} kcal a day; the goal is ${n(goals.kcal)}. The goal could be updated; ask first.`);
  }
  const hb = review.habits;
  if (hb.sleepHours !== null && hb.sleepHours < 7) review.suggestions.push(`Sleep averaged ${hb.sleepHours} h, under the 7 to 9 hours usually advised for adults. It is often the first thing to improve before changing food or training.`);
  if (review.plan && review.plan.meals > 0 && review.plan.logged / review.plan.meals < 0.5 && !inProgress) review.suggestions.push(`Fewer than half of the planned meals were logged (${review.plan.logged} of ${review.plan.meals}). A simpler plan with fewer different meals can be easier to follow.`);

  return review;
}
