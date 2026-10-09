import { describe, expect, it } from 'vitest';
import { addMonths, dayFromNumber, dayNumber, weekStart } from '../../src/domain/dates';
import {
  aggregateDays, cardioActivities, cardioPerWeek, compareFirstLatest, downsample, exerciseOptions, exerciseProgress, measurementPoints,
  movingAverage, rangeStart, trendChange, weeklyAverage, weeksIn, workoutsPerWeek, type RangeData,
} from '../../src/domain/stats';
import type { FoodEntry, MeasurementEntry, MeasurementType, Workout, WeightEntry } from '../../src/db/schema';

const base = { createdAt: 1, updatedAt: 1, rev: 1 };
const pts = (...v: [string, number][]) => v.map(([day, value]) => ({ day, value }));

describe('calendar helpers (TZ=America/New_York)', () => {
  it('day numbers are timezone- and DST-proof', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2026-03-09') - dayNumber('2026-03-08')).toBe(1); // spring forward
    expect(dayNumber('2026-11-02') - dayNumber('2026-11-01')).toBe(1); // fall back
    for (const d of ['2026-03-08', '2026-11-01', '2028-02-29', '2026-12-31']) expect(dayFromNumber(dayNumber(d))).toBe(d);
  });
  it('weeks start on Monday, across year ends and DST changes', () => {
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // a Monday
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(weekStart('2026-03-08')).toBe('2026-03-02'); // DST Sunday
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
  });
  it('months clamp to the end of shorter months', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-09', -12)).toBe('2025-10-09');
  });
  it('lists the weeks a range touches', () => {
    expect(weeksIn('2026-10-07', '2026-10-21')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    expect(weeksIn('2026-10-05', '2026-10-05')).toEqual(['2026-10-05']);
  });
});

describe('range selector', () => {
  it('1m / 3m / 6m / 1y end today and start the day after the same date earlier', () => {
    expect(rangeStart('1m', '2026-10-09')).toBe('2026-09-10');
    expect(rangeStart('3m', '2026-10-09')).toBe('2026-07-10');
    expect(rangeStart('6m', '2026-10-09')).toBe('2026-04-10');
    expect(rangeStart('1y', '2026-10-09')).toBe('2025-10-10');
    expect(rangeStart('1m', '2026-03-31')).toBe('2026-03-01');
  });
  it('"all" starts at the earliest data, or today when there is none', () => {
    expect(rangeStart('all', '2026-10-09', '2024-02-01')).toBe('2024-02-01');
    expect(rangeStart('all', '2026-10-09')).toBe('2026-10-09');
    expect(rangeStart('all', '2026-10-09', '2027-01-01')).toBe('2026-10-09');
  });
});

describe('7-day moving average', () => {
  it('averages the trailing 7 calendar days and needs 3 readings', () => {
    const ma = movingAverage(pts(['2026-10-01', 80], ['2026-10-02', 79], ['2026-10-03', 78], ['2026-10-04', 77]));
    expect(ma.map((p) => p.day)).toEqual(['2026-10-03', '2026-10-04']); // not enough readings before the 3rd
    expect(ma[0]!.value).toBeCloseTo(79, 10);
    expect(ma[1]!.value).toBeCloseTo(78.5, 10);
  });
  it('old readings drop out of the window exactly after 7 days', () => {
    const ma = movingAverage(pts(['2026-10-01', 100], ['2026-10-02', 70], ['2026-10-03', 70], ['2026-10-08', 70]));
    const on = (d: string) => ma.find((p) => p.day === d)?.value;
    expect(on('2026-10-07')).toBeCloseTo((100 + 70 + 70) / 3, 10); // window 10-01..10-07
    expect(on('2026-10-08')).toBeCloseTo(70, 10); // 10-01 left; 70, 70, 70
  });
  it('stops across long gaps instead of inventing values', () => {
    const ma = movingAverage(pts(['2026-10-01', 80], ['2026-10-02', 80], ['2026-10-03', 80], ['2026-10-20', 80], ['2026-10-21', 80], ['2026-10-22', 80]));
    expect(ma.some((p) => p.day > '2026-10-10' && p.day < '2026-10-22')).toBe(false);
    expect(ma.at(-1)!.day).toBe('2026-10-22');
  });
  it('works across a DST change and unsorted input', () => {
    const ma = movingAverage(pts(['2026-11-03', 3], ['2026-10-31', 0], ['2026-11-01', 1], ['2026-11-02', 2]));
    expect(ma.find((p) => p.day === '2026-11-02')!.value).toBeCloseTo(1, 10);
    expect(ma.at(-1)!.value).toBeCloseTo(1.5, 10);
  });
  it('empty or sparse input gives nothing', () => {
    expect(movingAverage([])).toEqual([]);
    expect(movingAverage(pts(['2026-10-01', 1], ['2026-10-02', 2]))).toEqual([]);
  });
});

describe('trend change', () => {
  it('is last − first of the smoothed line, with sign, not the latest raw reading', () => {
    const t = trendChange(pts(['2026-10-03', 80], ['2026-10-10', 79], ['2026-10-17', 77.5]))!;
    expect(t.change).toBeCloseTo(-2.5, 10);
    expect(trendChange(pts(['2026-10-03', 80]))).toBeNull();
    expect(trendChange([])).toBeNull();
  });
});

describe('downsampling', () => {
  it('keeps endpoints, the requested size, and the peaks', () => {
    const series = Array.from({ length: 2000 }, (_, i) => ({ x: i, y: i === 1234 ? 1000 : Math.sin(i / 50) }));
    const out = downsample(series, 200);
    expect(out).toHaveLength(200);
    expect(out[0]).toBe(series[0]);
    expect(out.at(-1)).toBe(series.at(-1));
    expect(out.some((p) => p.y === 1000)).toBe(true);
    expect(downsample(series.slice(0, 50), 200)).toHaveLength(50);
    expect(out.every((p, i) => i === 0 || p.x > out[i - 1]!.x)).toBe(true);
  });
});

const food = (day: string, kcal: number, over: Partial<FoodEntry> = {}): FoodEntry => ({
  ...base, id: `${day}-${kcal}-${Math.random()}`, day, slot: 'lunch', state: 'resolved', quantity: { amount: 100, unit: 'g' },
  nutrition: { kcal, protein: kcal / 10, carbs: kcal / 5, fat: kcal / 20 }, ...over,
});
const cardio = (day: string, ref: string, min: number, km?: number, over: Partial<Workout> = {}): Workout => ({
  ...base, id: `${day}-${ref}-${Math.random()}`, day, type: 'cardio', cardio: { activityRef: ref, activityName: ref.toUpperCase(), met: 8, durationMin: min, distanceKm: km, kcalEstimated: min * 10 }, ...over,
});
const lift = (day: string, sets: [number, number, 'working' | 'warmup'][], ref = 'ex:bench', over: Partial<Workout> = {}): Workout => ({
  ...base, id: `${day}-${ref}-${Math.random()}`, day, type: 'strength',
  exercises: [{ exerciseRef: ref, exerciseName: ref.toUpperCase(), sets: sets.map(([reps, kg, type], i) => ({ id: String(i), type, reps, weightKg: kg })) }], ...over,
});
const weight = (day: string, kg: number): WeightEntry => ({ ...base, id: `w:${day}`, day, kg });
const empty: RangeData = { entries: [], workouts: [], weights: [], measurements: [] };

describe('daily aggregates', () => {
  it('sums resolved food, counts pending separately, ignores deleted records', () => {
    const data: RangeData = {
      ...empty,
      entries: [food('2026-10-01', 500), food('2026-10-01', 300), food('2026-10-01', 0, { state: 'pending', nutrition: undefined }), food('2026-10-01', 999, { deletedAt: 5 }), food('2026-10-02', 200)],
      workouts: [cardio('2026-10-01', 'run', 30, 5), lift('2026-10-01', [[5, 100, 'working']]), cardio('2026-10-02', 'run', 99, 9, { deletedAt: 1 })],
      weights: [weight('2026-10-01', 72.5), { ...weight('2026-10-02', 99), deletedAt: 1 }],
      measurements: [{ ...base, id: 'm', day: '2026-10-01', values: { a: 1 } }, { ...base, id: 'm2', day: '2026-10-03', values: {} }],
    };
    const days = aggregateDays(data);
    expect([...days.keys()].sort()).toEqual(['2026-10-01', '2026-10-02']);
    expect(days.get('2026-10-01')).toMatchObject({ kcal: 800, foodCount: 2, pendingCount: 1, cardio: 1, cardioMin: 30, distanceKm: 5, strength: 1, weightKg: 72.5, measured: true });
    expect(days.get('2026-10-02')).toMatchObject({ kcal: 200, cardio: 0, measured: false });
    expect(days.get('2026-10-02')!.weightKg).toBeUndefined();
  });
});

describe('weekly figures', () => {
  it('averages only over days that have food logged', () => {
    const days = aggregateDays({ ...empty, entries: [food('2026-10-05', 2000), food('2026-10-06', 1000), food('2026-10-12', 1800)], workouts: [cardio('2026-10-07', 'run', 10)] });
    const w = weeklyAverage(days, 'kcal', '2026-10-05', '2026-10-18');
    expect(w.map((x) => [x.start, x.value, x.days])).toEqual([['2026-10-05', 1500, 2], ['2026-10-12', 1800, 1]]);
    expect(weeklyAverage(days, 'kcal', '2026-10-19', '2026-10-25')[0]!.value).toBeUndefined();
  });
  it('workouts per week split by type, zero weeks included, range-clipped', () => {
    const days = aggregateDays({ ...empty, workouts: [lift('2026-10-05', [[5, 50, 'working']]), cardio('2026-10-06', 'run', 30), cardio('2026-10-07', 'run', 30), cardio('2026-10-26', 'run', 30), cardio('2026-09-01', 'run', 30)] });
    expect(workoutsPerWeek(days, '2026-10-05', '2026-10-28')).toEqual([
      { start: '2026-10-05', strength: 1, cardio: 2 }, { start: '2026-10-12', strength: 0, cardio: 0 }, { start: '2026-10-19', strength: 0, cardio: 0 }, { start: '2026-10-26', strength: 0, cardio: 1 },
    ]);
  });
  it('cardio totals per week, filterable by activity', () => {
    const ws = [cardio('2026-10-05', 'run', 30, 5), cardio('2026-10-07', 'bike', 60, 20), cardio('2026-10-13', 'run', 45, 7.5), cardio('2026-10-14', 'run', 1, 1, { deletedAt: 1 })];
    expect(cardioPerWeek(ws, '2026-10-05', '2026-10-18').map((w) => [w.minutes, w.km, w.sessions])).toEqual([[90, 25, 2], [45, 7.5, 1]]);
    expect(cardioPerWeek(ws, '2026-10-05', '2026-10-18', 'run').map((w) => [w.minutes, w.km])).toEqual([[30, 5], [45, 7.5]]);
    expect(cardioPerWeek(ws, '2026-10-05', '2026-10-18', 'run')[0]!.kcal).toBe(300);
    expect(cardioActivities(ws).map((a) => [a.ref, a.sessions])).toEqual([['run', 2], ['bike', 1]]);
  });
});

describe('strength progress', () => {
  it('best set and Epley e1RM per day; warm-ups, zero-weight and deleted ignored', () => {
    const ws = [
      lift('2026-09-01', [[10, 40, 'warmup'], [5, 100, 'working'], [3, 110, 'working']]),
      lift('2026-09-08', [[8, 90, 'working']]),
      lift('2026-09-08', [[1, 120, 'working']]),
      lift('2026-09-15', [[15, 50, 'working']]),
      lift('2026-09-22', [[5, 0, 'working']]),
      lift('2026-09-29', [[5, 500, 'working']], 'ex:bench', { deletedAt: 3 }),
      lift('2026-09-05', [[5, 60, 'working']], 'ex:squat'),
    ];
    const p = exerciseProgress(ws, 'ex:bench');
    expect(p.map((x) => x.day)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
    expect(p[0]).toMatchObject({ bestKg: 110 });
    expect(p[0]!.e1rmKg).toBeCloseTo(Math.max(100 * (1 + 5 / 30), 110 * (1 + 3 / 30)), 10); // 121
    expect(p[1]).toMatchObject({ bestKg: 120 });
    expect(p[1]!.e1rmKg).toBeCloseTo(120, 10); // a single is its own 1RM; beats 90 × (1 + 8/30) = 114
    expect(p[2]!.e1rmKg).toBeUndefined(); // 15 reps: no estimate, but still a best set
    expect(p[2]!.bestKg).toBe(50);
  });
  it('lists the exercises you have lifted weight for, most sessions first', () => {
    const ws = [lift('2026-09-01', [[5, 100, 'working']]), lift('2026-09-08', [[5, 100, 'working']]), lift('2026-09-05', [[5, 60, 'working']], 'ex:squat'), lift('2026-09-06', [[5, 0, 'working']], 'ex:plank'), lift('2026-09-07', [[5, 40, 'warmup']], 'ex:row')];
    expect(exerciseOptions(ws).map((o) => [o.ref, o.sessions])).toEqual([['ex:bench', 2], ['ex:squat', 1]]);
  });
});

describe('measurements', () => {
  const type = (id: string): MeasurementType => ({ ...base, id, key: id, label: id, kind: 'length', enabled: true, preset: true, order: 0 });
  const m = (day: string, values: Record<string, number>, over: Partial<MeasurementEntry> = {}): MeasurementEntry => ({ ...base, id: day, day, values, ...over });
  it('series per type, first vs latest only for types with two readings', () => {
    const es = [m('2026-09-01', { waist: 90, hips: 100 }), m('2026-09-15', { waist: 88.5 }), m('2026-10-01', { waist: 87.5 }), m('2026-10-02', { waist: 1 }, { deletedAt: 1 })];
    expect(measurementPoints(es, 'waist').map((p) => p.value)).toEqual([90, 88.5, 87.5]);
    const c = compareFirstLatest(es, [type('waist'), type('hips'), type('neck')]);
    expect(c.map((x) => [x.type.id, x.first.value, x.latest.value, x.change])).toEqual([['waist', 90, 87.5, -2.5]]);
  });
});
