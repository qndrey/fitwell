import type { FoodEntry, MeasurementEntry, MeasurementType, Workout, WeightEntry } from '../db/schema';
import { addDays, addMonths, dayFromNumber, dayNumber, weekStart, type Day } from './dates';
import { cardioKcal, estimatedOneRepMax, sessionMinutes } from './workouts';

// ---------------------------------------------------------------- ranges
export type RangeKey = '1m' | '3m' | '6m' | '1y' | 'all';
export const RANGES: RangeKey[] = ['1m', '3m', '6m', '1y', 'all'];

/** First day of the selected range (inclusive). `all` starts at the earliest data, or `today` when there is none. */
export function rangeStart(range: RangeKey, today: Day, earliest?: Day): Day {
  switch (range) {
    case '1m': return addDays(addMonths(today, -1), 1);
    case '3m': return addDays(addMonths(today, -3), 1);
    case '6m': return addDays(addMonths(today, -6), 1);
    case '1y': return addDays(addMonths(today, -12), 1);
    case 'all': return earliest && earliest < today ? earliest : today;
  }
}

export const daysBetween = (from: Day, to: Day): number => dayNumber(to) - dayNumber(from) + 1;

// ---------------------------------------------------------------- daily aggregates (computed, never stored)
export interface DayAgg {
  day: Day;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Resolved entries: these are the ones that count toward totals. */
  foodCount: number;
  /** Entries still waiting for a lookup or a decision. */
  pendingCount: number;
  strength: number;
  cardio: number;
  cardioMin: number;
  distanceKm: number;
  weightKg?: number;
  measured: boolean;
}

export interface RangeData {
  entries: FoodEntry[];
  workouts: Workout[];
  weights: WeightEntry[];
  measurements: MeasurementEntry[];
}

const blank = (day: Day): DayAgg => ({ day, kcal: 0, protein: 0, carbs: 0, fat: 0, foodCount: 0, pendingCount: 0, strength: 0, cardio: 0, cardioMin: 0, distanceKm: 0, measured: false });

/** One row per day that has anything logged. Deleted records are ignored. */
export function aggregateDays(data: RangeData): Map<Day, DayAgg> {
  const days = new Map<Day, DayAgg>();
  const at = (d: Day) => days.get(d) ?? (days.set(d, blank(d)), days.get(d)!);

  for (const e of data.entries) {
    if (e.deletedAt !== undefined) continue;
    const a = at(e.day);
    if (e.state === 'resolved' && e.nutrition) {
      a.kcal += e.nutrition.kcal;
      a.protein += e.nutrition.protein;
      a.carbs += e.nutrition.carbs;
      a.fat += e.nutrition.fat;
      a.foodCount++;
    } else if (e.state !== 'resolved') a.pendingCount++;
  }
  for (const w of data.workouts) {
    if (w.deletedAt !== undefined) continue;
    const a = at(w.day);
    if (w.type === 'strength') a.strength++;
    else {
      a.cardio++;
      a.cardioMin += w.cardio?.durationMin ?? 0;
      a.distanceKm += w.cardio?.distanceKm ?? 0;
    }
  }
  for (const w of data.weights) if (w.deletedAt === undefined) at(w.day).weightKg = w.kg;
  for (const m of data.measurements) if (m.deletedAt === undefined && Object.keys(m.values).length) at(m.day).measured = true;
  return days;
}

// ---------------------------------------------------------------- smoothing and trends
export interface Point {
  day: Day;
  value: number;
}

/**
 * Trailing moving average over calendar days (default 7), computed for every day between the first and last
 * point, but only where the window holds at least `minPoints` readings. Gaps in logging are therefore honest:
 * the line stops rather than inventing numbers.
 */
export function movingAverage(points: Point[], windowDays = 7, minPoints = 3): Point[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => dayNumber(a.day) - dayNumber(b.day));
  const first = dayNumber(sorted[0]!.day);
  const last = dayNumber(sorted[sorted.length - 1]!.day);
  const out: Point[] = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let n = first; n <= last; n++) {
    while (hi < sorted.length && dayNumber(sorted[hi]!.day) <= n) sum += sorted[hi++]!.value;
    while (lo < hi && dayNumber(sorted[lo]!.day) <= n - windowDays) sum -= sorted[lo++]!.value;
    if (hi - lo >= minPoints) out.push({ day: dayFromNumber(n), value: sum / (hi - lo) });
  }
  return out;
}

/** Change of the smoothed line across the period (last − first), not the latest raw reading. */
export function trendChange(ma: Point[]): { from: Point; to: Point; change: number } | null {
  if (ma.length < 2) return null;
  const from = ma[0]!;
  const to = ma[ma.length - 1]!;
  return { from, to, change: to.value - from.value };
}

/** Largest-Triangle-Three-Buckets: keeps the visual shape of a long series in `max` points. */
export function downsample<T extends { x: number; y: number }>(pts: T[], max: number): T[] {
  if (max < 3 || pts.length <= max) return pts;
  const out: T[] = [pts[0]!];
  const every = (pts.length - 2) / (max - 2);
  let a = 0;
  for (let i = 0; i < max - 2; i++) {
    const nextStart = Math.floor((i + 1) * every) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * every) + 1, pts.length);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += pts[j]!.x;
      avgY += pts[j]!.y;
    }
    const count = Math.max(1, nextEnd - nextStart);
    avgX /= count;
    avgY /= count;
    const start = Math.floor(i * every) + 1;
    const end = Math.floor((i + 1) * every) + 1;
    let best = -1;
    let pick = start;
    for (let j = start; j < end; j++) {
      const area = Math.abs((pts[a]!.x - avgX) * (pts[j]!.y - pts[a]!.y) - (pts[a]!.x - pts[j]!.x) * (avgY - pts[a]!.y));
      if (area > best) {
        best = area;
        pick = j;
      }
    }
    out.push(pts[pick]!);
    a = pick;
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

// ---------------------------------------------------------------- weeks
export interface Week {
  /** Monday. */
  start: Day;
}

/** Every week (Monday start) that overlaps [from, to], oldest first. */
export function weeksIn(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let n = dayNumber(weekStart(from)); n <= dayNumber(to); n += 7) out.push(dayFromNumber(n));
  return out;
}

/** Average of `field` per week over days that have food logged (days without logging don't drag it down). */
export function weeklyAverage(days: Map<Day, DayAgg>, field: 'kcal' | 'protein' | 'carbs' | 'fat', from: Day, to: Day): { start: Day; value: number | undefined; days: number }[] {
  const sums = new Map<Day, { sum: number; n: number }>();
  for (const a of days.values()) {
    if (a.foodCount === 0 || a.day < from || a.day > to) continue;
    const k = weekStart(a.day);
    const s = sums.get(k) ?? { sum: 0, n: 0 };
    s.sum += a[field];
    s.n++;
    sums.set(k, s);
  }
  return weeksIn(from, to).map((start) => {
    const s = sums.get(start);
    return { start, value: s ? s.sum / s.n : undefined, days: s?.n ?? 0 };
  });
}

export function workoutsPerWeek(days: Map<Day, DayAgg>, from: Day, to: Day): { start: Day; strength: number; cardio: number }[] {
  const by = new Map<Day, { strength: number; cardio: number }>();
  for (const a of days.values()) {
    if (a.day < from || a.day > to || a.strength + a.cardio === 0) continue;
    const k = weekStart(a.day);
    const s = by.get(k) ?? { strength: 0, cardio: 0 };
    s.strength += a.strength;
    s.cardio += a.cardio;
    by.set(k, s);
  }
  return weeksIn(from, to).map((start) => ({ start, ...(by.get(start) ?? { strength: 0, cardio: 0 }) }));
}

export interface CardioWeek {
  start: Day;
  minutes: number;
  km: number;
  sessions: number;
  kcal: number;
}

/** Cardio totals per week, optionally for one activity only. */
export function cardioPerWeek(workouts: Workout[], from: Day, to: Day, activityRef?: string): CardioWeek[] {
  const by = new Map<Day, CardioWeek>();
  for (const w of workouts) {
    if (w.deletedAt !== undefined || w.type !== 'cardio' || !w.cardio || w.day < from || w.day > to) continue;
    if (activityRef && w.cardio.activityRef !== activityRef) continue;
    const k = weekStart(w.day);
    const c = by.get(k) ?? { start: k, minutes: 0, km: 0, sessions: 0, kcal: 0 };
    c.minutes += w.cardio.durationMin;
    c.km += w.cardio.distanceKm ?? 0;
    c.sessions++;
    c.kcal += cardioKcal(w.cardio) ?? 0;
    by.set(k, c);
  }
  return weeksIn(from, to).map((start) => by.get(start) ?? { start, minutes: 0, km: 0, sessions: 0, kcal: 0 });
}

export function cardioActivities(workouts: Workout[]): { ref: string; name: string; sessions: number }[] {
  const m = new Map<string, { ref: string; name: string; sessions: number; last: string }>();
  for (const w of workouts) {
    if (w.deletedAt !== undefined || w.type !== 'cardio' || !w.cardio) continue;
    const e = m.get(w.cardio.activityRef) ?? { ref: w.cardio.activityRef, name: w.cardio.activityName, sessions: 0, last: '' };
    e.sessions++;
    if (w.day > e.last) {
      e.last = w.day;
      e.name = w.cardio.activityName;
    }
    m.set(w.cardio.activityRef, e);
  }
  return [...m.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- strength progress
export interface ExercisePoint {
  day: Day;
  /** Heaviest working set that day (kg). */
  bestKg: number;
  /** Highest Epley estimate of a one-rep max from a working set of up to 12 reps (kg). */
  e1rmKg?: number;
}

export interface WorkoutTime {
  /** Average over every workout that has a time: timed strength sessions and cardio entries. */
  avgMin: number;
  count: number;
  strengthAvgMin?: number;
  strengthCount: number;
  cardioAvgMin?: number;
  cardioCount: number;
}

/**
 * How long workouts take on average between two days. Strength counts only sessions that were timed and finished
 * (workouts logged afterwards or older ones have no time and are left out, not counted as zero); cardio uses its duration.
 * Returns null when no workout in the range has a time.
 */
export function averageWorkoutTime(workouts: Workout[], from: Day, to: Day): WorkoutTime | null {
  const strength: number[] = [];
  const cardio: number[] = [];
  for (const w of workouts) {
    if (w.deletedAt !== undefined || w.day < from || w.day > to) continue;
    if (w.type === 'strength') {
      const m = sessionMinutes(w);
      if (m !== undefined) strength.push(m);
    } else if (w.cardio && w.cardio.durationMin > 0) {
      cardio.push(w.cardio.durationMin);
    }
  }
  const all = [...strength, ...cardio];
  if (all.length === 0) return null;
  const avg = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : undefined);
  return { avgMin: avg(all)!, count: all.length, strengthAvgMin: avg(strength), strengthCount: strength.length, cardioAvgMin: avg(cardio), cardioCount: cardio.length };
}

/** One point per day the exercise was done. Warm-ups never count. */
export function exerciseProgress(workouts: Workout[], exerciseRef: string): ExercisePoint[] {
  const by = new Map<Day, ExercisePoint>();
  for (const w of workouts) {
    if (w.deletedAt !== undefined || w.type !== 'strength') continue;
    for (const e of w.exercises ?? []) {
      if (e.exerciseRef !== exerciseRef || e.mode === 'time') continue;
      for (const s of e.sets) {
        if (s.type !== 'working' || s.done === false || s.reps < 1 || s.weightKg <= 0) continue;
        const p = by.get(w.day) ?? { day: w.day, bestKg: 0 };
        p.bestKg = Math.max(p.bestKg, s.weightKg);
        const est = estimatedOneRepMax(s.weightKg, s.reps);
        if (est !== undefined) p.e1rmKg = Math.max(p.e1rmKg ?? 0, est);
        by.set(w.day, p);
      }
    }
  }
  return [...by.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Exercises you have logged with at least one weighted working set, most-done first. */
export function exerciseOptions(workouts: Workout[]): { ref: string; name: string; sessions: number }[] {
  const m = new Map<string, { ref: string; name: string; days: Set<Day>; last: string }>();
  for (const w of workouts) {
    if (w.deletedAt !== undefined || w.type !== 'strength') continue;
    for (const e of w.exercises ?? []) {
      if (e.mode === 'time' || !e.sets.some((s) => s.type === 'working' && s.done !== false && s.reps >= 1 && s.weightKg > 0)) continue;
      const x = m.get(e.exerciseRef) ?? { ref: e.exerciseRef, name: e.exerciseName, days: new Set<Day>(), last: '' };
      x.days.add(w.day);
      if (w.day > x.last) {
        x.last = w.day;
        x.name = e.exerciseName;
      }
      m.set(e.exerciseRef, x);
    }
  }
  return [...m.values()].map((x) => ({ ref: x.ref, name: x.name, sessions: x.days.size })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- body measurements
export function measurementPoints(entries: MeasurementEntry[], typeId: string): Point[] {
  return entries
    .filter((e) => e.deletedAt === undefined && e.values[typeId] !== undefined)
    .map((e) => ({ day: e.day, value: e.values[typeId]! }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

export interface Comparison {
  type: MeasurementType;
  first: Point;
  latest: Point;
  change: number;
}

/** First vs latest reading in the data, for each type that has at least two. */
export function compareFirstLatest(entries: MeasurementEntry[], types: MeasurementType[]): Comparison[] {
  const out: Comparison[] = [];
  for (const type of types) {
    const pts = measurementPoints(entries, type.id);
    if (pts.length >= 2) out.push({ type, first: pts[0]!, latest: pts[pts.length - 1]!, change: pts[pts.length - 1]!.value - pts[0]!.value });
  }
  return out;
}
