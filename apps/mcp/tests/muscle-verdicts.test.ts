// A verdict per muscle group in the weekly review (A6): sets a week against the usual range and the period before, in plain words.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MuscleMap } from '../src/analytics/muscleTypes';
import { muscleVerdicts } from '../src/analytics/muscleVerdicts';
import type { WeekReview } from '../src/analytics/reviewTypes';
import { todayIn } from '../src/data/time';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const map = (muscles: Partial<MuscleMap['muscles'][number]>[]): MuscleMap => ({
  from: '2026-10-26', to: '2026-11-01', weeks: 1, sessions: 3, range: { low: 10, high: 20 },
  muscles: muscles.map((m) => ({ muscle: 'chest', setsPerWeek: 0, previousSetsPerWeek: null, level: 'none', lastTrained: null, topExercises: [], ...m })),
});

describe('the pure verdicts', () => {
  it('says where each muscle is against the range and what changed, most trained first, and leaves out what was never trained', () => {
    const v = muscleVerdicts(map([
      { muscle: 'chest', setsPerWeek: 14, previousSetsPerWeek: 9, level: 'in_range' },
      { muscle: 'quadriceps', setsPerWeek: 6, previousSetsPerWeek: 6, level: 'below' },
      { muscle: 'lats', setsPerWeek: 24, previousSetsPerWeek: 20, level: 'high' },
      { muscle: 'calves', setsPerWeek: 0, previousSetsPerWeek: 8, level: 'none' },
      { muscle: 'neck', setsPerWeek: 0, previousSetsPerWeek: null, level: 'none' },
    ]), false);
    expect(v.items.map((i) => i.muscle)).toEqual(['lats', 'chest', 'quadriceps', 'calves']); // neck: never trained, left out
    const text = Object.fromEntries(v.items.map((i) => [i.muscle, i.verdict]));
    expect(text.chest).toBe('14 sets a week: in the usual 10 to 20. Up 5 from 9.');
    expect(text.quadriceps).toBe('6 sets a week: under the usual 10 to 20. About the same as before.');
    expect(text.lats).toContain('above the usual');
    expect(text.calves).toBe('Not trained in this period, after 8 sets a week before.');
    expect(v.partial).toBe(false);
  });

  it('says "so far" for an under-range muscle while the period is still running, and does not claim advice', () => {
    const v = muscleVerdicts(map([{ muscle: 'chest', setsPerWeek: 4, previousSetsPerWeek: null, level: 'below' }]), true);
    expect(v.items[0]!.verdict).toBe('4 sets a week: under the usual 10 to 20 so far.');
    expect(v.partial).toBe(true);
  });
});

describe('in the weekly review', () => {
  const today = todayIn('Europe/Copenhagen');
  const thisWeek = weekStart(today);
  let n = 0;
  beforeEach(() => {
    n = 0;
  });

  it('carries a verdict per trained muscle for the reviewed week, against the week before', async () => {
    const { env } = createTestEnv();
    const user = await signedInUser(env, 'ana@example.com');
    const client = await connectAs(env, user);
    const bench = (sets: number) => JSON.stringify([{ exerciseRef: 'ex:Barbell_Bench_Press_-_Medium_Grip', exerciseName: 'Barbell Bench Press', sets: Array.from({ length: sets }, (_, i) => ({ id: `s${i}`, type: 'working', reps: 8, weightKg: 60, done: true })) }]);
    const store = (day: string, sets: number) => env.DB.prepare("INSERT INTO workouts (id, user_id, day, type, name, started_at, finished_at, exercises, created_at, updated_at) VALUES (?, ?, ?, 'strength', 'Push', 1, 2, ?, 1, 1)").bind(`w${++n}`, user.id, day, bench(sets)).run();
    const lastWeek = addDays(thisWeek, -7);
    await store(addDays(lastWeek, 1), 12);
    await store(addDays(addDays(lastWeek, -7), 1), 6);
    const r = (await call(client, 'show_weekly_review', { week_start: lastWeek })).data as unknown as { review: WeekReview };
    const chest = r.review.muscles!.items.find((i) => i.muscle === 'chest')!;
    expect(chest).toMatchObject({ level: 'in_range', previousSetsPerWeek: 6 });
    expect(chest.verdict).toContain('in the usual 10 to 20');
    expect(r.review.muscles!.range).toEqual({ low: 10, high: 20 });
    expect(r.review.muscles!.partial).toBe(false);
  });

  it('is empty for a week without strength work', async () => {
    const { env } = createTestEnv();
    const client = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    const r = (await call(client, 'show_weekly_review', { week_start: addDays(thisWeek, -7) })).data as unknown as { review: WeekReview };
    expect(r.review.muscles!.items).toEqual([]);
  });
});
