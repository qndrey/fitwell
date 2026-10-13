import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../src/data/users';
import type { WorkoutPlan } from '../src/workout/plan';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
});

const SQUAT = 'ex:Barbell_Squat';
const PULLUP = 'ex:Pullups';

async function start(args: Record<string, unknown>): Promise<WorkoutPlan> {
  const { data, isError, text } = await call(client, 'start_workout', args);
  expect(isError, text).toBe(false);
  return data.workout as WorkoutPlan;
}

/** Logs every planned set with the given reps (and weight), then finishes. */
async function doWorkout(plan: WorkoutPlan, reps: (exercise: number, set: number) => number, weight?: (exercise: number) => number) {
  for (const [i, e] of plan.exercises.entries()) {
    for (const [k, s] of e.sets.entries()) {
      await call(client, 'log_set', { workoutId: plan.workoutId, setId: s.id, reps: reps(i, k), ...(e.bodyweight ? {} : { weightKg: weight?.(i) ?? s.weightKg }) });
    }
  }
  return (await call(client, 'finish_workout', { workoutId: plan.workoutId })).data;
}

describe('strength workouts', () => {
  it('stores sets, finishes with a summary, and shows last time and a progression next time', async () => {
    const first = await start({ name: 'Legs', exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 80 }] });
    const summary = await doWorkout(first, () => 5);
    expect(summary).toMatchObject({ name: 'Legs', volumeKg: 1200, exercises: [{ name: 'Barbell Squat', done: '3×5 @ 80 kg', estimated1rmKg: 93.3 }] });
    expect((summary.exercises as { personalRecord?: string }[])[0]!.personalRecord).toBeUndefined(); // nothing to beat yet

    // Next time, no weight given: the rule adds 2.5 kg because every set hit 5 reps.
    const second = await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5 }] });
    const squat = second.exercises[0]!;
    expect(squat.sets[0]!.weightKg).toBe(82.5);
    expect(squat.lastTime).toMatch(/^3×5 @ 80 kg \(\d{4}-\d{2}-\d{2}\)$/);
    expect(squat.note).toContain('add 2.5 kg');
    const after = await doWorkout(second, () => 5);
    expect((after.exercises as { personalRecord?: string }[])[0]!.personalRecord).toContain('New best estimated 1RM: 96.3 kg');
  });

  it('repeats the weight after a missed set, and an explicit weight always wins', async () => {
    await doWorkout(await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 100 }] }), (_i, k) => (k === 0 ? 5 : 3));
    const next = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5 }] });
    expect(next.exercises[0]!.sets[0]!.weightKg).toBe(100);
    const explicit = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 60 }] });
    expect(explicit.exercises[0]!.sets[0]!.weightKg).toBe(60);
    expect(explicit.exercises[0]!.note).toBeUndefined();
  });

  it('resumes from the stored state and records skipped sets', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 80 }, { id: PULLUP, sets: 2, reps: 8 }] });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's1.1', reps: 5, weightKg: 80 });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's1.2', reps: 0, skip: true });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's2.1', reps: 9 });
    const { data } = await call(client, 'get_workout', { workoutId: plan.workoutId });
    const state = data.workout as WorkoutPlan;
    expect(state.exercises[0]!.sets.map((s) => [s.done, s.skipped ?? false])).toEqual([[true, false], [false, true]]);
    expect(state.exercises[1]!.sets[0]).toMatchObject({ done: true, reps: 9 });
    expect(state.finished).toBe(false);
  });

  it('suggests progression for exercises and templates', async () => {
    await doWorkout(await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 80 }, { id: PULLUP, sets: 2, reps: 8 }] }), (i) => (i === 0 ? 5 : 8));
    const { data } = await call(client, 'suggest_progression', { exercise_ids: [SQUAT, PULLUP, 'ex:Barbell_Deadlift'] });
    const ex = data.exercises as { id: string; lastTime: string | null; next: { action: string; weightKg?: number; reps: number } | null }[];
    expect(ex[0]).toMatchObject({ lastTime: '2×5 @ 80 kg', next: { action: 'increase', weightKg: 82.5 } });
    expect(ex[1]!.next).toMatchObject({ action: 'add_rep', reps: 9 });
    expect(ex[2]).toMatchObject({ lastTime: null, next: null });
  });
});

describe('templates', () => {
  it('saves, lists, starts from and deletes a template', async () => {
    const saved = await call(client, 'save_workout_template', { name: 'Push day', exercises: [{ id: SQUAT, sets: 3, reps: 5 }, { id: PULLUP, sets: 3, reps: 8, rest_sec: 120 }] });
    const id = (saved.data.template as { id: string }).id;
    const list = (await call(client, 'list_workout_templates', {})).data.templates as { id: string; name: string; exercises: string[] }[];
    expect(list).toEqual([{ id, name: 'Push day', exercises: ['Barbell Squat 3×5', 'Pullups 3×8'] }]);
    const plan = await start({ template_id: id });
    expect(plan.name).toBe('Push day');
    expect(plan.exercises[1]!.restSec).toBe(120);
    // Saving under the same name replaces it.
    await call(client, 'save_workout_template', { name: 'Push day', exercises: [{ id: SQUAT, sets: 5, reps: 5 }] });
    expect(((await call(client, 'list_workout_templates', {})).data.templates as unknown[]).length).toBe(1);
    expect((await call(client, 'delete_workout_template', { id })).data.deleted).toBe(id);
  });

  it('can save the plan as a template while starting', async () => {
    await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 60 }], save_as_template: 'Quick legs' });
    const list = (await call(client, 'list_workout_templates', {})).data.templates as { name: string }[];
    expect(list.map((t) => t.name)).toEqual(['Quick legs']);
  });
});

describe('cardio and history', () => {
  it('estimates cardio calories from MET and profile weight, or takes a measured number', async () => {
    const noWeight = await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, distance_km: 5 });
    expect(noWeight.data.note).toContain('No body weight');
    await call(client, 'update_profile', { weight_kg: 80 });
    const run = await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, distance_km: 5, day: '2026-10-12' });
    expect(run.data.logged).toMatchObject({ type: 'cardio', minutes: 30, distanceKm: 5, kcal: Math.round(9.8 * 80 * 0.5) });
    expect(run.data.pace).toBe('6:00 per km');
    const watch = await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, kcal: 333 });
    expect(watch.data.logged).toMatchObject({ kcal: 333 });
  });

  it('lists workouts and the sessions of one exercise, and deletes a workout', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 80 }] });
    await doWorkout(plan, (_i, k) => (k === 0 ? 5 : 4));
    await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 20 });
    const all = (await call(client, 'get_workout_history', {})).data.workouts as { type: string; exercises?: { done: string }[] }[];
    expect(all.map((w) => w.type).sort()).toEqual(['cardio', 'strength']);
    expect(all.find((w) => w.type === 'strength')!.exercises![0]!.done).toBe('5 @ 80, 4 @ 80 kg');
    const squat = (await call(client, 'get_workout_history', { exercise_id: SQUAT })).data;
    expect(squat).toMatchObject({ exercise: 'Barbell Squat', sessions: [{ bestSet: '5 @ 80 kg', estimated1rmKg: 93.3 }] });
    expect((await call(client, 'delete_workout', { id: plan.workoutId })).data.deleted).toBe(plan.workoutId);
    expect(((await call(client, 'get_workout_history', {})).data.workouts as unknown[]).length).toBe(1);
  });
});

describe('privacy', () => {
  it('keeps workouts and templates per person, and exports and erases them', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 1, reps: 5, weight_kg: 80 }], save_as_template: 'Ana legs' });
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    expect((await call(bo, 'log_set', { workoutId: plan.workoutId, setId: 's1.1', reps: 99 })).isError).toBe(true);
    expect((await call(bo, 'get_workout', { workoutId: plan.workoutId })).isError).toBe(true);
    expect((await call(bo, 'finish_workout', { workoutId: plan.workoutId })).isError).toBe(true);
    expect((await call(bo, 'delete_workout', { id: plan.workoutId })).isError).toBe(true);
    expect((await call(bo, 'get_workout_history', {})).data.workouts).toEqual([]);
    expect((await call(bo, 'list_workout_templates', {})).data.templates).toEqual([]);

    const exported = (await call(client, 'export_my_data', {})).data as { workouts: unknown[]; workoutTemplates: unknown[] };
    expect(exported.workouts.length).toBe(1);
    expect(exported.workoutTemplates.length).toBe(1);
    await call(client, 'delete_my_account', { confirm: 'delete my account' });
    const left = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM workouts) + (SELECT COUNT(*) FROM workout_templates) AS n').first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
