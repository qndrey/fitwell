import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { estimateKcal, bodyWeightKg } from '../../src/domain/met';
import { cardioKcal, copyExercises, describeWorkout, estimatedOneRepMax, summarizeSets } from '../../src/domain/workouts';
import { displayDistance, displayWeight, kgToLb, lbToKg, miToKm, toKg, toKm, kmToMi } from '../../src/domain/units';
import { openDatabase } from '../../src/db/open';
import { ACTIVITIES } from '../../src/data/activities';
import type { Workout } from '../../src/db/schema';

describe('MET energy estimate', () => {
  it('MET × kg × hours, rounded', () => {
    expect(estimateKcal(9.8, 70, 30)).toBe(343); // 9.8 × 70 × 0.5
    expect(estimateKcal(3.5, 82.5, 45)).toBe(217);
    expect(estimateKcal(8, 60, 90)).toBe(720);
  });
  it('is skipped (not guessed) when weight, MET or duration is missing or invalid', () => {
    const cases: [number, number | undefined, number][] = [[8, undefined, 30], [8, 0, 30], [8, -5, 30], [0, 70, 30], [8, 70, 0], [8, 70, Number.NaN]];
    for (const [met, kg, min] of cases) expect(estimateKcal(met, kg, min)).toBeUndefined();
  });
  it('weight source: latest logged weight, else Settings, else none', () => {
    expect(bodyWeightKg(71, 80)).toBe(71);
    expect(bodyWeightKg(undefined, 80)).toBe(80);
    expect(bodyWeightKg(undefined, undefined)).toBeUndefined();
  });
  it("the user's own calories win over the estimate", () => {
    const c = { activityRef: 'a', activityName: 'Run', met: 9, durationMin: 30 };
    expect(cardioKcal({ ...c, kcalEstimated: 300 })).toBe(300);
    expect(cardioKcal({ ...c, kcalEstimated: 300, kcalOverride: 0 })).toBe(0);
    expect(cardioKcal(c)).toBeUndefined();
  });
});

describe('activities table', () => {
  it('has unique stable ids, sane MET values and no duplicates in name', () => {
    expect(new Set(ACTIVITIES.map((a) => a.id)).size).toBe(ACTIVITIES.length);
    expect(new Set(ACTIVITIES.map((a) => a.name)).size).toBe(ACTIVITIES.length);
    for (const a of ACTIVITIES) {
      expect(a.id).toMatch(/^act:[a-z0-9-]+$/);
      expect(a.met).toBeGreaterThanOrEqual(1.5);
      expect(a.met).toBeLessThanOrEqual(15);
    }
    const run = (id: string) => ACTIVITIES.find((a) => a.id === id)!.met;
    expect(run('act:run-13')).toBeGreaterThan(run('act:run-10'));
    expect(run('act:run-10')).toBeGreaterThan(run('act:jog') - 0.01);
    expect(run('act:walk-brisk')).toBeGreaterThan(run('act:walk-slow'));
  });
});

describe('units', () => {
  it('round-trips weights and distances without visible drift', () => {
    for (const kg of [20, 42.5, 60, 100.25, 182.5]) expect(displayWeight(toKg(displayWeight(kg, 'imperial'), 'imperial'), 'imperial')).toBe(displayWeight(kg, 'imperial'));
    for (const lb of [45, 135, 225.5]) expect(displayWeight(lbToKg(lb), 'imperial')).toBe(lb);
    expect(kgToLb(100)).toBeCloseTo(220.46, 2);
    expect(displayWeight(60, 'metric')).toBe(60);
    expect(miToKm(kmToMi(5))).toBeCloseTo(5, 10);
    expect(displayDistance(toKm(3.1, 'imperial'), 'imperial')).toBe(3.1);
    expect(displayDistance(10, 'metric')).toBe(10);
  });
});

describe('set summaries ("Last time: …")', () => {
  const w = (reps: number, weightKg: number, type: 'working' | 'warmup' = 'working') => ({ type, reps, weightKg });
  it('collapses identical working sets and ignores warm-ups', () => {
    expect(summarizeSets([w(10, 20, 'warmup'), w(8, 60), w(8, 60), w(8, 60)], 'metric')).toBe('3×8 @ 60 kg');
  });
  it('lists sets when they differ', () => {
    expect(summarizeSets([w(8, 60), w(8, 60), w(6, 62.5)], 'metric')).toBe('8 @ 60, 8 @ 60, 6 @ 62.5 kg');
  });
  it('converts to pounds and handles bodyweight sets', () => {
    expect(summarizeSets([w(5, 60), w(5, 60)], 'imperial')).toBe('2×5 @ 132.3 lb');
    expect(summarizeSets([w(12, 0), w(10, 0)], 'metric')).toBe('12, 10');
    expect(summarizeSets([w(12, 0), w(12, 0), w(12, 0)], 'metric')).toBe('3×12');
  });
  it('is empty when there was nothing but warm-ups', () => {
    expect(summarizeSets([w(10, 20, 'warmup')], 'metric')).toBe('');
  });
});

describe('estimated 1RM (Epley)', () => {
  it('w × (1 + reps/30) for 2–12 reps; w for a single; nothing beyond 12 reps', () => {
    expect(estimatedOneRepMax(100, 5)).toBeCloseTo(116.67, 2);
    expect(estimatedOneRepMax(100, 1)).toBe(100);
    expect(estimatedOneRepMax(100, 13)).toBeUndefined();
    expect(estimatedOneRepMax(0, 5)).toBeUndefined();
  });
});

describe('copy and describe', () => {
  it('copies exercises with new set ids and no shared references', () => {
    let n = 0;
    const src = [{ exerciseRef: 'ex:a', exerciseName: 'A', sets: [{ id: 's1', type: 'working' as const, reps: 5, weightKg: 50 }] }];
    const copy = copyExercises(src, () => `new${++n}`);
    expect(copy[0]!.sets[0]).toEqual({ id: 'new1', type: 'working', reps: 5, weightKg: 50 });
    copy[0]!.sets[0]!.reps = 99;
    expect(src[0]!.sets[0]!.reps).toBe(5);
  });
  it('describes workouts for lists', () => {
    expect(describeWorkout({ type: 'cardio', cardio: { activityRef: 'a', activityName: 'Running', met: 9, durationMin: 30.4 } })).toEqual({ title: 'Running', detail: '30 min' });
    expect(describeWorkout({ type: 'strength', name: 'Push day', exercises: [{ exerciseRef: 'x', exerciseName: 'X', sets: [{ id: '1', type: 'working', reps: 5, weightKg: 1 }, { id: '2', type: 'working', reps: 0, weightKg: 0 }] }] })).toEqual({ title: 'Push day', detail: '1 exercise · 1 set' });
  });
});

// ---- previous performance, repeat-last and recents against a real (fake) IndexedDB ----
vi.mock('../../src/db/open', async (orig) => {
  const real = await orig<typeof import('../../src/db/open')>();
  let p: Promise<unknown> | null = null;
  return { ...real, getDb: () => (p ??= real.openDatabase({ name: 'workoutstore-test' })) };
});
const store = await import('../../src/db/workoutStore');

const strength = (day: string, name: string, ex: [string, number, number][], over: Partial<Workout> = {}) =>
  store.workoutsRepo.create({
    day, type: 'strength', name,
    exercises: ex.map(([ref, reps, kg]) => ({ exerciseRef: ref, exerciseName: ref.toUpperCase(), sets: [{ id: `${ref}-${reps}`, type: 'working' as const, reps, weightKg: kg }] })),
    ...over,
  });
const tick = () => new Promise((r) => setTimeout(r, 3));

describe('workout store queries', () => {
  it('last performance = latest earlier workout with that exercise, never the current one, never a later day', async () => {
    const old = await strength('2026-09-01', 'old', [['ex:squat', 5, 80]]); await tick();
    const mid = await strength('2026-09-10', 'mid', [['ex:squat', 5, 90], ['ex:bench', 8, 60]]); await tick();
    const cur = await strength('2026-09-20', 'current', [['ex:squat', 5, 95]]); await tick();
    await strength('2026-09-30', 'future', [['ex:squat', 5, 200]]);
    const last = await store.lastPerformance('ex:squat', cur);
    expect(last?.workout.id).toBe(mid.id);
    expect(last?.exercise.sets[0]!.weightKg).toBe(90);
    expect((await store.lastPerformance('ex:squat', mid))?.workout.id).toBe(old.id);
    expect(await store.lastPerformance('ex:squat', old)).toBeUndefined();
    expect((await store.lastPerformance('ex:bench', cur))?.workout.id).toBe(mid.id);
    expect(await store.lastPerformance('ex:never', cur)).toBeUndefined();
  });

  it('ignores deleted workouts and warm-up-only appearances; same-day earlier workouts count, later ones do not', async () => {
    const a = await strength('2026-10-01', 'a', [['ex:row', 10, 50]]); await tick();
    const gone = await strength('2026-10-02', 'gone', [['ex:row', 10, 70]]); await store.workoutsRepo.remove(gone.id);
    await store.workoutsRepo.create({ day: '2026-10-03', type: 'strength', exercises: [{ exerciseRef: 'ex:row', exerciseName: 'ROW', sets: [{ id: 'w', type: 'warmup', reps: 10, weightKg: 20 }] }] }); await tick();
    const morning = await strength('2026-10-05', 'morning', [['ex:row', 10, 55]]); await tick();
    const evening = await strength('2026-10-05', 'evening', [['ex:row', 10, 60]]);
    expect((await store.lastPerformance('ex:row', evening))?.workout.id).toBe(morning.id);
    expect((await store.lastPerformance('ex:row', morning))?.workout.id).toBe(a.id);
  });

  it('last workout of a type picks the newest day, and the latest created within a day', async () => {
    await store.workoutsRepo.create({ day: '2026-11-01', type: 'cardio', cardio: { activityRef: 'act:jog', activityName: 'Jog', met: 7, durationMin: 20 } }); await tick();
    const later = await store.workoutsRepo.create({ day: '2026-11-01', type: 'cardio', cardio: { activityRef: 'act:run-10', activityName: 'Run', met: 9.8, durationMin: 30 } });
    expect((await store.lastWorkout('cardio'))?.id).toBe(later.id);
    expect(((await store.lastWorkout('strength'))?.day ?? '') < '2026-11-01').toBe(true);
  });

  it('recent exercises and activities are distinct, newest first', async () => {
    const ex = await store.recentRefs('exercise', 5);
    expect(new Set(ex.map((e) => e.ref)).size).toBe(ex.length);
    expect(ex.length).toBeGreaterThan(2);
    const act = await store.recentRefs('activity', 5);
    expect(act[0]!.ref).toBe('act:run-10');
  });

  it('lists a day in creation order', async () => {
    const day = await store.workoutsForDay('2026-10-05');
    expect(day.map((w) => w.name)).toEqual(['morning', 'evening']);
  });
});

void openDatabase;
