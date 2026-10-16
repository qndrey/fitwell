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

const SQUAT = 'ex:Barbell_Squat';
const DEADLIFT = 'ex:Barbell_Deadlift';
const PULLUP = 'ex:Pullups';
const PLANK = 'ex:Plank';
const CURL = 'ex:Barbell_Curl';

async function start(args: Record<string, unknown>): Promise<WorkoutPlan> {
  const res = await call(client, 'start_workout', args);
  expect(res.isError, res.text).toBe(false);
  return res.data.workout as WorkoutPlan;
}
const weights = (e: WorkoutPlan['exercises'][number]) => e.sets.filter((s) => s.warmup).map((s) => [s.weightKg, s.targetReps]);

describe('warm-up sets', () => {
  it('ramps the first heavy lift fully, later ones briefly, and leaves the rest alone', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 100 }, { id: DEADLIFT, sets: 1, reps: 5, weight_kg: 140 }, { id: PULLUP, sets: 3, reps: 8 }, { id: CURL, sets: 3, reps: 10, weight_kg: 30 }] });
    const [squat, dead, pull, curl] = plan.exercises;
    expect(weights(squat!)).toEqual([[20, 8], [50, 5], [70, 3], [85, 1]]);
    expect(weights(dead!)).toEqual([[82.5, 4], [110, 2]]); // 84 → 82.5, 112 → 110
    expect(weights(pull!)).toEqual([]); // bodyweight
    expect(weights(curl!)).toEqual([]); // an isolation lift
    expect(squat!.sets.filter((s) => !s.warmup).map((s) => s.id)).toEqual(['s1.1', 's1.2', 's1.3']);
  });

  it('follows the plan when it says so, and the person\'s own bar and plates', async () => {
    await call(client, 'update_profile', { bar_kg: 15, plates_kg: [10, 5, 2.5] });
    const plan = await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 60, warmup: false }, { id: CURL, sets: 3, reps: 8, weight_kg: 45, warmup: true }] });
    expect(weights(plan.exercises[0]!)).toEqual([]);
    // The curl is the first ramped lift, so it gets the full ramp from the 15 kg bar: 22.5 → 20, 31.5 → 30, 38.25 → 35.
    expect(weights(plan.exercises[1]!)).toEqual([[15, 8], [20, 5], [30, 3], [35, 1]]);
    expect(plan.gym).toEqual({ barKg: 15, platesKg: [10, 5, 2.5] });
  });

  it('never counts warm-ups in the summary or the next progression', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 100 }] });
    for (const s of plan.exercises[0]!.sets) await call(client, 'log_set', { workoutId: plan.workoutId, setId: s.id, reps: s.warmup ? s.targetReps : 5, weightKg: s.weightKg });
    const summary = (await call(client, 'finish_workout', { workoutId: plan.workoutId })).data as { exercises: { done: string }[]; volumeKg: number };
    expect(summary.exercises[0]!.done).toBe('2×5 @ 100 kg');
    expect(summary.volumeKg).toBe(1000);
    const next = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5 }] });
    expect(next.exercises[0]!.sets.find((s) => !s.warmup)!.weightKg).toBe(102.5);
  });
});

describe('timed sets and supersets', () => {
  it('plans and logs a timed exercise in seconds', async () => {
    const plan = await start({ exercises: [{ id: PLANK, sets: 2, seconds: 45 }] });
    const plank = plan.exercises[0]!;
    expect(plank).toMatchObject({ timed: true, sets: [{ targetSec: 45 }, { targetSec: 45 }] });
    for (const [k, s] of plank.sets.entries()) await call(client, 'log_set', { workoutId: plan.workoutId, setId: s.id, reps: 0, seconds: k ? 40 : 45 });
    const state = (await call(client, 'get_workout', { workoutId: plan.workoutId })).data.workout as WorkoutPlan;
    expect(state.exercises[0]!.sets.map((s) => s.seconds)).toEqual([45, 40]);
    const summary = (await call(client, 'finish_workout', { workoutId: plan.workoutId })).data as { exercises: { done: string }[] };
    expect(summary.exercises[0]!.done).toBe('45 s @ BW, 40 s @ BW');
    expect((await call(client, 'start_workout', { exercises: [{ id: SQUAT, sets: 3 }] })).text).toContain('Give reps');
  });

  it('links neighbouring exercises with the same letter, and keeps it in templates', async () => {
    const exercises = [{ id: CURL, sets: 3, reps: 10, weight_kg: 30, superset: 'a' }, { id: 'ex:Triceps_Pushdown', sets: 3, reps: 12, superset: 'A' }, { id: PULLUP, sets: 3, reps: 8, superset: 'B' }];
    const plan = await start({ exercises, save_as_template: 'Arms' });
    const [c, t, p] = plan.exercises;
    expect(c!.supersetId).toBeDefined();
    expect(t!.supersetId).toBe(c!.supersetId);
    expect(p!.supersetId).toBeUndefined(); // a superset of one is not a superset
    const templates = (await call(client, 'list_workout_templates', {})).data.templates as { id: string }[];
    const again = await start({ template_id: templates[0]!.id });
    expect(again.exercises[1]!.supersetId).toBe(again.exercises[0]!.supersetId);
  });
});
