import { describe, expect, it } from 'vitest';
import { addDays, dayNumber, weekStart } from '../src/domain/dates';
import type { Day } from '../src/domain/dates';
import {
  computeStreaks, DAY_MILESTONES, nextMilestone, WEEK_MILESTONES,
  type StreakFoodEntry, type StreakInput, type StreakWorkout,
} from '../src/domain/streaks';

const noGoals = { workoutsPerWeek: null, proteinG: null, goalWeightKg: null, goalWeightSince: null };

const input = (over: Partial<StreakInput> = {}): StreakInput => ({
  today: '2026-10-21', historyFrom: '2026-09-07', olderDataExists: false,
  workouts: [], food: [], weighIns: [], goals: { ...noGoals }, ...over,
});

const lift = (day: Day, finished = true): StreakWorkout => ({ day, type: 'strength', finished, hasDetails: false });
const meal = (day: Day, proteinG = 100): StreakFoodEntry => ({ day, proteinG });
/** `n` finished workouts in the week starting `monday`, on its first n days. */
const week = (monday: Day, n: number): StreakWorkout[] => Array.from({ length: n }, (_, i) => lift(addDays(monday, i)));
const training = (i: StreakInput) => {
  const r = computeStreaks(i).training;
  if (r.status !== 'ok') throw new Error('expected a training streak');
  return r.streak;
};
const daysFrom = (from: Day, n: number): Day[] => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('inputs and purity', () => {
  it('returns an all-zero result with no data (AC1, AC15)', () => {
    const r = computeStreaks(input({ goals: { ...noGoals, workoutsPerWeek: 3, proteinG: 150 } }));
    for (const s of [r.loggingDays, r.loggingWeeks]) {
      expect(s.current).toBe(0);
      expect(s.startedOn).toBeNull();
      expect(s.best).toEqual({ length: 0, endedOn: null, isCurrent: false, atLeast: false });
      expect(s.next).toEqual({ threshold: 1, remaining: 1 });
      expect(s.milestones).toEqual([]);
    }
    expect(r.weightGoal).toEqual({ status: 'none', reason: 'no_target' });
  });

  it('does not mutate its input and is deterministic (FR1)', () => {
    const i = input({ workouts: [...week('2026-10-05', 3)], food: [meal('2026-10-20')], goals: { ...noGoals, workoutsPerWeek: 3 }, freezes: ['2026-10-07'] });
    const copy = structuredClone(i);
    const a = computeStreaks(i);
    expect(i).toEqual(copy);
    expect(computeStreaks(i)).toEqual(a);
  });

  it('throws a RangeError naming the field for caller bugs (AC8)', () => {
    expect(() => computeStreaks(input({ today: '2026-13-01' }))).toThrow(/today/);
    expect(() => computeStreaks(input({ historyFrom: 'soon' }))).toThrow(/historyFrom/);
    expect(() => computeStreaks(input({ historyFrom: '2026-10-22' }))).toThrow(RangeError);
    expect(() => computeStreaks(input({ workouts: [lift('2026-02-30')] }))).toThrow(/workouts\[0\]/);
    expect(() => computeStreaks(input({ food: [meal('x')] }))).toThrow(/food\[0\]/);
    expect(() => computeStreaks(input({ weighIns: [{ day: '', kg: 80 }] }))).toThrow(/weighIns\[0\]/);
    expect(() => computeStreaks(input({ freezes: ['nope'] }))).toThrow(/freezes\[0\]/);
    expect(() => computeStreaks(input({ goals: { ...noGoals, goalWeightSince: 'nope' } }))).toThrow(/goalWeightSince/);
    for (const bad of [0, 8, 2.5]) expect(() => computeStreaks(input({ loggingTarget: bad }))).toThrow(/loggingTarget/);
  });

  it('ignores anything after today and anything before historyFrom, except weigh-ins (AC7)', () => {
    const r = computeStreaks(input({
      today: '2026-10-21', historyFrom: '2026-10-19',
      food: [meal('2026-10-18'), meal('2026-10-22')],
    }));
    expect(r.loggingDays.current).toBe(0);
    const t = training(input({
      goals: { ...noGoals, workoutsPerWeek: 1 }, workouts: [lift('2026-10-22'), lift('2026-09-01')],
    }));
    expect(t.current).toBe(0);
    expect(t.running).toEqual({ done: 0, target: 1, met: false });
  });
});

describe('training streak', () => {
  const goals = { ...noGoals, workoutsPerWeek: 3 };

  it('matches the worked example: one forgiven week, milestones and next (AC2, AC5, AC11)', () => {
    const workouts = [
      ...['2026-09-07', '2026-09-14', '2026-09-21', '2026-10-05', '2026-10-12'].flatMap((m) => [lift(m), lift(addDays(m, 1)), lift(addDays(m, 3))]),
      lift('2026-09-28'), lift('2026-09-29'),
    ];
    expect(training(input({ goals, workouts }))).toEqual({
      unit: 'week', current: 5, startedOn: '2026-09-07', atLeast: false,
      running: { done: 0, target: 3, met: false },
      forgiven: { freeze: 0, allowance: 1 },
      best: { length: 5, endedOn: null, isCurrent: true, atLeast: false },
      next: { threshold: 7, remaining: 2 },
      milestones: [{ threshold: 1, day: '2026-09-10' }, { threshold: 2, day: '2026-09-17' }, { threshold: 3, day: '2026-09-24' }, { threshold: 5, day: '2026-10-15' }],
    });
  });

  it('counts finished strength, cardio and detailed sessions only (AC3)', () => {
    const workouts: StreakWorkout[] = [
      lift('2026-10-19'), lift('2026-10-19', false),
      { day: '2026-10-20', type: 'cardio', finished: false, hasDetails: false },
      { day: '2026-10-20', type: 'session', finished: false, hasDetails: false },
      { day: '2026-10-21', type: 'session', finished: false, hasDetails: true },
    ];
    expect(training(input({ goals, workouts })).running).toEqual({ done: 3, target: 3, met: true });
  });

  it('several workouts on a day each count and the met day is the day the count was reached', () => {
    const t = training(input({
      today: '2026-09-15', goals: { ...noGoals, workoutsPerWeek: 3 },
      workouts: [lift('2026-09-07'), lift('2026-09-08'), lift('2026-09-08')],
    }));
    expect(t.current).toBe(1);
    expect(t.milestones).toEqual([{ threshold: 1, day: '2026-09-08' }]);
  });

  it('a week below target outside a run changes nothing, and the second miss ends a run (AC2, AC5)', () => {
    const t = training(input({
      goals, workouts: [...week('2026-09-07', 3), ...week('2026-09-14', 3), ...week('2026-10-12', 3)],
    }));
    // 09-21 forgiven by the allowance, 09-28 ends the run, 10-05 below target outside a run, 10-12 starts a new one.
    expect(t.current).toBe(1);
    expect(t.startedOn).toBe('2026-10-12');
    expect(t.best).toEqual({ length: 2, endedOn: '2026-09-20', isCurrent: false, atLeast: false });
  });

  it('a tie goes to the most recent run', () => {
    const t = training(input({
      goals, workouts: [...week('2026-09-07', 3), ...week('2026-10-05', 3)],
    }));
    expect(t.current).toBe(1);
    expect(t.best).toEqual({ length: 1, endedOn: null, isCurrent: true, atLeast: false });
  });

  it('freezes forgive a week before the allowance and a met frozen week uses no slot (AC5)', () => {
    const t = training(input({
      goals,
      workouts: [...week('2026-09-07', 3), ...week('2026-09-21', 3), ...week('2026-10-05', 3), ...week('2026-10-12', 3)],
      freezes: ['2026-09-16', '2026-09-17', '2026-10-06'], // two freezes in one week are one; 10-06 is met
    }));
    expect(t.current).toBe(4);
    expect(t.forgiven).toEqual({ freeze: 1, allowance: 1 });
  });

  it('counts slots and the allowance per streak: the logging weeks keep their own', () => {
    const food = [...daysFrom('2026-10-12', 5), ...daysFrom('2026-10-05', 5)].map((d) => meal(d));
    const r = computeStreaks(input({
      goals, food, workouts: [...week('2026-10-05', 3)], freezes: ['2026-10-14'], // 10-12 is below target for training only
    }));
    if (r.training.status !== 'ok') throw new Error('expected a training streak');
    expect(r.training.streak.forgiven).toEqual({ freeze: 1, allowance: 0 });
    expect(r.loggingWeeks.forgiven).toEqual({ freeze: 0, allowance: 0 });
    expect(r.loggingWeeks.current).toBe(2);
  });

  it('allows 4 freezes in 11 weeks, then falls back to the allowance, then ends the run', () => {
    const mondays = daysFrom('2026-07-06', 7 * 6).filter((_, i) => i % 7 === 0); // 6 Mondays, 07-06 .. 08-10
    const t = training(input({
      today: '2026-08-12', historyFrom: '2026-07-06', goals,
      workouts: week('2026-07-06', 3),
      freezes: mondays.slice(1),
    }));
    // 4 frozen weeks use all the slots; the fifth (08-10) is still the current week and changes nothing.
    expect(t.current).toBe(1);
    expect(t.forgiven).toEqual({ freeze: 4, allowance: 0 });
    const run = (today: Day) => training(input({ today, historyFrom: '2026-07-06', goals, workouts: week('2026-07-06', 3), freezes: mondays.slice(1) }));
    // Once 08-10 is a complete week the slots are gone, so the allowance covers it.
    expect(run('2026-08-19').forgiven).toEqual({ freeze: 4, allowance: 1 });
    // The next unfrozen week is below target with the allowance used, so the run ends on the Sunday of its last met week.
    const ended = run('2026-08-26');
    expect(ended.current).toBe(0);
    expect(ended.best).toEqual({ length: 1, endedOn: '2026-07-12', isCurrent: false, atLeast: false });
  });

  it('applies a freeze given on a later day of the current week, ignores later weeks', () => {
    const base = { goals, workouts: [...week('2026-10-05', 3)], today: '2026-10-21' as Day };
    // 10-12 is below target: a freeze in its week forgives it by freeze, otherwise the allowance does.
    expect(training(input({ ...base, freezes: ['2026-10-14'] })).forgiven).toEqual({ freeze: 1, allowance: 0 });
    expect(training(input({ ...base, freezes: ['2026-10-25', '2026-10-26'] })).forgiven).toEqual({ freeze: 0, allowance: 1 });
    expect(training(input({ ...base, freezes: ['2026-10-25'] })).current).toBe(1);
  });

  it('a met running week is applied, an unmet one changes nothing (AC6)', () => {
    const prior = week('2026-10-12', 3);
    const met = training(input({ goals, workouts: [...prior, ...week('2026-10-19', 3)] }));
    expect(met.current).toBe(2);
    expect(met.running).toEqual({ done: 3, target: 3, met: true });
    const unmet = training(input({ goals, workouts: [...prior, lift('2026-10-19')] }));
    expect(unmet.current).toBe(1);
    expect(unmet.running).toEqual({ done: 1, target: 3, met: false });
    expect(unmet.forgiven).toEqual({ freeze: 0, allowance: 0 });
  });

  it('has no streak without a target (AC4)', () => {
    for (const workoutsPerWeek of [null, 0, -1]) {
      expect(computeStreaks(input({ goals: { ...noGoals, workoutsPerWeek } })).training).toEqual({ status: 'none', reason: 'no_target' });
    }
  });

  it('marks at-least only with older data and a run from the first evaluated week (AC14)', () => {
    const workouts = [lift('2026-10-07'), lift('2026-10-08'), lift('2026-10-09'), ...week('2026-10-12', 3)];
    const i = input({ historyFrom: '2026-10-07', today: '2026-10-21', goals, workouts });
    expect(training({ ...i, olderDataExists: true }).atLeast).toBe(true);
    expect(training({ ...i, olderDataExists: true }).best.atLeast).toBe(true);
    expect(training({ ...i, olderDataExists: false }).atLeast).toBe(false);
    expect(training({ ...i, olderDataExists: true, historyFrom: '2026-10-12' }).atLeast).toBe(true);
    expect(training({ ...i, olderDataExists: true, workouts: week('2026-10-12', 3), historyFrom: '2026-10-05' }).atLeast).toBe(false);
  });

  it('keeps weeks 7 days long across a daylight-saving change (AC13)', () => {
    // New York fell back on 2026-11-01 (a Sunday): the week of 10-26 has 25 hours on its last day.
    const t = training(input({
      today: '2026-11-04', historyFrom: '2026-10-26', goals: { ...noGoals, workoutsPerWeek: 2 },
      workouts: [lift('2026-10-26'), lift('2026-11-01')],
    }));
    expect(t.current).toBe(1);
    expect(t.best).toEqual({ length: 1, endedOn: null, isCurrent: true, atLeast: false });
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(dayNumber('2026-11-02') - dayNumber('2026-10-26')).toBe(7);
  });
});

describe('logging streaks', () => {
  it('logging days: counted days extend, a gap ends the run, today never ends it (AC7)', () => {
    const food = [...daysFrom('2026-10-10', 3), ...daysFrom('2026-10-16', 5)].map((d) => meal(d)); // 10-10..12, 10-16..20
    const r = computeStreaks(input({ food })).loggingDays;
    expect(r.current).toBe(5);
    expect(r.startedOn).toBe('2026-10-16');
    expect(r.running).toEqual({ done: 0, target: 1, met: false });
    expect(r.forgiven).toEqual({ freeze: 0, allowance: 0 });
    expect(r.best).toEqual({ length: 5, endedOn: null, isCurrent: true, atLeast: false });
    expect(r.next).toEqual({ threshold: 7, remaining: 2 });
    expect(r.milestones.map((m) => m.threshold)).toEqual([1, 2, 3, 5]);
    expect(r.milestones[3]).toEqual({ threshold: 5, day: '2026-10-20' });

    const withToday = computeStreaks(input({ food: [...food, meal('2026-10-21')] })).loggingDays;
    expect(withToday.current).toBe(6);
    expect(withToday.running).toEqual({ done: 1, target: 1, met: true });

    // A day without food before today ends the run; the run is then the best, no longer the current one.
    const gap = computeStreaks(input({ food: food.slice(0, -1).concat(meal('2026-10-21')) })).loggingDays;
    expect(gap.current).toBe(1);
    expect(gap.best).toEqual({ length: 4, endedOn: '2026-10-19', isCurrent: false, atLeast: false });
  });

  it('several entries on a day are one logged day', () => {
    const r = computeStreaks(input({ food: [meal('2026-10-20'), meal('2026-10-20'), meal('2026-10-20')] })).loggingDays;
    expect(r.current).toBe(1);
  });

  it('logging weeks: default target 5 days, own target, running week (AC8)', () => {
    const food = [...daysFrom('2026-10-12', 5), ...daysFrom('2026-10-19', 3)].map((d) => meal(d));
    const r = computeStreaks(input({ food })).loggingWeeks;
    expect(r.current).toBe(1);
    expect(r.running).toEqual({ done: 3, target: 5, met: false });
    expect(r.milestones).toEqual([{ threshold: 1, day: '2026-10-16' }]);
    const low = computeStreaks(input({ food, loggingTarget: 3 })).loggingWeeks;
    expect(low.current).toBe(2);
    expect(low.running).toEqual({ done: 3, target: 3, met: true });
  });
});

describe('protein days', () => {
  const goals = { ...noGoals, proteinG: 150 };

  it('counts a day at 90 % of the goal, sums entries, and needs food (AC9)', () => {
    const food = [meal('2026-10-18', 135), meal('2026-10-19', 100), meal('2026-10-19', 35), meal('2026-10-20', 134.9), meal('2026-10-21', 0)];
    const r = computeStreaks(input({ goals, food })).proteinDays;
    if (r.status !== 'ok') throw new Error('expected a protein streak');
    expect(r.streak.current).toBe(0); // today has food but no protein
    expect(r.streak.best).toEqual({ length: 2, endedOn: '2026-10-19', isCurrent: false, atLeast: false });
  });

  it('has no streak without a goal', () => {
    for (const proteinG of [null, 0]) {
      expect(computeStreaks(input({ goals: { ...noGoals, proteinG } })).proteinDays).toEqual({ status: 'none', reason: 'no_target' });
    }
  });
});

describe('weight goal', () => {
  const goal = (goalWeightKg: number, goalWeightSince: Day = '2026-08-01') => ({ ...noGoals, goalWeightKg, goalWeightSince });
  const weighIns = (from: Day, kgs: (number | null)[]) =>
    kgs.flatMap((kg, i) => (kg === null ? [] : [{ day: addDays(from, i), kg }]));
  const result = (kgs: (number | null)[], g = goal(75), today: Day = '2026-10-21') =>
    computeStreaks(input({ today, goals: g, weighIns: weighIns('2026-08-01', kgs) })).weightGoal;

  it('needs a goal weight and a goal day', () => {
    expect(computeStreaks(input({ goals: { ...noGoals, goalWeightKg: 75 } })).weightGoal).toEqual({ status: 'none', reason: 'no_target' });
    expect(computeStreaks(input({ goals: { ...noGoals, goalWeightSince: '2026-08-01' } })).weightGoal).toEqual({ status: 'none', reason: 'no_target' });
  });

  it('asks for more weigh-ins until the trend has 3 readings in a week', () => {
    expect(result([80, 80])).toEqual({ status: 'none', reason: 'too_few_weigh_ins' });
    expect(result([])).toEqual({ status: 'none', reason: 'too_few_weigh_ins' });
  });

  it('keeps weight when the goal is within 0.5 kg of the trend', () => {
    expect(result([75.3, 75.3, 75.3, 75.3])).toEqual({ status: 'none', reason: 'keeping_weight' });
  });

  it('is reached after 7 trend days at or past the goal, on the seventh (AC10)', () => {
    const kgs = [...Array(10).fill(80), ...Array(20).fill(74)];
    const r = result(kgs);
    expect(r.status).toBe('reached');
    if (r.status === 'reached') expect(r.direction).toBe('lose');
  });

  it('is not reached when the trend crosses and leaves before 7 days, and gaps neither count nor break', () => {
    expect(result([...Array(10).fill(80), ...Array(3).fill(70), ...Array(10).fill(80)])).toEqual({ status: 'not_reached', reason: 'not_reached', direction: 'lose' });
    // 6 trend days at the goal (08-14 to 08-19), then days with no trend, then the third reading after the gap
    // gives the first trend point (08-28): the run was neither counted nor reset across the gap, 6 + 1 = 7.
    const gap = [...Array(10).fill(80), ...Array(5).fill(70), ...Array(10).fill(null), ...Array(8).fill(70)];
    expect(result(gap)).toEqual({ status: 'reached', direction: 'lose', reachedOn: '2026-08-28' });
  });

  it('gains: direction from the first counted point, and days before the goal day do not count', () => {
    const kgs = [...Array(10).fill(60), ...Array(20).fill(66)];
    const r = result(kgs, goal(65));
    expect(r.status).toBe('reached');
    if (r.status === 'reached') expect(r.direction).toBe('gain');
    // With the goal set after the stretch at 66 kg began, the goal already lies below the trend: the other way, never reached.
    expect(result(kgs, goal(65, '2026-08-25'))).toEqual({ status: 'not_reached', reason: 'not_reached', direction: 'lose' });
  });

  it('ignores weigh-ins after today', () => {
    const r = computeStreaks(input({
      today: '2026-08-10', historyFrom: '2026-08-01', goals: goal(75), weighIns: weighIns('2026-08-01', [...Array(5).fill(80), ...Array(20).fill(70)]),
    })).weightGoal;
    expect(r).toEqual({ status: 'not_reached', reason: 'not_reached', direction: 'lose' });
  });
});

describe('milestones and neutral output', () => {
  it('exposes the lists and their continuations (AC11, AC12)', () => {
    expect(WEEK_MILESTONES).toEqual([1, 2, 3, 5, 7, 14, 21, 30, 52]);
    expect(DAY_MILESTONES).toEqual([1, 2, 3, 5, 7, 14, 21, 30, 50, 100, 200, 365]);
    expect(nextMilestone('week', 0)).toBe(1);
    expect(nextMilestone('week', 52)).toBe(104);
    expect(nextMilestone('week', 103)).toBe(104);
    expect(nextMilestone('week', 104)).toBe(156);
    expect(nextMilestone('day', 30)).toBe(50);
    expect(nextMilestone('day', 365)).toBe(730);
    expect(nextMilestone('day', 729)).toBe(730);
  });

  it('lists one milestone per threshold reached, past the list too', () => {
    const days = daysFrom('2025-10-01', 386); // 2025-10-01 .. 2026-10-21
    const r = computeStreaks(input({ historyFrom: '2025-10-01', olderDataExists: true, food: days.map((d) => meal(d)) })).loggingDays;
    expect(r.current).toBe(386);
    expect(r.atLeast).toBe(true);
    expect(r.milestones.map((m) => m.threshold)).toEqual([...DAY_MILESTONES]);
    expect(r.milestones[11]).toEqual({ threshold: 365, day: '2026-09-30' });
    expect(r.next).toEqual({ threshold: 730, remaining: 344 });
  });

  it('returns only numbers, days, booleans, nulls and the fixed words, none of them a review word (AC15)', () => {
    const r = computeStreaks(input({
      goals: { workoutsPerWeek: 3, proteinG: 100, goalWeightKg: 75, goalWeightSince: '2026-08-01' },
      workouts: week('2026-10-12', 3), food: daysFrom('2026-10-01', 20).map((d) => meal(d)),
      weighIns: Array.from({ length: 30 }, (_, i) => ({ day: addDays('2026-08-01', i), kg: 80 })),
    }));
    const strings: string[] = [];
    const visit = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(visit);
      else expect(['number', 'boolean', 'object']).toContain(typeof v);
    };
    visit(r);
    const allowed = /^(\d{4}-\d{2}-\d{2}|ok|none|not_reached|reached|week|day|lose|gain|no_target|too_few_weigh_ins|keeping_weight)$/;
    for (const s of strings) expect(s).toMatch(allowed);
    const banned = /cheat|guilty|bad|lazy|behind|off track|missed|failed|healthy|great|only|stalled|should|must|need to|broke|lost/;
    for (const s of strings) expect(s).not.toMatch(banned);
  });

  it('runs two years of data well under 50 ms (AC16)', () => {
    const days = daysFrom('2024-10-22', 730);
    const i = input({
      today: '2026-10-21', historyFrom: '2024-10-22', olderDataExists: true,
      goals: { workoutsPerWeek: 3, proteinG: 120, goalWeightKg: 75, goalWeightSince: '2024-10-22' },
      food: days.flatMap((d, n) => [meal(d, 60), ...(n % 2 ? [meal(d, 70)] : [])]),
      workouts: days.filter((_, n) => n % 2 === 0).map((d) => lift(d)),
      weighIns: days.map((d, n) => ({ day: d, kg: 90 - n / 40 })),
    });
    computeStreaks(i); // warm-up
    const t0 = performance.now();
    computeStreaks(i);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------- acceptance (01-purpose.md AC1 to AC16)
describe('acceptance: calendars from the purpose contract', () => {
  const LAST_MONDAY = '2026-10-12'; // the last complete week before the current one (2026-10-19)
  const target3 = { ...noGoals, workoutsPerWeek: 3 };
  const mondayOf = (n: number, i: number): Day => addDays(LAST_MONDAY, -7 * (n - 1 - i));

  /** M met (3 workouts, the 3rd on Thursday), B below (2), F frozen and below, Z frozen and met. */
  const calendar = (pattern: string, extra: Partial<StreakInput> = {}): StreakInput => {
    const n = pattern.length;
    const workouts = [...pattern].flatMap((c, i) => {
      const m = mondayOf(n, i);
      const days = c === 'M' || c === 'Z' ? [m, addDays(m, 1), addDays(m, 3)] : [m, addDays(m, 1)];
      return days.map((d) => lift(d));
    });
    const freezes = [...pattern].flatMap((c, i) => (c === 'F' || c === 'Z' ? [addDays(mondayOf(n, i), 2)] : []));
    return input({ historyFrom: mondayOf(n, 0), goals: target3, workouts, freezes, ...extra });
  };
  const run = (pattern: string) => training(calendar(pattern));
  const foodOn = (days: Day[]): StreakFoodEntry[] => days.map((d) => meal(d));
  /** `counts[i]` logged days at the start of the i-th week, the last being the week of LAST_MONDAY. */
  const loggedWeeks = (counts: number[], currentWeek = 0): StreakFoodEntry[] =>
    foodOn([...counts.flatMap((c, i) => daysFrom(mondayOf(counts.length, i), c)), ...daysFrom('2026-10-19', currentWeek)]);

  it('AC1: equal inputs give equal results holding only plain data', () => {
    const i = calendar('MMMMM');
    expect(computeStreaks(i)).toEqual(computeStreaks(structuredClone(i)));
    expect(JSON.parse(JSON.stringify(computeStreaks(i)))).toEqual(computeStreaks(i));
  });

  it('AC2: 5 met weeks give a streak of 5 from 2026-09-14', () => {
    const t = run('MMMMM');
    expect(t).toMatchObject({ current: 5, startedOn: '2026-09-14', running: { done: 0, target: 3, met: false }, next: { threshold: 7, remaining: 2 } });
    expect(t.best).toEqual({ length: 5, endedOn: null, isCurrent: true, atLeast: false });
  });

  it('AC3: unfinished strength and detail-less sessions do not count, cardio and detailed sessions do', () => {
    const cases: [StreakWorkout, boolean][] = [
      [lift('2026-10-21', false), false],
      [{ day: '2026-10-21', type: 'cardio', finished: false, hasDetails: false }, true],
      [{ day: '2026-10-21', type: 'session', finished: false, hasDetails: true }, true],
      [{ day: '2026-10-21', type: 'session', finished: false, hasDetails: false }, false],
    ];
    for (const [third, counts] of cases) {
      const t = training(input({ goals: target3, workouts: [lift('2026-10-19'), lift('2026-10-20'), third] }));
      expect(t.running).toEqual({ done: counts ? 3 : 2, target: 3, met: counts });
    }
  });

  it('AC4: no weekly target and a target of 0 give no training streak', () => {
    for (const workoutsPerWeek of [null, 0]) {
      expect(computeStreaks(calendar('MMM', { goals: { ...noGoals, workoutsPerWeek } })).training).toEqual({ status: 'none', reason: 'no_target' });
    }
  });

  it('AC5: forgiveness, the allowance window and freezes', () => {
    expect(run('MMMBMMM')).toMatchObject({ current: 6, forgiven: { freeze: 0, allowance: 1 } });

    const two = run('MMBMMBM');
    expect(two.current).toBe(1);
    expect(two.best).toEqual({ length: 4, endedOn: addDays(mondayOf(7, 4), 6), isCurrent: false, atLeast: false });

    expect(run(`MB${'M'.repeat(11)}BM`).current).toBe(13); // B in week 2 and 14: twelve weeks apart
    expect(run(`MB${'M'.repeat(10)}BMM`).current).toBe(2); // B in week 2 and 13

    expect(run('BMM')).toMatchObject({ current: 2, startedOn: mondayOf(3, 1), forgiven: { freeze: 0, allowance: 0 } });
    expect(run('MFMBM').current).toBe(3);
    expect(run('MZM').current).toBe(3);
    expect(run('MMFFFFFM')).toMatchObject({ current: 3, forgiven: { freeze: 4, allowance: 1 } });
    expect(run('MFMFMFMFMFM')).toMatchObject({ current: 6, forgiven: { freeze: 4, allowance: 1 } });
  });

  it('AC6: the running week counts once its target is met', () => {
    const weeks = calendar('MMMM');
    const partial = training({ ...weeks, workouts: [...weeks.workouts, lift('2026-10-19')] });
    expect(partial).toMatchObject({ current: 4, running: { done: 1, target: 3, met: false } });
    const done = training({ ...weeks, workouts: [...weeks.workouts, lift('2026-10-19'), lift('2026-10-20'), lift('2026-10-21')] });
    expect(done.current).toBe(5);
    expect(done.milestones.at(-1)).toEqual({ threshold: 5, day: '2026-10-21' });
  });

  it('AC7: logging days, without today, and a future meal', () => {
    const days = daysFrom('2026-10-12', 10);
    const withToday = computeStreaks(input({ food: foodOn(days) })).loggingDays;
    expect(withToday).toMatchObject({ current: 10, startedOn: '2026-10-12' });
    const without = computeStreaks(input({ food: foodOn(days.slice(0, -1)) })).loggingDays;
    expect(without).toMatchObject({ current: 9, running: { done: 0, target: 1, met: false } });
    expect(computeStreaks(input({ food: [...foodOn(days.slice(0, -1)), meal('2026-10-22')] })).loggingDays).toEqual(without);
  });

  it('AC8: logging weeks with a forgiven week, another target and refused targets', () => {
    const food = loggedWeeks([5, 6, 4, 5], 2);
    expect(computeStreaks(input({ historyFrom: mondayOf(4, 0), food })).loggingWeeks).toMatchObject({
      current: 3, forgiven: { freeze: 0, allowance: 1 }, running: { done: 2, target: 5, met: false },
    });
    expect(computeStreaks(input({ historyFrom: mondayOf(4, 0), food, loggingTarget: 4 })).loggingWeeks.current).toBe(4);
    for (const bad of [0, 8]) expect(() => computeStreaks(input({ food, loggingTarget: bad }))).toThrow(RangeError);
  });

  it('AC9: protein days at 90 % of the goal, ties to the most recent, and no goal', () => {
    const food = [140, 150, 120, 135, 160].map((g, i) => meal(addDays('2026-10-17', i), g));
    const goals = { ...noGoals, proteinG: 150 };
    const r = computeStreaks(input({ goals, food })).proteinDays;
    if (r.status !== 'ok') throw new Error('expected a protein streak');
    expect(r.streak).toMatchObject({ current: 2, startedOn: '2026-10-20' });
    expect(r.streak.best).toEqual({ length: 2, endedOn: null, isCurrent: true, atLeast: false });
    for (const proteinG of [null, 0]) {
      expect(computeStreaks(input({ goals: { ...noGoals, proteinG }, food })).proteinDays).toEqual({ status: 'none', reason: 'no_target' });
    }
  });

  describe('AC10: weight goal', () => {
    const at = (value: number, ...days: Day[]) => days.map((day) => ({ day, kg: value }));
    const goal = (goalWeightKg: number, goalWeightSince: Day) => ({ ...noGoals, goalWeightKg, goalWeightSince });
    const goalOf = (weighIns: { day: Day; kg: number }[], g: ReturnType<typeof goal>) =>
      computeStreaks(input({ historyFrom: '2026-08-01', goals: g, weighIns })).weightGoal;

    it('reaches the goal on the 7th trend day, skipping a day without a trend, and stays reached', () => {
      const early = [...at(78, '2026-08-02', '2026-08-03', '2026-08-04'), ...at(85, '2026-08-25'), ...at(76, '2026-08-28')];
      const near = at(74, '2026-08-30', '2026-08-31', '2026-09-02', '2026-09-03', '2026-09-08');
      const reached = { status: 'reached', direction: 'lose', reachedOn: '2026-09-08' };
      expect(goalOf([...early, ...near], goal(75, '2026-08-01'))).toEqual(reached);
      expect(goalOf([...early, ...near, ...at(76, '2026-09-20', '2026-09-21', '2026-09-22')], goal(75, '2026-08-01'))).toEqual(reached);
    });

    it('a trend of 75.4 between two runs resets the count, 7 more days reach it', () => {
      const w = [
        ...at(78, '2026-08-02', '2026-08-03', '2026-08-04'),
        ...at(74, '2026-08-20', '2026-08-21', '2026-08-22'), // 3 readings keep a trend for 5 days (08-22 to 08-26), at or below 75
        ...at(75.4, '2026-09-09', '2026-09-12', '2026-09-15'), // one trend day at 75.4
        ...daysFrom('2026-09-17', 7).flatMap((d) => at(74, d)), // trend days 09-17 to 09-23 (the trend ends with the last reading)
      ];
      expect(goalOf(w, goal(75, '2026-08-01'))).toEqual({ status: 'reached', direction: 'lose', reachedOn: '2026-09-23' });
    });

    it('gaining: reached on the 7th trend day in a row at or above the goal', () => {
      const w = [...at(77, '2026-08-02', '2026-08-03', '2026-08-04'), ...daysFrom('2026-08-05', 20).flatMap((d) => at(83, d))];
      expect(goalOf(w, goal(80, '2026-08-01'))).toEqual({ status: 'reached', direction: 'gain', reachedOn: '2026-08-13' });
    });

    it('keeps weight, too few weigh-ins, and a goal already passed points the other way', () => {
      const three = at(78, '2026-08-02', '2026-08-03', '2026-08-04');
      expect(goalOf(three, goal(77.7, '2026-08-01'))).toEqual({ status: 'none', reason: 'keeping_weight' });
      const before = daysFrom('2026-07-01', 10).flatMap((d) => at(74, d));
      expect(goalOf(before, goal(75, '2026-08-01'))).toEqual({ status: 'none', reason: 'too_few_weigh_ins' });
      const under = daysFrom('2026-07-20', 32).flatMap((d) => at(73, d));
      expect(goalOf(under, goal(75, '2026-08-05'))).toEqual({ status: 'not_reached', reason: 'not_reached', direction: 'gain' });
    });
  });

  it('AC11: a new run after a gap, milestone days, next, and the best earlier run', () => {
    const t = run(`${'M'.repeat(12)}${'B'.repeat(4)}${'M'.repeat(8)}`);
    expect(t).toMatchObject({ current: 8, startedOn: '2026-08-24', next: { threshold: 14, remaining: 6 } });
    expect(t.milestones).toEqual([
      { threshold: 1, day: '2026-08-27' }, { threshold: 2, day: '2026-09-03' }, { threshold: 3, day: '2026-09-10' },
      { threshold: 5, day: '2026-09-24' }, { threshold: 7, day: '2026-10-08' },
    ]);
    expect(t.best).toEqual({ length: 12, endedOn: '2026-07-26', isCurrent: false, atLeast: false });
  });

  it('AC12: milestones continue every 52 weeks and 365 days', () => {
    expect(run('M'.repeat(53)).next).toEqual({ threshold: 104, remaining: 51 });
    const days = computeStreaks(input({ historyFrom: '2026-08-23', food: foodOn(daysFrom('2026-08-23', 60)) })).loggingDays;
    expect(days).toMatchObject({ current: 60, next: { threshold: 100, remaining: 40 } });
  });

  it('AC13: days and weeks across both New York daylight-saving changes', () => {
    const fall = input({ today: '2026-11-07', historyFrom: '2026-10-25', food: foodOn(daysFrom('2026-10-25', 14)) });
    expect(computeStreaks(fall).loggingDays.current).toBe(14);
    // The week of 2026-10-26 holds 7 logged days: with a target of 7 it is met on its 7th day, Sunday 2026-11-01.
    expect(computeStreaks({ ...fall, loggingTarget: 7 }).loggingWeeks.milestones[0]).toEqual({ threshold: 1, day: '2026-11-01' });
    const spring = computeStreaks(input({ today: '2026-03-08', historyFrom: '2026-03-02', food: foodOn(daysFrom('2026-03-02', 7)) }));
    expect(spring.loggingDays.current).toBe(7);
    expect(spring.loggingWeeks.running).toEqual({ done: 7, target: 5, met: true });
  });

  it('AC14: "at least" only when the caller says older data exists', () => {
    for (const [olderDataExists, atLeast] of [[true, true], [false, false]] as const) {
      const t = training(calendar('MMM', { olderDataExists }));
      expect(t.atLeast).toBe(atLeast);
      expect(t.best.atLeast).toBe(atLeast);
    }
  });

  it('AC15: no result string holds a review word', () => {
    const r = computeStreaks(calendar('MMMBMMM', {
      food: foodOn(daysFrom('2026-10-01', 21)),
      goals: { workoutsPerWeek: 3, proteinG: 100, goalWeightKg: 75, goalWeightSince: '2026-08-01' },
    }));
    expect(JSON.stringify(r)).not.toMatch(/cheat|guilty|bad|lazy|behind|off track|missed|failed|healthy|great|only|stalled|should|must|need to|broke|lost/);
  });

  it('AC16: two years of daily data in under 50 ms', () => {
    const days = daysFrom('2024-10-22', 730);
    const big = input({
      today: '2026-10-21', historyFrom: '2024-10-22', olderDataExists: true,
      goals: { workoutsPerWeek: 3, proteinG: 120, goalWeightKg: 75, goalWeightSince: '2024-10-22' },
      food: days.flatMap((d, n) => [meal(d, 60), ...(n % 2 ? [meal(d, 70)] : [])]),
      workouts: days.filter((_, n) => n % 2 === 0).map((d) => lift(d)),
      weighIns: days.map((d, n) => ({ day: d, kg: 90 - n / 40 })),
    });
    computeStreaks(big);
    const t0 = performance.now();
    computeStreaks(big);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
