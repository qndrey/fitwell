// Progress numbers for Claude and for the dashboard, from a person's stored rows. Pure: no I/O.
import { sessionMuscleCredit } from '../workout/sessions';
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
  /** Primary muscles of a library exercise id. */
  musclesOf: (exerciseRef: string) => string[];
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
    trendChangeKg: trend ? r1(trend.change) : null,
    goalKg,
    fromGoalKg: latest && goalKg !== null ? r1(distanceFromGoal(latest.kg, goalKg)) : null,
  };

  // ---- nutrition
  const n = i.nutrition;
  const g = i.goals;
  const avgOf = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => (n.length ? n.reduce((s, d) => s + d[k], 0) / n.length : 0);
  const nutrition: NutritionProgress = {
    daily: n.map((d) => ({ day: d.day, kcal: r0(d.kcal), protein: r1(d.protein), carbs: r1(d.carbs), fat: r1(d.fat), ...(d.extras ? { extras: round1Extras(d.extras) } : {}) })),
    daysLogged: n.length,
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
  const weekStarts = weeksIn(i.from, i.to);
  const weeks = weekStarts.map((week) => ({ week, strength: 0, cardio: 0, cardioMin: 0, session: 0, sessionMin: 0, sets: {} as Record<string, number> }));
  const weekOf = (d: Day) => weeks[Math.max(0, Math.floor((dayNumber(d) - dayNumber(weekStarts[0]!)) / 7))];
  for (const w of strength) {
    const wk = weekOf(w.day);
    if (!wk) continue;
    wk.strength++;
    // Warm-ups and finishers count as cardio minutes without making the session a second workout.
    for (const b of w.cardioBlocks) if (b.done) wk.cardioMin += b.durationMin ?? b.plannedMin;
    for (const e of w.exercises) {
      const done = e.sets.filter((s) => s.type === 'working' && s.done !== false).length;
      if (!done) continue;
      for (const m of i.musclesOf(e.exerciseRef)) wk.sets[m] = (wk.sets[m] ?? 0) + done;
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
  const muscleTotals = new Map<string, number>();
  for (const wk of weeks) for (const [m, s] of Object.entries(wk.sets)) muscleTotals.set(m, (muscleTotals.get(m) ?? 0) + s);
  const timed = strength.filter((w) => w.startedAt && w.finishedAt && w.finishedAt > w.startedAt).map((w) => (w.finishedAt! - w.startedAt!) / 60000);
  const training: TrainingProgress = {
    weeks,
    sessions: { strength: strength.length, cardio: cardio.length, session: sessions.length },
    averageStrengthMin: timed.length ? r0(timed.reduce((a, b) => a + b, 0) / timed.length) : null,
    setsPerWeekByMuscle: [...muscleTotals].map(([muscle, sets]) => ({ muscle, sets: r1(sets / Math.max(1, weeks.length)) })).sort((a, b) => b.sets - a.sets),
    goalWorkoutsPerWeek: g?.workoutsPerWeek ?? null,
  };

  // ---- records: best estimated 1RM per day for each exercise with weighted working sets
  const byExercise = new Map<string, { name: string; days: Map<Day, number> }>();
  for (const w of strength) {
    for (const e of w.exercises) {
      if (e.load === 'bodyweight' || e.mode === 'time') continue;
      let best = 0;
      for (const s of e.sets) if (s.type === 'working' && s.done !== false) best = Math.max(best, estimatedOneRepMax(s.weightKg, s.reps) ?? 0);
      if (best <= 0) continue;
      const x = byExercise.get(e.exerciseRef) ?? { name: e.exerciseName, days: new Map<Day, number>() };
      x.days.set(w.day, Math.max(x.days.get(w.day) ?? 0, best));
      byExercise.set(e.exerciseRef, x);
    }
  }
  const records: RecordsProgress = {
    exercises: [...byExercise]
      .map(([id, x]) => {
        const points = [...x.days].map(([day, e1rmKg]) => ({ day, e1rmKg: r1(e1rmKg) })).sort((a, b) => (a.day < b.day ? -1 : 1));
        const best = points.reduce((b, p) => (p.e1rmKg > b.e1rmKg ? p : b), points[0]!);
        return { id, name: x.name, sessions: points.length, firstE1rmKg: points[0]!.e1rmKg, latestE1rmKg: points[points.length - 1]!.e1rmKg, bestE1rmKg: best.e1rmKg, bestDay: best.day, points };
      })
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
      .slice(0, 6),
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
    sleep: { daily: sleep, averageHours: mean(sleep.map((x) => x.hours), 1) },
    steps: { daily: steps, average: mean(steps.map((x) => x.steps), 0) },
    water: { daily: water, averageMl: mean(water.map((x) => x.ml), 0) },
  };

  return { from: i.from, to: i.to, days, weight, nutrition, training, records, measurements: { types }, metrics, energy: buildEnergy(i, days) };
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
    period: { from: p.from, to: p.to, days: p.days },
    weight: { latestKg: w.latestKg, latestDay: w.latestDay, weighIns: w.daily.length, trendChangeKg: w.trendChangeKg, trendNote: w.trendChangeKg === null ? 'Needs at least 3 weigh-ins within a week to show a trend.' : 'Change of the 7-day average over the period.', goalKg: w.goalKg, fromGoalKg: w.fromGoalKg },
    nutrition: { daysLogged: n.daysLogged, averagePerLoggedDay: n.averagePerLoggedDay, goals: n.goals, adherence: n.adherence },
    training: { sessions: t.sessions, perWeek: r1((t.sessions.strength + t.sessions.cardio + t.sessions.session) / Math.max(1, t.weeks.length)), goalWorkoutsPerWeek: t.goalWorkoutsPerWeek, averageStrengthMin: t.averageStrengthMin, setsPerWeekByMuscle: t.setsPerWeekByMuscle.slice(0, 10) },
    records: r.exercises.map((e) => ({ name: e.name, sessions: e.sessions, firstE1rmKg: e.firstE1rmKg, latestE1rmKg: e.latestE1rmKg, bestE1rmKg: e.bestE1rmKg, bestDay: e.bestDay })),
    measurements: m.types.map((t) => ({ key: t.key, label: t.label, unit: t.unit, firstDay: t.firstDay, first: t.first, latestDay: t.latestDay, latest: t.latest, change: t.change })),
    energy: { ...p.energy, method: 'Average intake on fully logged days minus the weight trend (least squares) × 7700 kcal/kg; each 0.1 kg a week is about 110 kcal a day. suggest_targets with expenditure_kcal gives macros for any rate.' },
    dailyMetrics: { sleepAverageHours: x.sleep.averageHours, nightsLogged: x.sleep.daily.length, stepsAverage: x.steps.average, stepsDaysLogged: x.steps.daily.length, waterAverageMl: x.water.averageMl, waterDaysLogged: x.water.daily.length },
  };
}

export const rangeStart = (to: Day, days: number): Day => addDays(to, -(days - 1));
