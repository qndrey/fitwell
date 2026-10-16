import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkoutPlan } from '../src/workout/plan';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

let client: Client;
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

type Listed = { ref: string; name: string; equipment: string; primary: string[] }[];

describe('exercise swap', () => {
  it('suggests substitutes, within the profile equipment and without what is busy', async () => {
    const any = await call(client, 'search_exercises', { similar_to: 'ex:Barbell_Squat' });
    const names = (any.data.exercises as Listed).map((e) => e.name);
    expect(names).toContain('Leg Press');
    expect((any.data.exercises as Listed).every((e) => e.primary.includes('quadriceps'))).toBe(true);
    expect(any.data.equipment).toContain('Any equipment');

    await call(client, 'update_profile', { equipment: ['dumbbell', 'body only'] });
    const home = await call(client, 'search_exercises', { similar_to: 'ex:Barbell_Bench_Press_-_Medium_Grip', exclude_equipment: ['body only'] });
    const list = home.data.exercises as Listed;
    expect(list.length).toBeGreaterThan(2);
    expect(list.every((e) => e.equipment === 'dumbbell' || e.equipment === 'none')).toBe(true);
    expect(list[0]!.name).toBe('Dumbbell Bench Press');
    expect((await call(client, 'search_exercises', { similar_to: 'ex:Nope' })).isError).toBe(true);
  });

  it('swaps an exercise in the player until its first set is logged', async () => {
    await call(client, 'log_past_workout', { day: '2026-10-01', exercises: [{ id: 'ex:Dumbbell_Bench_Press', sets: [{ reps: 8, weight_kg: 26 }, { reps: 8, weight_kg: 26 }, { reps: 8, weight_kg: 26 }] }] });
    const started = await call(client, 'start_workout', { exercises: [{ id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: 3, reps: 8, weight_kg: 60, rest_sec: 120, notes: 'Pause on the chest' }, { id: 'ex:Barbell_Squat', sets: 2, reps: 5, weight_kg: 80, rest_sec: 180 }] });
    const plan = started.data.workout as WorkoutPlan;
    const [bench, squat] = plan.exercises;

    const offered = (await call(client, 'get_substitutes', { workoutId: plan.workoutId, exerciseId: bench!.uid })).data.substitutes as { id: string; name: string; equipment: string }[];
    expect(offered.map((x) => x.name)).toContain('Dumbbell Bench Press');
    expect(offered.find((x) => x.name === 'Pushups')?.equipment).toBe('bodyweight');
    expect(offered.some((x) => x.id === 'ex:Barbell_Squat')).toBe(false);

    const swapped = await call(client, 'swap_exercise', { workoutId: plan.workoutId, exerciseId: bench!.uid, newId: 'ex:Dumbbell_Bench_Press' });
    const next = (swapped.data.workout as WorkoutPlan).exercises[0]!;
    // Same sets, reps, rest and place; the weight comes from the new exercise's own history (all reps hit: one step up).
    expect(next).toMatchObject({ uid: bench!.uid, id: 'ex:Dumbbell_Bench_Press', restSec: 120, lastTime: expect.stringContaining('26'), notes: 'Pause on the chest' });
    expect(next.sets.map((x) => x.targetReps)).toEqual([8, 8, 8]);
    expect(next.sets[0]!.weightKg).toBeGreaterThan(26);
    expect((await call(client, 'get_workout', { workoutId: plan.workoutId })).data.workout).toMatchObject({ exercises: [{ id: 'ex:Dumbbell_Bench_Press' }, { id: 'ex:Barbell_Squat' }] });

    await call(client, 'log_set', { workoutId: plan.workoutId, setId: squat!.sets[0]!.id, reps: 5, weightKg: 80 });
    const late = await call(client, 'swap_exercise', { workoutId: plan.workoutId, exerciseId: squat!.uid, newId: 'ex:Leg_Press' });
    expect(late.isError).toBe(true);
    expect(late.text).toContain('already logged');
  });
});
