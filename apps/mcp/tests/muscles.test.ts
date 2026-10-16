import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { levelFor, MUSCLE_GROUPS, type MuscleMap } from '../src/analytics/muscles';
import { BODY_MUSCLES } from '../ui/shared/humanBody';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

let client: Client;
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const SQUAT = 'ex:Barbell_Squat'; // quadriceps; also calves, glutes, hamstrings, lower back
const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip'; // chest; also shoulders, triceps
const CURL = 'ex:Barbell_Curl'; // biceps; also forearms
const sets = (n: number) => Array.from({ length: n }, () => ({ reps: 8, weight_kg: 40 }));

/** One week: bench 3 × 8 sets, squat 2 × 4, curls 2 × 6. */
async function seed() {
  await call(client, 'log_past_workout', { day: '2026-10-06', exercises: [{ id: SQUAT, sets: sets(4) }, { id: BENCH, sets: sets(8) }] });
  await call(client, 'log_past_workout', { day: '2026-10-08', exercises: [{ id: BENCH, sets: sets(8) }, { id: CURL, sets: sets(6) }] });
  await call(client, 'log_past_workout', { day: '2026-10-10', exercises: [{ id: SQUAT, sets: sets(4) }, { id: BENCH, sets: sets(8) }, { id: CURL, sets: sets(6) }] });
}

describe('muscle map', () => {
  it('uses the muscle groups of the body model, in its order', () => {
    expect([...MUSCLE_GROUPS]).toEqual(BODY_MUSCLES);
  });

  it('grades weekly sets against the 10–20 range', () => {
    expect([0, 0.5, 9.9, 10, 20, 20.5].map(levelFor)).toEqual(['none', 'below', 'below', 'in_range', 'in_range', 'high']);
  });

  it('counts main muscles fully and helping muscles by half', async () => {
    await seed();
    const res = await call(client, 'show_muscle_map', { weeks: 1, to: '2026-10-11' });
    const map = (res.data as unknown as { muscleMap: MuscleMap }).muscleMap;
    const by = Object.fromEntries(map.muscles.map((m) => [m.muscle, m]));
    expect(map).toMatchObject({ from: '2026-10-05', to: '2026-10-11', weeks: 1, sessions: 3 });
    expect(map.muscles).toHaveLength(17);
    expect(by.chest).toMatchObject({ setsPerWeek: 24, level: 'high', lastTrained: '2026-10-10' });
    expect(by.shoulders).toMatchObject({ setsPerWeek: 12, level: 'in_range', lastTrained: null }); // only ever helping
    expect(by.biceps).toMatchObject({ setsPerWeek: 12, level: 'in_range' });
    expect(by.quadriceps).toMatchObject({ setsPerWeek: 8, level: 'below' });
    expect(by.hamstrings).toMatchObject({ setsPerWeek: 4, level: 'below' });
    expect(by.forearms!.setsPerWeek).toBe(6);
    expect(by.lats).toMatchObject({ setsPerWeek: 0, level: 'none', topExercises: [] });
    expect(by.triceps!.topExercises).toEqual([{ name: expect.stringContaining('Bench Press'), sets: 12 }]);
    // The model gets the same picture as text.
    expect(res.text).toContain('Over the range: chest 24, last 1 d ago.');
    expect(res.text).toContain('Not trained: abdominals 0');
  });

  it('averages over longer periods and says when there is nothing to show', async () => {
    await seed();
    const four = (await call(client, 'get_muscle_map', { weeks: 4, to: '2026-10-11' })).data as unknown as { muscleMap: MuscleMap };
    expect(four.muscleMap.muscles.find((m) => m.muscle === 'chest')).toMatchObject({ setsPerWeek: 6, level: 'below' });
    const empty = await call(client, 'show_muscle_map', { weeks: 1, to: '2026-09-01' });
    expect(empty.text).toContain('No finished strength workouts');
  });
});
