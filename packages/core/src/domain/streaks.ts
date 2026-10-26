import { addDays, dayFromNumber, dayNumber, isDay, weekStart } from './dates';
import type { Day } from './dates';
import { goalDirection } from './energy';
import { movingAverage } from './stats';

export type StreakWorkoutType = 'strength' | 'cardio' | 'session';

export interface StreakWorkout {
  day: Day;
  type: StreakWorkoutType;
  /** Strength: finish_workout was called. Ignored for cardio and session. */
  finished: boolean;
  /** Session: the row carries its session details (category, minutes). Ignored for strength and cardio. */
  hasDetails: boolean;
}

/** One logged food entry (several per day are allowed). */
export interface StreakFoodEntry {
  day: Day;
  proteinG: number;
}

export interface StreakWeighIn {
  day: Day;
  kg: number;
}

export interface StreakGoals {
  /** Weekly workout target; null or 0 = none. */
  workoutsPerWeek: number | null;
  /** Daily protein goal in g; null or 0 = none. */
  proteinG: number | null;
  goalWeightKg: number | null;
  /** The day the goal weight was set; required for a goal result. */
  goalWeightSince: Day | null;
}

export interface StreakInput {
  /** The person's local today (the caller applies the time zone). */
  today: Day;
  /** First day of the history the caller loaded (on or before today). */
  historyFrom: Day;
  /** Whether the person has data before historyFrom. */
  olderDataExists: boolean;
  workouts: StreakWorkout[];
  food: StreakFoodEntry[];
  /** Including at least the 6 days before goalWeightSince, when a goal weight is set. */
  weighIns: StreakWeighIn[];
  goals: StreakGoals;
  /** Any day in a frozen week; several per week are allowed. */
  freezes?: Day[];
  /** Logged days a week for the logging week streak; integer 1 to 7. Default 5. */
  loggingTarget?: number;
}

export type StreakReason = 'no_target' | 'too_few_weigh_ins' | 'keeping_weight' | 'not_reached';

export interface MilestoneReached {
  threshold: number;
  day: Day;
}

export interface Streak {
  unit: 'week' | 'day';
  /** Counted weeks or days in the current run. */
  current: number;
  /** Monday of the run's first counted week, or its first day; null when current is 0. */
  startedOn: Day | null;
  /** The current run reaches historyFrom and olderDataExists is true. */
  atLeast: boolean;
  /** The current week (weekly) or today (daily), so far. */
  running: { done: number; target: number; met: boolean };
  /** Weeks of the current run forgiven; always 0 for daily streaks. */
  forgiven: { freeze: number; allowance: number };
  best: {
    length: number;
    /** Sunday of the last counted week, or the last day; null when isCurrent or length is 0. */
    endedOn: Day | null;
    isCurrent: boolean;
    atLeast: boolean;
  };
  next: { threshold: number; remaining: number };
  /** Every milestone the current run has reached, ascending. */
  milestones: MilestoneReached[];
}

export type OptionalStreak = { status: 'ok'; streak: Streak } | { status: 'none'; reason: 'no_target' };

export type GoalResult =
  | { status: 'none'; reason: 'no_target' | 'too_few_weigh_ins' | 'keeping_weight' }
  | { status: 'not_reached'; reason: 'not_reached'; direction: 'lose' | 'gain' }
  | { status: 'reached'; direction: 'lose' | 'gain'; reachedOn: Day };

export interface StreakResult {
  training: OptionalStreak;
  loggingDays: Streak;
  loggingWeeks: Streak;
  proteinDays: OptionalStreak;
  weightGoal: GoalResult;
}

export const WEEK_MILESTONES: readonly number[] = [1, 2, 3, 5, 7, 14, 21, 30, 52];
export const DAY_MILESTONES: readonly number[] = [1, 2, 3, 5, 7, 14, 21, 30, 50, 100, 200, 365];

const DEFAULT_LOGGING_TARGET = 5;

/** The smallest milestone of the unit greater than `n`; past the list it continues every 52 weeks or 365 days. */
export function nextMilestone(unit: 'week' | 'day', n: number): number {
  const list = unit === 'week' ? WEEK_MILESTONES : DAY_MILESTONES;
  const found = list.find((m) => m > n);
  if (found !== undefined) return found;
  const step = unit === 'week' ? 52 : 365;
  return (Math.floor(n / step) + 1) * step;
}

function requireDay(value: unknown, field: string): Day {
  if (typeof value !== 'string' || !isDay(value)) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD day, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireLoggingTarget(value: number | undefined | null): number {
  if (value === undefined || value === null) return DEFAULT_LOGGING_TARGET;
  if (!Number.isInteger(value) || value < 1 || value > 7) {
    throw new RangeError(`loggingTarget must be an integer from 1 to 7, got ${String(value)}`);
  }
  return value;
}

interface Prepared {
  today: Day;
  historyFrom: Day;
  firstWeek: Day;
  currentWeek: Day;
  olderDataExists: boolean;
  workouts: StreakWorkout[];
  food: StreakFoodEntry[];
  weighIns: StreakWeighIn[];
  frozenWeeks: Set<Day>;
  goals: StreakGoals;
  loggingTarget: number;
}

/** Validates the input and keeps only what falls inside the time window, without touching the caller's arrays. */
function prepare(input: StreakInput): Prepared {
  const today = requireDay(input.today, 'today');
  const historyFrom = requireDay(input.historyFrom, 'historyFrom');
  if (dayNumber(historyFrom) > dayNumber(today)) {
    throw new RangeError(`historyFrom (${historyFrom}) must not be after today (${today})`);
  }
  const loggingTarget = requireLoggingTarget(input.loggingTarget);
  const goals = input.goals;
  if (goals.goalWeightSince !== null) requireDay(goals.goalWeightSince, 'goals.goalWeightSince');

  const todayNo = dayNumber(today);
  const fromNo = dayNumber(historyFrom);
  const currentWeek = weekStart(today);
  const currentWeekNo = dayNumber(currentWeek);

  const workouts: StreakWorkout[] = [];
  input.workouts.forEach((w, i) => {
    const n = dayNumber(requireDay(w.day, `workouts[${i}].day`));
    if (n >= fromNo && n <= todayNo) workouts.push(w);
  });

  const food: StreakFoodEntry[] = [];
  input.food.forEach((f, i) => {
    const n = dayNumber(requireDay(f.day, `food[${i}].day`));
    if (n >= fromNo && n <= todayNo) food.push(f);
  });

  const weighIns: StreakWeighIn[] = [];
  input.weighIns.forEach((w, i) => {
    const n = dayNumber(requireDay(w.day, `weighIns[${i}].day`));
    if (n <= todayNo) weighIns.push(w);
  });

  const frozenWeeks = new Set<Day>();
  (input.freezes ?? []).forEach((d, i) => {
    const week = weekStart(requireDay(d, `freezes[${i}]`));
    if (dayNumber(week) <= currentWeekNo) frozenWeeks.add(week);
  });

  return {
    today,
    historyFrom,
    firstWeek: weekStart(historyFrom),
    currentWeek,
    olderDataExists: input.olderDataExists,
    workouts,
    food,
    weighIns,
    frozenWeeks,
    goals,
    loggingTarget,
  };
}

const hasTarget = (n: number | null): n is number => n !== null && n > 0;

/** How many weeks back the forgiveness rules look. */
const FORGIVE_WINDOW = 11;
const FREEZE_SLOTS = 4;
const REACH_DAYS = 7;
const PROTEIN_SHARE = 0.9;

interface Run {
  /** Monday of the first counted week, or the first counted day. */
  start: Day;
  /** The day each counted week met its target, or each counted day, in order. */
  days: Day[];
  /** Index (from the first evaluated week) of every forgiven week, by cause. */
  freezeWeeks: number[];
  allowanceWeeks: number[];
  /** Monday of the last counted week, or the last counted day. */
  last: Day;
}

interface Walked {
  ended: { length: number; endedOn: Day; start: Day }[];
  current: Run | null;
}

const recent = (weeks: number[], i: number) => weeks.filter((w) => w >= i - FORGIVE_WINDOW && w < i).length;

/**
 * Walks the complete weeks oldest first (FR4, FR6). `metDays[i]` is the day week i met its target, or null when it
 * was below it. `currentMet` is the same for the running week, applied last; below target it changes nothing (FR7).
 */
function walkWeeks(firstWeek: Day, metDays: (Day | null)[], frozen: Set<Day>, currentMet: Day | null): Walked {
  const ended: Walked['ended'] = [];
  let run: Run | null = null;
  const firstNo = dayNumber(firstWeek);
  const monday = (i: number) => dayFromNumber(firstNo + i * 7);

  const met = (i: number, day: Day) => {
    const m = monday(i);
    if (!run) run = { start: m, days: [], freezeWeeks: [], allowanceWeeks: [], last: m };
    run.days.push(day);
    run.last = m;
  };

  metDays.forEach((day, i) => {
    if (day !== null) return met(i, day);
    if (!run) return;
    if (frozen.has(monday(i)) && recent(run.freezeWeeks, i) < FREEZE_SLOTS) run.freezeWeeks.push(i);
    else if (recent(run.allowanceWeeks, i) === 0) run.allowanceWeeks.push(i);
    else {
      ended.push({ length: run.days.length, endedOn: addDays(run.last, 6), start: run.start });
      run = null;
    }
  });
  if (currentMet !== null) met(metDays.length, currentMet);
  return { ended, current: run };
}

/** Walks the days oldest first (FR8, FR10): a counted day extends the run, any other day ends it; today only ever counts. */
function walkDays(fromNo: number, todayNo: number, counts: (no: number) => boolean): { walked: Walked; todayCounted: boolean } {
  const ended: Walked['ended'] = [];
  let run = null as Run | null; // assigned in a closure, which narrowing cannot see
  const count = (no: number) => {
    const day = dayFromNumber(no);
    if (!run) run = { start: day, days: [], freezeWeeks: [], allowanceWeeks: [], last: day };
    run.days.push(day);
    run.last = day;
  };
  for (let no = fromNo; no < todayNo; no++) {
    if (counts(no)) count(no);
    else if (run) {
      ended.push({ length: run.days.length, endedOn: run.last, start: run.start });
      run = null;
    }
  }
  const todayCounted = counts(todayNo);
  if (todayCounted) count(todayNo);
  return { walked: { ended, current: run }, todayCounted };
}

function buildStreak(unit: 'week' | 'day', walked: Walked, running: Streak['running'], firstStart: Day, olderDataExists: boolean): Streak {
  const { ended, current } = walked;
  const length = current ? current.days.length : 0;
  const atLeast = (start: Day) => olderDataExists && start === firstStart;

  // The most recent run wins a tie, so the current run is compared last.
  let best: Streak['best'] = { length: 0, endedOn: null, isCurrent: false, atLeast: false };
  for (const r of ended) {
    if (r.length >= best.length) best = { length: r.length, endedOn: r.endedOn, isCurrent: false, atLeast: atLeast(r.start) };
  }
  if (current && length >= best.length) best = { length, endedOn: null, isCurrent: true, atLeast: atLeast(current.start) };

  const milestones: MilestoneReached[] = [];
  for (let t = nextMilestone(unit, 0); current && t <= length; t = nextMilestone(unit, t)) {
    milestones.push({ threshold: t, day: current.days[t - 1]! });
  }
  const threshold = nextMilestone(unit, length);
  return {
    unit,
    current: length,
    startedOn: current ? current.start : null,
    atLeast: current ? atLeast(current.start) : false,
    running,
    forgiven: { freeze: current?.freezeWeeks.length ?? 0, allowance: current?.allowanceWeeks.length ?? 0 },
    best,
    next: { threshold, remaining: threshold - length },
    milestones,
  };
}

function weightGoal(p: Prepared): GoalResult {
  const { goalWeightKg, goalWeightSince } = p.goals;
  if (goalWeightKg === null || goalWeightSince === null) return { status: 'none', reason: 'no_target' };
  const sinceNo = dayNumber(goalWeightSince);
  const trend = movingAverage(p.weighIns.map((w) => ({ day: w.day, value: w.kg })), 7, 3).filter((t) => dayNumber(t.day) >= sinceNo);
  if (trend.length === 0) return { status: 'none', reason: 'too_few_weigh_ins' };
  const direction = goalDirection(trend[0]!.value, goalWeightKg);
  if (direction === 'maintain') return { status: 'none', reason: 'keeping_weight' };
  let run = 0;
  for (const t of trend) {
    const atGoal = direction === 'lose' ? t.value <= goalWeightKg : t.value >= goalWeightKg;
    run = atGoal ? run + 1 : 0;
    if (run === REACH_DAYS) return { status: 'reached', direction, reachedOn: t.day };
  }
  return { status: 'not_reached', reason: 'not_reached', direction };
}

export function computeStreaks(input: StreakInput): StreakResult {
  const p = prepare(input);
  const { workoutsPerWeek, proteinG } = p.goals;
  const todayNo = dayNumber(p.today);
  const firstWeekNo = dayNumber(p.firstWeek);
  const weekCount = (dayNumber(p.currentWeek) - firstWeekNo) / 7; // complete weeks before the current one
  const weekIndex = (day: Day) => (dayNumber(weekStart(day)) - firstWeekNo) / 7;
  const perWeek = () => Array.from({ length: weekCount + 1 }, (): Day[] => []);

  // Group the inputs once: counted workout days per week, food per day, logged days per week.
  const workoutDays = perWeek();
  for (const w of p.workouts) {
    const counted = w.type === 'strength' ? w.finished : w.type === 'cardio' || w.hasDetails;
    if (counted) workoutDays[weekIndex(w.day)]!.push(w.day);
  }
  for (const days of workoutDays) days.sort((a, b) => dayNumber(a) - dayNumber(b));

  const proteinByDay = new Map<number, number>();
  for (const f of p.food) proteinByDay.set(dayNumber(f.day), (proteinByDay.get(dayNumber(f.day)) ?? 0) + f.proteinG);
  const loggedDays = perWeek();
  for (const no of [...proteinByDay.keys()].sort((a, b) => a - b)) {
    const day = dayFromNumber(no);
    loggedDays[weekIndex(day)]!.push(day);
  }

  const weekly = (counted: Day[][], target: number): Streak => {
    // The target-th counted day of a week is the day it met its target.
    const metDays = counted.map((days) => (days.length >= target ? days[target - 1]! : null));
    const walked = walkWeeks(p.firstWeek, metDays.slice(0, weekCount), p.frozenWeeks, metDays[weekCount]!);
    const done = counted[weekCount]!.length;
    return buildStreak('week', walked, { done, target, met: done >= target }, p.firstWeek, p.olderDataExists);
  };

  const daily = (counts: (no: number) => boolean): Streak => {
    const { walked, todayCounted } = walkDays(dayNumber(p.historyFrom), todayNo, counts);
    return buildStreak('day', walked, { done: todayCounted ? 1 : 0, target: 1, met: todayCounted }, p.historyFrom, p.olderDataExists);
  };

  return {
    training: hasTarget(workoutsPerWeek)
      ? { status: 'ok', streak: weekly(workoutDays, workoutsPerWeek) }
      : { status: 'none', reason: 'no_target' },
    loggingDays: daily((no) => proteinByDay.has(no)),
    loggingWeeks: weekly(loggedDays, p.loggingTarget),
    proteinDays: hasTarget(proteinG)
      ? { status: 'ok', streak: daily((no) => (proteinByDay.get(no) ?? -1) >= proteinG * PROTEIN_SHARE) }
      : { status: 'none', reason: 'no_target' },
    weightGoal: weightGoal(p),
  };
}
