// Progress numbers for Claude and for the dashboard, from a person's stored rows. Pure: no I/O.
import { sessionMuscleCredit } from '../workout/sessions';
import { muscleCredit } from './muscles';
import { PRESETS } from '@fitwell/core/data/measurements';
import { addDays, dayNumber, type Day } from '@fitwell/core/domain/dates';
import { distanceFromGoal } from '@fitwell/core/domain/body';
import { averageExtras, EXTRA_KEYS, type Extras } from '@fitwell/core/domain/nutrition';
import { estimateExpenditure, goalDirection, projectGoalDate, targetFromExpenditure } from '@fitwell/core/domain/energy';
import { movingAverage, trendChange, weeksIn } from '@fitwell/core/domain/stats';
import { estimatedOneRepMax } from '@fitwell/core/domain/workouts';
import type { Goals, DayTotal } from '../data/userData';
import type { DailyMetrics, MeasurementSet, WeightPoint } from '../data/bodyData';
import type { Workout } from '../data/workoutData';
import type { EnergyProgress, MeasurementProgress, MetricsProgress, NutritionProgress, Progress, RecordsProgress, TrainingProgress, WeightProgress } from './types';

export type { EnergyProgress, MeasurementProgress, MetricsProgress, NutritionProgress, Progress, RecordsProgress, TrainingProgress, WeightProgress } from './types';

export interface ProgressInput {
  from: Day;
  to: Day;
  weights: WeightPoint[];
  measurements: MeasurementSet[];
  metrics?: DailyMetrics[];
  nutrition: DayTotal[];
  workouts: Workout[];
  goals: Goals | null;
  /** Main and helping muscles of a library exercise id. */
  musclesOf: (exerciseRef: string) => { primary: string[]; secondary: string[] };
  /** Basal metabolic rate when the profile allows it: suggested calories never go below it. */
  bmrKcal?: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const round1Extras = (e: Extras): Extras => Object.fromEntries(EXTRA_KEYS.filter((k) => e[k] !== undefined).map((k) => [k, r1(e[k]!)]));
const avgExtras = (days: DayTotal[]) => {
  const a = averageExtras(days.map((d) => d.extras));
  return a ? { extras: round1Extras(a) } : {};
};
const r0 = (n: number) => Math.round(n);

/** The best working set of one day of a lift (highest Epley estimate) and the reps of every working set at its weight. */
export type LiftDay = { e1rm: number; kg: number; reps: number; repsAtKg: number[] };

/** Weighted lifts of finished strength workouts: for each exercise, the best set of each day (sets of 12 reps or fewer). */
export function collectLifts(strength: Workout[]): Map<string, { name: string; days: Map<Day, LiftDay> }> {
  const byExercise = new Map<string, { name: string; days: Map<Day, LiftDay> }>();
  for (const w of strength) {
    for (const e of w.exercises) {
      if (e.load === 'bodyweight' || e.mode === 'time') continue;
      let best: LiftDay | null = null;
      for (const s of e.sets) {
        if (s.type !== 'working' || s.done === false) continue;
        const est = estimatedOneRepMax(s.weightKg, s.reps) ?? 0;
        if (est > (best?.e1rm ?? 0)) best = { e1rm: est, kg: s.weightKg ?? 0, reps: s.reps, repsAtKg: [] };
      }
      if (!best) continue;
      best.repsAtKg = e.sets.filter((s) => s.type === 'working' && s.done !== false && s.weightKg === best!.kg).map((s) => s.reps);
      const x = byExercise.get(e.exerciseRef) ?? { name: e.exerciseName, days: new Map<Day, LiftDay>() };
      const have = x.days.get(w.day);
      if (!have || best.e1rm > have.e1rm) x.days.set(w.day, best);
      byExercise.set(e.exerciseRef, x);
    }
  }
  return byExercise;
}

/** One lift's days as chart points and sessions (oldest first); a session is a new best when it beats every earlier day. */
export function liftSessions(daysMap: Map<Day, LiftDay>) {
  const days = [...daysMap].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const points = days.map(([day, t]) => ({ day, e1rmKg: r1(t.e1rm) }));
  let running = 0;
  const sessions = days.map(([day, t], k) => {
    const isBest = k > 0 && t.e1rm > running;
    running = Math.max(running, t.e1rm);
    return { day, topSet: { kg: r1(t.kg), reps: t.reps }, reps: t.repsAtKg, e1rm: r1(t.e1rm), isBest };
  });
  return { points, sessions };
}

export function buildProgress(i: ProgressInput): Progress {
  const days = dayNumber(i.to) - dayNumber(i.from) + 1;

  // ---- weight
  const wPoints = i.weights.map((w) => ({ day: w.day, value: w.kg }));
  const avg = movingAverage(wPoints);
  const trend = trendChange(avg);
  const latest = i.weights[i.weights.length - 1] ?? null;
  const goalKg = i.goals?.goalWeightKg ?? null;
  const weight: WeightProgress = {
    daily: i.weights.map((w) => ({ day: w.day, kg: r1(w.kg) })),
    average: avg.map((p) => ({ day: p.day, kg: r1(p.value) })),
    latestKg: latest ? r1(latest.kg) : null,
    latestDay: latest?.day ?? null,
    trendKg: avg.length ? r1(avg[avg.length - 1]!.value) : null,
    trendChangeKg: trend ? r1(trend.change) : null,
    goalKg,
    fromGoalKg: goalKg !== null && (avg.length || latest) ? r1(distanceFromGoal(avg.length ? avg[avg.length - 1]!.value : latest!.kg, goalKg)) : null,
  };

  // ---- nutrition
  const n = i.nutrition;
  const g = i.goals;
  const avgOf = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => (n.length ? n.reduce((s, d) => s + d[k], 0) / n.length : 0);
  const nutrition: NutritionProgress = {
    daily: n.map((d) => ({ day: d.day, kcal: r0(d.kcal), protein: r1(d.protein), carbs: r1(d.carbs), fat: r1(d.fat), ...(d.extras ? { extras: round1Extras(d.extras) } : {}) })),
    daysLogged: n.length,
    weeks: weeksIn(i.from, i.to).flatMap((week) => {
      const inWeek = n.filter((d) => d.day >= week && d.day <= addDays(week, 6));
      return inWeek.length ? [{ week, kcal: r0(inWeek.reduce((x, d) => x + d.kcal, 0) / inWeek.length), protein: r1(inWeek.reduce((x, d) => x + d.protein, 0) / inWeek.length), daysLogged: inWeek.length }] : [];
    }),
    proteinPerKg: n.length && avg.length ? Math.round((avgOf('protein') / avg[avg.length - 1]!.value) * 10) / 10 : null,
    averagePerLoggedDay: n.length ? { kcal: r0(avgOf('kcal')), protein: r1(avgOf('protein')), carbs: r1(avgOf('carbs')), fat: r1(avgOf('fat')), ...avgExtras(n) } : null,
    goals: { kcal: g?.kcal ?? null, proteinG: g?.proteinG ?? null, carbsG: g?.carbsG ?? null, fatG: g?.fatG ?? null, fiberG: g?.fiberG ?? null, satFatG: g?.satFatG ?? null, addedSugarG: g?.addedSugarG ?? null },
    adherence: {
      kcalWithin10Pct: g?.kcal ? n.filter((d) => Math.abs(d.kcal - g.kcal!) <= g.kcal! * 0.1).length : null,
      proteinReached: g?.proteinG ? n.filter((d) => d.protein >= g.proteinG! * 0.9).length : null,
      ofDays: n.length,
    },
  };

  // ---- training
  const strength = i.workouts.filter((w) => w.type === 'strength' && w.finishedAt !== null);
  const cardio = i.workouts.filter((w) => w.type === 'cardio');
  const sessions = i.workouts.filter((w) => w.type === 'session' && w.session);
  // The period starts where the data does: weeks before the first log would only drag the averages down.
  const logged: Day[] = [...i.weights.map((x) => x.day), ...i.nutrition.map((x) => x.day), ...strength.map((x) => x.day), ...cardio.map((x) => x.day), ...sessions.map((x) => x.day), ...i.measurements.map((x) => x.day), ...(i.metrics ?? []).map((x) => x.day)].filter((d) => d >= i.from && d <= i.to);
  const dataFrom = logged.length ? logged.reduce((a, b) => (a < b ? a : b)) : null;
  const start = dataFrom ?? i.from;
  const weekStarts = weeksIn(start, i.to);
  const weeks = weekStarts.map((week) => ({ week, partial: week < start || addDays(week, 6) > i.to, strength: 0, cardio: 0, cardioMin: 0, session: 0, sessionMin: 0, sets: {} as Record<string, number>, tonnageKg: 0 }));
  const weekOf = (d: Day) => weeks[Math.max(0, Math.floor((dayNumber(d) - dayNumber(weekStarts[0]!)) / 7))];
  for (const w of strength) {
    const wk = weekOf(w.day);
    if (!wk) continue;
    wk.strength++;
    // Warm-ups and finishers count as cardio minutes without making the session a second workout.
    for (const b of w.cardioBlocks) if (b.done) wk.cardioMin += b.durationMin ?? b.plannedMin;
    for (const e of w.exercises) {
      const working = e.sets.filter((s) => s.type === 'working' && s.done !== false);
      const done = working.length;
      if (!done) continue;
      if (e.mode !== 'time') wk.tonnageKg += working.reduce((n, s) => n + s.reps * (s.weightKg ?? 0), 0);
      const { primary, secondary } = i.musclesOf(e.exerciseRef);
      for (const [m, k] of muscleCredit(primary, secondary)) wk.sets[m] = (wk.sets[m] ?? 0) + done * k;
    }
  }
  for (const w of cardio) {
    const wk = weekOf(w.day);
    if (!wk) continue;
    wk.cardio++;
    wk.cardioMin += w.cardio?.durationMin ?? 0;
  }
  for (const w of sessions) {
    const wk = weekOf(w.day);
    if (!wk) continue;
    wk.session++;
    wk.sessionMin += w.session!.durationMin;
    for (const [m, credit] of Object.entries(sessionMuscleCredit(w.session!.category, w.session!.durationMin))) wk.sets[m] = (wk.sets[m] ?? 0) + credit;
  }
  for (const wk of weeks) wk.tonnageKg = r0(wk.tonnageKg);
  const full = weeks.filter((x) => !x.partial);
  const counted = full.length ? full : weeks;
  const weekCount = Math.max(1, full.length);
  const workoutsIn = (wk: (typeof weeks)[number]) => wk.strength + wk.cardio + wk.session;
  const muscleTotals = new Map<string, number>();
  for (const wk of counted) for (const [m, s] of Object.entries(wk.sets)) muscleTotals.set(m, (muscleTotals.get(m) ?? 0) + s);
  const timed = strength.filter((w) => w.startedAt && w.finishedAt && w.finishedAt > w.startedAt).map((w) => (w.finishedAt! - w.startedAt!) / 60000);
  const training: TrainingProgress = {
    weeks,
    sessions: { strength: strength.length, cardio: cardio.length, session: sessions.length },
    perWeek: r1(counted.reduce((n, x) => n + workoutsIn(x), 0) / weekCount),
    days: [...strength.map((w) => ({ day: w.day, type: 'strength' as const })), ...cardio.map((w) => ({ day: w.day, type: 'cardio' as const })), ...sessions.map((w) => ({ day: w.day, type: 'session' as const }))].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    averageStrengthMin: timed.length ? r0(timed.reduce((a, b) => a + b, 0) / timed.length) : null,
    setsPerWeekByMuscle: [...muscleTotals].map(([muscle, sets]) => ({ muscle, sets: r1(sets / weekCount) })).sort((a, b) => b.sets - a.sets),
    goalWorkoutsPerWeek: g?.workoutsPerWeek ?? null,
  };

  // ---- records: best estimated 1RM per day for each exercise with weighted working sets
  const records: RecordsProgress = {
    exercises: [...collectLifts(strength)]
      .map(([id, x]) => {
        const { points, sessions } = liftSessions(x.days);
        const best = points.reduce((b, p) => (p.e1rmKg > b.e1rmKg ? p : b), points[0]!);
        return { id, name: x.name, firstE1rmKg: points[0]!.e1rmKg, latestE1rmKg: points[points.length - 1]!.e1rmKg, bestE1rmKg: best.e1rmKg, bestDay: best.day, points, sessions: sessions.map((s) => ({ day: s.day, topSet: s.topSet, e1rm: s.e1rm, isBest: s.isBest })) };
      })
      .sort((a, b) => b.sessions.length - a.sessions.length || a.name.localeCompare(b.name))
      .slice(0, 12),
  };

  // ---- measurements: first and latest value per type in the period
  const types: MeasurementProgress['types'] = [];
  for (const p of PRESETS) {
    const pts = i.measurements.filter((m) => m.values[p.key] !== undefined);
    if (!pts.length) continue;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    types.push({ key: p.key, label: p.label, unit: p.kind === 'percent' ? '%' : 'cm', firstDay: first.day, first: r1(first.values[p.key]!), latestDay: last.day, latest: r1(last.values[p.key]!), change: r1(last.values[p.key]! - first.values[p.key]!), points: pts.map((m) => ({ day: m.day, value: r1(m.values[p.key]!) })) });
  }

  // ---- sleep, steps, water
  const m = i.metrics ?? [];
  const mean = (xs: number[], digits: number) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10 ** digits) / 10 ** digits : null);
  const sleep = m.filter((x) => x.sleepH !== undefined).map((x) => ({ day: x.day, hours: r1(x.sleepH!) }));
  const steps = m.filter((x) => x.steps !== undefined).map((x) => ({ day: x.day, steps: x.steps! }));
  const water = m.filter((x) => x.waterMl !== undefined).map((x) => ({ day: x.day, ml: x.waterMl! }));
  const metrics: MetricsProgress = {
    sleep: { daily: sleep, averageHours: mean(sleep.map((x) => x.hours), 1), goalHours: g?.sleepH ?? null },
    steps: { daily: steps, average: mean(steps.map((x) => x.steps), 0) },
    water: { daily: water, averageMl: mean(water.map((x) => x.ml), 0) },
  };

  return { from: i.from, to: i.to, days, dataFrom, weight, nutrition, training, records, measurements: { types }, metrics, energy: buildEnergy(i, days) };
}

/** Expenditure from the last (up to) 28 days of the period, what it means for the goal weight, and when it is reached. */
function buildEnergy(i: ProgressInput, days: number): EnergyProgress {
  const e = estimateExpenditure({ intake: i.nutrition.map((d) => ({ day: d.day, kcal: d.kcal })), weights: i.weights.map((w) => ({ day: w.day, kg: w.kg })), to: i.to, windowDays: Math.min(28, days) });
  const goalKg = i.goals?.goalWeightKg ?? null;
  const direction = e.trendKg !== null && goalKg !== null ? goalDirection(e.trendKg, goalKg) : null;
  const target = e.kcal !== null && direction ? targetFromExpenditure(e.kcal, direction, undefined, i.bmrKcal) : null;
  const goalDate = direction && direction !== 'maintain' && e.trendKg !== null && e.trendKgPerWeek !== null ? projectGoalDate(e.trendKg, e.trendKgPerWeek, goalKg!, i.to) : null;
  return {
    expenditureKcal: e.kcal,
    reason: e.reason,
    confidence: e.confidence,
    from: e.from,
    to: e.to,
    daysCounted: e.daysCounted,
    daysExcluded: e.daysExcluded,
    weighIns: e.weighIns,
    intakeKcal: e.intakeKcal,
    trendKgPerWeek: e.trendKgPerWeek,
    trendKg: e.trendKg,
    goalKcal: i.goals?.kcal ?? null,
    direction,
    suggestedKcal: target?.kcal ?? null,
    suggestedRateKgPerWeek: target?.rateKgPerWeek ?? null,
    goalDate,
    notes: [...e.notes, ...(target?.notes ?? [])],
  };
}

/** The short version for the model: no daily series, just what to talk about. */
export function summarize(p: Progress) {
  const { weight: w, nutrition: n, training: t, records: r, measurements: m, metrics: x } = p;
  return {
    period: { from: p.from, to: p.to, days: p.days, dataFrom: p.dataFrom },
    weight: { latestKg: w.latestKg, latestDay: w.latestDay, weighIns: w.daily.length, trendChangeKg: w.trendChangeKg, trendNote: w.trendChangeKg === null ? 'Needs at least 3 weigh-ins within a week to show a trend.' : 'Change of the 7-day average over the period.', goalKg: w.goalKg, fromGoalKg: w.fromGoalKg },
    nutrition: { daysLogged: n.daysLogged, averagePerLoggedDay: n.averagePerLoggedDay, proteinPerKg: n.proteinPerKg, goals: n.goals, adherence: n.adherence },
    training: { sessions: t.sessions, perWeek: t.perWeek, goalWorkoutsPerWeek: t.goalWorkoutsPerWeek, averageStrengthMin: t.averageStrengthMin, setsPerWeekByMuscle: t.setsPerWeekByMuscle.slice(0, 10) },
    records: r.exercises.map((e) => ({ name: e.name, sessions: e.sessions.length, firstE1rmKg: e.firstE1rmKg, latestE1rmKg: e.latestE1rmKg, bestE1rmKg: e.bestE1rmKg, bestDay: e.bestDay })),
    measurements: m.types.map((t) => ({ key: t.key, label: t.label, unit: t.unit, firstDay: t.firstDay, first: t.first, latestDay: t.latestDay, latest: t.latest, change: t.change })),
    energy: { ...p.energy, method: 'Average intake on fully logged days minus the weight trend (least squares) × 7700 kcal/kg; each 0.1 kg a week is about 110 kcal a day. suggest_targets with expenditure_kcal gives macros for any rate.' },
    dailyMetrics: { sleepAverageHours: x.sleep.averageHours, sleepGoalHours: x.sleep.goalHours, nightsLogged: x.sleep.daily.length, stepsAverage: x.steps.average, stepsDaysLogged: x.steps.daily.length, waterAverageMl: x.water.averageMl, waterDaysLogged: x.water.daily.length },
  };
}

export const rangeStart = (to: Day, days: number): Day => addDays(to, -(days - 1));
