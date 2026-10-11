import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { estimateKcal, bodyWeightKg } from '../../src/domain/met';
import { suggestNextKg, workoutTally, addedLoadKg, cardioKcal, copyExercises, describeWorkout, estimatedOneRepMax, formatDuration, isSetLogged, newSet, normalizeSupersets, parseDuration, summarizeSets, supersetPosition } from '../../src/domain/workouts';
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
  it('keeps a second decimal for small plates, not for conversion noise', () => {
    expect(displayWeight(62.25, 'metric', 2)).toBe(62.25);
    expect(displayWeight(1.75, 'metric', 2)).toBe(1.75);
    expect(displayWeight(62.33, 'metric', 2)).toBe(62.3);
    expect(displayWeight(62.25, 'metric')).toBe(62.3); // default stays at 0.1
    expect(displayWeight(60, 'imperial', 2)).toBe(132.3);
    expect(displayWeight(lbToKg(132.25), 'imperial', 2)).toBe(132.25);
  });
});

describe('set summaries ("Last time: …")', () => {
  const w = (reps: number, weightKg: number, type: 'working' | 'warmup' = 'working') => ({ type, reps, weightKg });
  it('collapses identical working sets and ignores warm-ups', () => {
    expect(summarizeSets([w(10, 20, 'warmup'), w(8, 60), w(8, 60), w(8, 60)], 'metric')).toBe('3×8 @ 60 kg');
  });
  it('lists sets when they differ', () => {
    expect(summarizeSets([w(8, 60), w(8, 60), w(6, 62.5)], 'metric')).toBe('8 @ 60, 8 @ 60, 6 @ 62.5 kg');
    expect(summarizeSets([w(8, 60), w(6.5, 62.25)], 'metric')).toBe('8 @ 60, 6.5 @ 62.25 kg');
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
    expect(copy[0]!.sets[0]).toEqual({ id: 'new1', type: 'working', reps: 5, weightKg: 50, done: false }); // planned until you do it
    copy[0]!.sets[0]!.reps = 99;
    expect(src[0]!.sets[0]!.reps).toBe(5);
  });
  it('describes workouts for lists', () => {
    expect(describeWorkout({ type: 'cardio', cardio: { activityRef: 'a', activityName: 'Running', met: 9, durationMin: 30.4 } })).toEqual({ title: 'Running', detail: '30.4 min' });
    expect(describeWorkout({ type: 'strength', name: 'Push day', exercises: [{ exerciseRef: 'x', exerciseName: 'X', sets: [{ id: '1', type: 'working', reps: 5, weightKg: 1 }, { id: '2', type: 'working', reps: 0, weightKg: 0 }] }] })).toEqual({ title: 'Push day', detail: '1 exercise · 1 set' });
  });
});

describe('timed and bodyweight sets', () => {
  const ts = (durationSec: number, type: 'working' | 'warmup' = 'working') => ({ type, reps: 0, weightKg: 0, durationSec });
  const bw = (reps: number, added: number, body = 80) => ({ type: 'working' as const, reps, weightKg: body + added, bodyweightKg: body });

  it('formats and parses durations', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(95)).toBe('1:35');
    expect(formatDuration(3605)).toBe('60:05');
    for (const [text, sec] of [['45', 45], ['45s', 45], ['90 sec', 90], ['1:30', 90], ['0:45', 45], ['1m30', 90], ['1m 30s', 90], ['2m', 120], ['1.5m', 90], ['1,5m', 90], [' 2:05 ', 125]] as const) expect(parseDuration(text), text).toBe(sec);
    for (const bad of ['', 'abc', '1:75', '-5', '1:2:3', 'm']) expect(parseDuration(bad), bad).toBeNull();
  });

  it('timed sets are summarised in time, not reps', () => {
    expect(summarizeSets([ts(45), ts(45), ts(45)], 'metric')).toBe('3×45 s');
    expect(summarizeSets([ts(45), ts(60), ts(75)], 'metric')).toBe('45 s, 1:00, 1:15');
    expect(summarizeSets([ts(30, 'warmup')], 'metric')).toBe('');
    expect(summarizeSets([{ type: 'working', reps: 0, weightKg: 20, durationSec: 30 }], 'metric')).toBe('1×30 s @ 20 kg');
  });

  it('bodyweight sets read as BW, with added load shown when there is some', () => {
    expect(summarizeSets([bw(8, 0), bw(8, 0), bw(8, 0)], 'metric')).toBe('3×8 @ BW');
    expect(summarizeSets([bw(6, 10), bw(6, 10)], 'metric')).toBe('2×6 @ BW + 10 kg');
    expect(summarizeSets([bw(8, 0), bw(6, 5)], 'metric')).toBe('8 @ BW, 6 @ BW + 5 kg');
    expect(summarizeSets([bw(8, 0), bw(6, 5)], 'imperial')).toBe('8 @ BW, 6 @ BW + 11 lb');
    expect(addedLoadKg(bw(5, 12.5, 79.4))).toBe(12.5);
    expect(addedLoadKg({ weightKg: 60 })).toBe(60);
  });

  it('knows when a set has something in it', () => {
    expect(isSetLogged({ reps: 0, weightKg: 0 })).toBe(false);
    expect(isSetLogged({ reps: 8, weightKg: 0 })).toBe(true);
    expect(isSetLogged({ reps: 0, weightKg: 0, durationSec: 30 })).toBe(true);
    expect(isSetLogged({ reps: 0, weightKg: 80, bodyweightKg: 80 })).toBe(false); // empty bodyweight set: only your own weight
    expect(isSetLogged({ reps: 0, weightKg: 90, bodyweightKg: 80 })).toBe(true);
  });

  it('only counts sets that were done: planned ones are left out, older sets (no flag) count', () => {
    expect(isSetLogged({ reps: 8, weightKg: 60, done: false })).toBe(false);
    expect(isSetLogged({ reps: 8, weightKg: 60, done: true })).toBe(true);
    expect(isSetLogged({ reps: 8, weightKg: 60 })).toBe(true);
    const sets = [{ type: 'working' as const, reps: 8, weightKg: 60 }, { type: 'working' as const, reps: 8, weightKg: 60, done: false }];
    expect(summarizeSets(sets, 'metric')).toBe('1×8 @ 60 kg');
    expect(describeWorkout({ type: 'strength', exercises: [{ exerciseRef: 'x', exerciseName: 'X', sets: sets.map((s, i) => ({ ...s, id: String(i) })) }] }).detail).toBe('1 exercise · 1 set');
  });

  it('new sets carry time and bodyweight from the previous one', () => {
    expect(newSet('a', 'working', { reps: 0, weightKg: 0, durationSec: 40 })).toEqual({ id: 'a', type: 'working', reps: 0, weightKg: 0, durationSec: 40, done: false });
    expect(newSet('b', 'working', { reps: 5, weightKg: 85, bodyweightKg: 80 })).toEqual({ id: 'b', type: 'working', reps: 5, weightKg: 85, bodyweightKg: 80, done: false });
    expect(newSet('c')).toEqual({ id: 'c', type: 'working', reps: 0, weightKg: 0, done: false });
  });

  it('counts timed and bodyweight sets in workout descriptions', () => {
    const w = { type: 'strength' as const, exercises: [{ exerciseRef: 'x', exerciseName: 'Plank', mode: 'time' as const, sets: [{ id: '1', ...ts(40) }, { id: '2', type: 'working' as const, reps: 0, weightKg: 0 }] }] };
    expect(describeWorkout(w).detail).toBe('1 exercise · 1 set');
  });

  it('keeps the timed/bodyweight/superset settings when a workout is copied', () => {
    const src = [{ uid: 'u1', supersetId: 's1', mode: 'time' as const, load: 'bodyweight' as const, exerciseRef: 'ex:plank', exerciseName: 'Plank', sets: [{ id: 'a', type: 'working' as const, reps: 0, weightKg: 80, bodyweightKg: 80, durationSec: 45 }] }];
    const copy = copyExercises(src, () => 'n');
    expect(copy[0]).toMatchObject({ supersetId: 's1', mode: 'time', load: 'bodyweight' });
    expect(copy[0]!.sets[0]).toEqual({ id: 'n', type: 'working', reps: 0, weightKg: 80, bodyweightKg: 80, durationSec: 45, done: false });
  });
});

describe('supersets', () => {
  const x = (name: string, supersetId?: string) => ({ exerciseRef: `ex:${name}`, exerciseName: name, supersetId, sets: [] });
  let n = 0;
  const id = () => `new${++n}`;

  it('a superset needs neighbours: lonely ids are dropped, runs keep theirs', () => {
    const out = normalizeSupersets([x('a', 's1'), x('b', 's1'), x('c'), x('d', 's2')], id);
    expect(out.map((e) => e.supersetId)).toEqual(['s1', 's1', undefined, undefined]);
  });

  it('unlinking in the middle splits the group instead of leaving a ghost link', () => {
    const out = normalizeSupersets([x('a', 's1'), x('b'), x('c', 's1'), x('d', 's1')], id);
    expect(out[0]!.supersetId).toBeUndefined(); // a is alone now
    expect(out[2]!.supersetId).toBeDefined();
    expect(out[2]!.supersetId).toBe(out[3]!.supersetId);
  });

  it('three in a row stay together; two separate runs sharing an id get distinct ids', () => {
    expect(new Set(normalizeSupersets([x('a', 's'), x('b', 's'), x('c', 's')], id).map((e) => e.supersetId)).size).toBe(1);
    const split = normalizeSupersets([x('a', 's'), x('b', 's'), x('c'), x('d', 's'), x('e', 's')], id);
    expect(split[0]!.supersetId).toBe(split[1]!.supersetId);
    expect(split[3]!.supersetId).toBe(split[4]!.supersetId);
    expect(split[0]!.supersetId).not.toBe(split[3]!.supersetId);
  });

  it('does not change its input', () => {
    const input = [x('a', 's1'), x('b')];
    normalizeSupersets(input, id);
    expect(input[0]!.supersetId).toBe('s1');
  });

  it('labels each exercise A, B, C within its group', () => {
    const list = [x('a'), x('b', 's'), x('c', 's'), x('d', 's'), x('e')];
    expect(supersetPosition(list, 0)).toBeNull();
    expect(supersetPosition(list, 1)).toEqual({ letter: 'A', size: 3, first: true, last: false });
    expect(supersetPosition(list, 2)).toEqual({ letter: 'B', size: 3, first: false, last: false });
    expect(supersetPosition(list, 3)).toEqual({ letter: 'C', size: 3, first: false, last: true });
    expect(supersetPosition(list, 4)).toBeNull();
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

  it('"last time" understands timed sets and ignores a bodyweight set with nothing in it', async () => {
    const timed = await store.workoutsRepo.create({ day: '2026-12-01', type: 'strength', exercises: [{ exerciseRef: 'ex:plank', exerciseName: 'Plank', mode: 'time', sets: [{ id: 'p', type: 'working', reps: 0, weightKg: 0, durationSec: 60 }] }] });
    await tick();
    const later = await store.workoutsRepo.create({ day: '2026-12-02', type: 'strength', exercises: [{ exerciseRef: 'ex:plank', exerciseName: 'Plank', mode: 'time', sets: [] }] });
    expect((await store.lastPerformance('ex:plank', later))?.workout.id).toBe(timed.id);
    const empty = await store.workoutsRepo.create({ day: '2026-12-03', type: 'strength', exercises: [{ exerciseRef: 'ex:plank', exerciseName: 'Plank', sets: [{ id: 'e', type: 'working', reps: 0, weightKg: 0 }] }] });
    const after = await store.workoutsRepo.create({ day: '2026-12-04', type: 'strength', exercises: [] });
    expect((await store.lastPerformance('ex:plank', after))?.workout.id).not.toBe(empty.id);
  });

  it('lists a day in creation order', async () => {
    const day = await store.workoutsForDay('2026-10-05');
    expect(day.map((w) => w.name)).toEqual(['morning', 'evening']);
  });
});

void openDatabase;

describe('during a workout', () => {
  const ws = (reps: number, weightKg: number, extra = {}) => ({ type: 'working' as const, reps, weightKg, ...extra });
  it('suggests one small step up when every working set hit the same weight for 5+ reps', () => {
    expect(suggestNextKg([ws(5, 80), ws(5, 80)], 'metric')).toBe(82.5);
    expect(displayWeight(suggestNextKg([ws(8, lbToKg(135))], 'imperial')!, 'imperial')).toBe(140);
    expect(suggestNextKg([ws(5, 80), ws(4, 80)], 'metric')).toBeUndefined(); // missed reps: no nudge
    expect(suggestNextKg([ws(5, 80), ws(5, 85)], 'metric')).toBeUndefined(); // mixed weights
    expect(suggestNextKg([ws(8, 90, { bodyweightKg: 80 })], 'metric')).toBeUndefined(); // bodyweight
    expect(suggestNextKg([ws(5, 80, { done: false })], 'metric')).toBeUndefined(); // only done sets
  });
  it('tallies done sets and volume, leaving out planned sets, warm-ups and timed sets', () => {
    const t = workoutTally([
      { sets: [{ ...ws(5, 100), id: '1' }, { ...ws(5, 100, { done: false }), id: '2' }, { id: '3', type: 'warmup', reps: 10, weightKg: 40 }] },
      { mode: 'time', sets: [{ id: '4', type: 'working', reps: 0, weightKg: 0, durationSec: 60 }] },
    ]);
    expect(t).toEqual({ done: 3, total: 4, volumeKg: 500 });
  });
});
