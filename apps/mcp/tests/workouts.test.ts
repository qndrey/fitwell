import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** The working sets of a planned exercise: heavy lifts start with warm-up sets. */
const work = (e: WorkoutPlan['exercises'][number]) => e.sets.filter((s) => !s.warmup);

async function start(args: Record<string, unknown>): Promise<WorkoutPlan> {
  const { data, isError, text } = await call(client, 'start_workout', args);
  expect(isError, text).toBe(false);
  return data.workout as WorkoutPlan;
}

/** Logs warm-ups as planned and every working set with the given reps (and weight; `set` counts working sets), then finishes. */
async function doWorkout(plan: WorkoutPlan, reps: (exercise: number, set: number) => number, weight?: (exercise: number) => number) {
  for (const [i, e] of plan.exercises.entries()) {
    for (const s of e.sets.filter((x) => x.warmup)) await call(client, 'log_set', { workoutId: plan.workoutId, setId: s.id, reps: s.targetReps, weightKg: s.weightKg });
    for (const [k, s] of work(e).entries()) {
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
    expect(work(squat)[0]!.weightKg).toBe(82.5);
    expect(squat.lastTime).toMatch(/^3×5 @ 80 kg \(\d{4}-\d{2}-\d{2}\)$/);
    expect(squat.note).toContain('add 2.5 kg');
    const after = await doWorkout(second, () => 5);
    expect((after.exercises as { personalRecord?: string }[])[0]!.personalRecord).toContain('New best estimated 1RM: 96.3 kg');
  });

  it('repeats the weight after a missed set, and an explicit weight always wins', async () => {
    await doWorkout(await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 100 }] }), (_i, k) => (k === 0 ? 5 : 3));
    const next = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5 }] });
    expect(work(next.exercises[0]!)[0]!.weightKg).toBe(100);
    const explicit = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 60 }] });
    expect(work(explicit.exercises[0]!)[0]!.weightKg).toBe(60);
    expect(explicit.exercises[0]!.note).toBeUndefined();
  });

  it('resumes from the stored state and records skipped sets', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 80 }, { id: PULLUP, sets: 2, reps: 8 }] });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's1.1', reps: 5, weightKg: 80 });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's1.2', reps: 0, skip: true });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's2.1', reps: 9 });
    const { data } = await call(client, 'get_workout', { workoutId: plan.workoutId });
    const state = data.workout as WorkoutPlan;
    expect(work(state.exercises[0]!).map((s) => [s.done, s.skipped ?? false])).toEqual([[true, false], [false, true]]);
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

describe('past workouts', () => {
  const past = (day: string, sets: [number, number][], id = SQUAT) => call(client, 'log_past_workout', { day, exercises: [{ id, sets: sets.map(([reps, weight_kg]) => ({ reps, weight_kg })) }] });

  it('stores a finished workout on the given day, with the summary of finishing one', async () => {
    const { data, isError } = await call(client, 'log_past_workout', { day: '2026-09-01', name: 'Legs', minutes: 50, exercises: [{ id: SQUAT, sets: [{ reps: 5, weight_kg: 80 }, { reps: 5, weight_kg: 80 }] }, { id: PULLUP, sets: [{ reps: 8 }, { reps: 7 }] }] });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ name: 'Legs', day: '2026-09-01', minutes: 50, volumeKg: 800, exercises: [{ name: 'Barbell Squat', done: '2×5 @ 80 kg', estimated1rmKg: 93.3 }, { name: 'Pullups', done: '8 @ BW, 7 @ BW' }] });
    const hist = (await call(client, 'get_workout_history', { days: 60, to: '2026-09-30' })).data.workouts as { day: string; finished: boolean; minutes?: number }[];
    expect(hist).toEqual([expect.objectContaining({ day: '2026-09-01', finished: true, minutes: 50 })]);
  });

  it('measures a personal record only against sessions up to that day', async () => {
    await past('2026-09-01', [[5, 80]]);
    const later = await past('2026-09-10', [[5, 85]]);
    expect((later.data.exercises as { personalRecord?: string }[])[0]!.personalRecord).toContain('was 93.3 kg');
    // Backdated between the two: beats the first session (80), not the later one (85).
    const between = await past('2026-09-05', [[5, 82.5]]);
    expect((between.data.exercises as { personalRecord?: string }[])[0]!.personalRecord).toBe('New best estimated 1RM: 96.3 kg (was 93.3 kg)');
    // And a lighter one before everything has nothing to beat.
    const first = await past('2026-08-20', [[5, 60]]);
    expect((first.data.exercises as { personalRecord?: string }[])[0]!.personalRecord).toBeUndefined();
  });

  it('feeds last time and progression like any workout, and rejects unknown ids', async () => {
    await past('2026-09-01', [[5, 80], [5, 80], [5, 80]]);
    const next = await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5 }] });
    expect(work(next.exercises[0]!)[0]!.weightKg).toBe(82.5);
    expect(next.exercises[0]!.lastTime).toContain('3×5 @ 80 kg (2026-09-01)');
    const bad = await call(client, 'log_past_workout', { day: '2026-09-01', exercises: [{ id: 'ex:Nope', sets: [{ reps: 5 }] }] });
    expect(bad.isError).toBe(true);
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
    expect((await call(client, 'delete_item', { kind: 'workout_template', id })).data.deleted).toEqual({ kind: 'workout_template', id });
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

  it('logs whole-body sessions as their own type, with calories, history and muscle credit', async () => {
    await call(client, 'update_profile', { weight_kg: 70 });
    const p = await call(client, 'log_session', { category: 'pilates', duration_min: 60, notes: 'reformer', day: '2026-10-12' });
    expect(p.data.logged).toMatchObject({ type: 'session', category: 'pilates', minutes: 60, kcal: Math.round(3 * 70), notes: 'reformer' });
    const h = await call(client, 'log_session', { category: 'hyrox', duration_min: 60, activity_id: 'act:hyrox-race', kcal: 900, day: '2026-10-13' });
    expect(h.data.logged).toMatchObject({ category: 'hyrox', kcal: 900 });
    const hist = (await call(client, 'get_workout_history', { days: 30, to: '2026-10-14' })).data.workouts as { type: string }[];
    expect(hist.map((w) => w.type)).toEqual(['session', 'session']);
    const map = (await call(client, 'get_muscle_map', { weeks: 1, to: '2026-10-14' })).data as { muscleMap?: { otherSessions: number; muscles: { muscle: string; setsPerWeek: number }[] } };
    const mm = map.muscleMap ?? (map as unknown as { otherSessions: number; muscles: { muscle: string; setsPerWeek: number }[] });
    expect(mm.otherSessions).toBe(2);
    expect(mm.muscles.find((x) => x.muscle === 'abdominals')!.setsPerWeek).toBe(7);
  });

  it('keeps sessions and cardio apart: log_cardio refuses a session activity, log_session a cardio one', async () => {
    expect((await call(client, 'log_cardio', { activity_id: 'act:pilates', duration_min: 45 })).text).toContain('log_session');
    expect((await call(client, 'log_session', { category: 'pilates', duration_min: 45, activity_id: 'act:run-10' })).text).toContain('activity_id must be');
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
    expect((await call(client, 'delete_item', { kind: 'workout', id: plan.workoutId })).data.deleted).toEqual({ kind: 'workout', id: plan.workoutId });
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
    expect((await call(bo, 'delete_item', { kind: 'workout', id: plan.workoutId })).isError).toBe(true);
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

describe('cardio blocks and notes', () => {
  const RUN = 'act:run-10';
  const CHEST = 'ex:Barbell_Bench_Press_-_Medium_Grip';

  it('runs a warm-up and a finisher as steps of a strength workout, and counts them as cardio minutes, not as a workout', async () => {
    await call(client, 'update_profile', { weight_kg: 80 });
    const plan = await start({ name: 'Push', exercises: [{ id: CHEST, sets: 1, reps: 8, weight_kg: 60 }], cardio: [{ activity_id: RUN, minutes: 10, when: 'before' }, { activity_id: 'act:row-machine', minutes: 15, when: 'after', distance_km: 3 }] });
    expect(plan.cardio.map((c) => [c.id, c.when, c.plannedMin, c.done])).toEqual([['c1', 'before', 10, false], ['c2', 'after', 15, false]]);
    await call(client, 'log_cardio_block', { workoutId: plan.workoutId, blockId: 'c1', minutes: 12 });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's1.1', reps: 8, weightKg: 60 });
    await call(client, 'log_cardio_block', { workoutId: plan.workoutId, blockId: 'c2', skip: true });

    // A reload picks up where it left off.
    const again = (await call(client, 'get_workout', { workoutId: plan.workoutId })).data.workout as WorkoutPlan;
    expect(again.cardio).toMatchObject([{ id: 'c1', done: true, minutes: 12 }, { id: 'c2', done: false, skipped: true }]);

    const summary = (await call(client, 'finish_workout', { workoutId: plan.workoutId })).data as { cardio?: { activity: string; minutes: number; when: string; kcal?: number }[] };
    expect(summary.cardio).toHaveLength(1);
    expect(summary.cardio![0]).toMatchObject({ minutes: 12, when: 'before' });
    expect(summary.cardio![0]!.kcal).toBeGreaterThan(50);

    const p = (await call(client, 'get_progress', { days: 30 })).data as { training: { sessions: { strength: number; cardio: number } } };
    expect(p.training.sessions).toEqual({ strength: 1, cardio: 0, session: 0 }); // one workout, not two
    const dash = (await client.callTool({ name: 'show_dashboard', arguments: { days: 30 } })).structuredContent as { progress: { training: { weeks: { cardioMin: number }[] } } };
    expect(dash.progress.training.weeks.reduce((n, w) => n + w.cardioMin, 0)).toBe(12);
    const history = (await call(client, 'get_workout_history', { days: 7 })).data.workouts as { cardio?: unknown[] }[];
    expect(history[0]!.cardio).toHaveLength(1);
  });

  it('keeps cardio and notes in templates', async () => {
    const saved = await call(client, 'save_workout_template', { name: 'Push day', exercises: [{ id: CHEST, sets: 3, reps: 8, notes: 'pause on the chest' }], cardio: [{ activity_id: RUN, minutes: 5, when: 'before' }] });
    expect(saved.isError, saved.text).toBe(false);
    const listed = (await call(client, 'list_workout_templates', {})).data.templates as { id: string; exercises: string[]; cardio: string[] }[];
    expect(listed[0]!.exercises[0]).toContain('(pause on the chest)');
    expect(listed[0]!.cardio).toEqual([expect.stringContaining('5 min')]);
    const plan = await start({ template_id: listed[0]!.id });
    expect(plan.exercises[0]!.notes).toBe('pause on the chest');
    expect(plan.cardio).toHaveLength(1);
    // Cardio given with a template replaces the template's.
    const swapped = await start({ template_id: listed[0]!.id, cardio: [{ activity_id: RUN, minutes: 20, when: 'after' }] });
    expect(swapped.cardio).toMatchObject([{ when: 'after', plannedMin: 20 }]);
  });

  it('saves a note per exercise from the player, shows it in the summary, and reminds of it next time', async () => {
    const plan = await start({ exercises: [{ id: CHEST, sets: 1, reps: 8, weight_kg: 60 }, { id: SQUAT, sets: 1, reps: 5, weight_kg: 80 }] });
    expect(plan.exercises.map((e) => e.uid)).toEqual(['e1', 'e2']);
    expect((await call(client, 'set_exercise_note', { workoutId: plan.workoutId, exerciseId: 'e1', notes: '  bench at slot 3  ' })).isError).toBe(false);
    expect((await call(client, 'set_exercise_note', { workoutId: plan.workoutId, exerciseId: 'e9', notes: 'x' })).isError).toBe(true);
    const mid = (await call(client, 'get_workout', { workoutId: plan.workoutId })).data.workout as WorkoutPlan;
    expect(mid.exercises[0]!.notes).toBe('bench at slot 3');
    const summary = await doWorkout(plan, () => 5);
    expect((summary.exercises as { name: string; notes?: string }[]).find((e) => e.notes)).toMatchObject({ notes: 'bench at slot 3' });

    const next = await start({ exercises: [{ id: CHEST, sets: 1, reps: 8 }] });
    expect(next.exercises[0]).toMatchObject({ lastNotes: 'bench at slot 3' });
    expect(next.exercises[0]!.notes).toBeUndefined();
    // Clearing a note removes it.
    await call(client, 'set_exercise_note', { workoutId: next.workoutId, exerciseId: 'e1', notes: 'new' });
    await call(client, 'set_exercise_note', { workoutId: next.workoutId, exerciseId: 'e1', notes: '' });
    expect(((await call(client, 'get_workout', { workoutId: next.workoutId })).data.workout as WorkoutPlan).exercises[0]!.notes).toBeUndefined();
  });

  it('logs a past workout with notes and a cardio finisher, and rejects unknown activities and other people\'s workouts', async () => {
    await call(client, 'update_profile', { weight_kg: 80 });
    const res = await call(client, 'log_past_workout', { day: '2026-10-12', exercises: [{ id: CHEST, sets: [{ reps: 8, weight_kg: 60 }], notes: 'felt strong' }], cardio: [{ activity_id: RUN, minutes: 10, when: 'after', distance_km: 1.8 }] });
    expect(res.isError, res.text).toBe(false);
    expect(res.data).toMatchObject({ exercises: [{ notes: 'felt strong' }], cardio: [{ minutes: 10, distanceKm: 1.8, when: 'after' }] });
    expect((await call(client, 'log_past_workout', { day: '2026-10-12', exercises: [{ id: CHEST, sets: [{ reps: 8 }] }], cardio: [{ activity_id: 'act:nope', minutes: 5 }] })).text).toContain('Unknown activity id');
    const plan = await start({ exercises: [{ id: CHEST, sets: 1, reps: 8 }], cardio: [{ activity_id: RUN, minutes: 5 }] });
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    expect((await call(bo, 'log_cardio_block', { workoutId: plan.workoutId, blockId: 'c1' })).isError).toBe(true);
    expect((await call(bo, 'set_exercise_note', { workoutId: plan.workoutId, exerciseId: 'e1', notes: 'x' })).isError).toBe(true);
  });

  it('stores an optional effort on working sets and shows it in the plan, history and finish summary', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 80, warmup: true }] });
    const warm = plan.exercises[0]!.sets.find((s) => s.warmup)!;
    const [first, second] = work(plan.exercises[0]!);
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: warm.id, reps: warm.targetReps, weightKg: warm.weightKg, effort: 4 }); // not for warm-ups
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: first!.id, reps: 5, weightKg: 80, effort: 2 });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: second!.id, reps: 5, weightKg: 80 }); // ignoring the tap logs nothing extra
    const stored = ((await call(client, 'get_workout', { workoutId: plan.workoutId })).data.workout as WorkoutPlan).exercises[0]!.sets;
    expect(stored.find((s) => s.id === warm.id)!.effort).toBeUndefined();
    expect(stored.find((s) => s.id === first!.id)!.effort).toBe(2);
    expect(stored.find((s) => s.id === second!.id)!.effort).toBeUndefined();

    // Re-logging the same set without an effort keeps it; edit_workout_set changes it; reopening or skipping drops it.
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: first!.id, reps: 6, weightKg: 80 });
    expect(((await call(client, 'get_workout', { workoutId: plan.workoutId })).data.workout as WorkoutPlan).exercises[0]!.sets.find((s) => s.id === first!.id)!.effort).toBe(2);
    expect((await call(client, 'edit_workout_set', { workout_id: plan.workoutId, exercise: 'squat', set: 2, effort: 3 })).isError).toBe(false);
    const finished = (await call(client, 'finish_workout', { workoutId: plan.workoutId })).data;
    expect((finished.exercises as { effort?: string }[])[0]!.effort).toBe('set 1 Solid, set 2 Hard');
    const history = (await call(client, 'get_workout_history', { days: 7 })).data.workouts as { exercises: { effort?: string }[] }[];
    expect(history[0]!.exercises[0]!.effort).toBe('set 1 Solid, set 2 Hard');
    const byExercise = (await call(client, 'get_workout_history', { days: 7, exercise_id: SQUAT })).data.sessions as { effort?: string }[];
    expect(byExercise[0]!.effort).toBe('set 1 Solid, set 2 Hard');

    await call(client, 'log_set', { workoutId: plan.workoutId, setId: first!.id, reps: 0, reopen: true });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: second!.id, reps: 0, skip: true });
    const reopened = ((await call(client, 'get_workout', { workoutId: plan.workoutId })).data.workout as WorkoutPlan).exercises[0]!.sets;
    expect(reopened.filter((s) => s.effort !== undefined)).toEqual([]);
  });

  it('refuses an effort outside 1–4, an effort on a warm-up edit, and an edit with nothing to change', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 1, reps: 5, weight_kg: 80, warmup: true }] });
    const setId = work(plan.exercises[0]!)[0]!.id;
    expect((await call(client, 'log_set', { workoutId: plan.workoutId, setId, reps: 5, weightKg: 80, effort: 5 })).isError).toBe(true);
    expect((await call(client, 'log_set', { workoutId: plan.workoutId, setId, reps: 5, weightKg: 80, effort: 0 })).isError).toBe(true);
    await call(client, 'log_set', { workoutId: plan.workoutId, setId, reps: 5, weightKg: 80 });
    expect((await call(client, 'edit_workout_set', { workout_id: plan.workoutId, exercise: 'squat', set: 1, effort: 7 })).isError).toBe(true);
    expect((await call(client, 'edit_workout_set', { workout_id: plan.workoutId, exercise: 'squat', set: 1, warmup: true, effort: 2 })).isError).toBe(true);
    expect((await call(client, 'edit_workout_set', { workout_id: plan.workoutId, exercise: 'squat', set: 1 })).isError).toBe(true);
  });

  it('export_my_data carries the effort of each set', async () => {
    const plan = await start({ exercises: [{ id: SQUAT, sets: 1, reps: 5, weight_kg: 80, warmup: false }] });
    await call(client, 'log_set', { workoutId: plan.workoutId, setId: 's1.1', reps: 5, weightKg: 80, effort: 4 });
    const { text } = await call(client, 'export_my_data', {});
    expect(text).toContain('"effort":4');
  });

  describe('stored rest', () => {
    const restOf = async (id: string) => ((await call(client, 'get_workout', { workoutId: id })).data.workout as WorkoutPlan).rest;
    const started = async () => {
      const plan = await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 80, warmup: false }] });
      return { id: plan.workoutId, uid: plan.exercises[0]!.uid };
    };
    afterEach(() => vi.useRealTimers());

    it('log_set with restSec stores it and returns the time left by the server clock; get_workout resumes it', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
      const { id, uid } = await started();
      expect(await restOf(id)).toBeUndefined();
      const logged = await call(client, 'log_set', { workoutId: id, setId: 's1.1', reps: 5, weightKg: 80, restSec: 90 });
      expect(logged.data.restRemainingMs).toBe(90_000);
      vi.setSystemTime(1_030_000);
      expect(await restOf(id)).toEqual({ exerciseUid: uid, remainingMs: 60_000, totalMs: 90_000 });
    });

    it('an expired rest is not reported, except for 3 s after it ended (negative time left)', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
      const { id } = await started();
      await call(client, 'log_set', { workoutId: id, setId: 's1.1', reps: 5, weightKg: 80, restSec: 60 });
      vi.setSystemTime(1_061_000);
      expect((await restOf(id))?.remainingMs).toBe(-1000);
      vi.setSystemTime(1_063_500);
      expect(await restOf(id)).toBeUndefined();
    });

    it('a new rest replaces the running one; a log without restSec keeps it; restSec 0, reopen, set_rest 0 and finishing clear it', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
      const { id } = await started();
      await call(client, 'log_set', { workoutId: id, setId: 's1.1', reps: 5, weightKg: 80, restSec: 90 });
      vi.setSystemTime(1_010_000);
      await call(client, 'log_set', { workoutId: id, setId: 's1.2', reps: 5, weightKg: 80, restSec: 120 });
      expect(await restOf(id)).toMatchObject({ remainingMs: 120_000, totalMs: 120_000 });
      await call(client, 'log_set', { workoutId: id, setId: 's1.1', reps: 6, weightKg: 80 }); // an edit of a row
      expect((await restOf(id))?.remainingMs).toBe(120_000);

      const shorter = await call(client, 'set_rest', { workoutId: id, restSec: 30, totalSec: 120 });
      expect(shorter.data).toMatchObject({ saved: true, restRemainingMs: 30_000 });
      expect(await restOf(id)).toMatchObject({ remainingMs: 30_000, totalMs: 120_000 });
      await call(client, 'set_rest', { workoutId: id, restSec: 0 });
      expect(await restOf(id)).toBeUndefined();
      expect((await call(client, 'set_rest', { workoutId: id, restSec: 20 })).data.saved).toBe(false); // never starts one

      await call(client, 'log_set', { workoutId: id, setId: 's1.3', reps: 5, weightKg: 80, restSec: 90 });
      await call(client, 'log_set', { workoutId: id, setId: 's1.3', reps: 0, reopen: true });
      expect(await restOf(id)).toBeUndefined();
      await call(client, 'log_set', { workoutId: id, setId: 's1.3', reps: 5, weightKg: 80, restSec: 90 });
      await call(client, 'log_set', { workoutId: id, setId: 's1.3', reps: 5, weightKg: 80, restSec: 0 });
      expect(await restOf(id)).toBeUndefined();
      await call(client, 'log_set', { workoutId: id, setId: 's1.2', reps: 5, weightKg: 80, restSec: 90 });
      await call(client, 'finish_workout', { workoutId: id });
      expect(await restOf(id)).toBeUndefined();
    });
  });

  describe('bests for the record cue', () => {
    const log = (id: string, setId: string, reps: number, weightKg?: number) => call(client, 'log_set', { workoutId: id, setId, reps, ...(weightKg !== undefined ? { weightKg } : {}) });
    const first = async () => {
      const a = await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 100, warmup: false }] });
      await log(a.workoutId, 's1.1', 5, 100);
      await log(a.workoutId, 's1.2', 5, 100);
      await log(a.workoutId, 's1.3', 3, 105);
      await call(client, 'finish_workout', { workoutId: a.workoutId });
    };

    it('start_workout and get_workout send what earlier sessions did, and none for a first session', async () => {
      const none = await start({ exercises: [{ id: SQUAT, sets: 1, reps: 5, weight_kg: 100, warmup: false }] });
      expect(none.exercises[0]!.bests).toBeUndefined();
      await first();
      const next = await start({ exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 100, warmup: false }] });
      const bests = next.exercises[0]!.bests!;
      expect(bests.byReps).toEqual([[3, 105], [5, 100]]);
      expect(bests.atWeight).toEqual([[105, 3], [100, 5]]);
      expect(bests.e1rm).toBeCloseTo(100 * (1 + 5 / 30), 6);
      expect(((await call(client, 'get_workout', { workoutId: next.workoutId })).data.workout as WorkoutPlan).exercises[0]!.bests).toEqual(bests);
    });

    it('is the same basis as the finish summary: its e1rm is the "was" of a new best, and a tie is no record', async () => {
      await first();
      const b = await start({ exercises: [{ id: SQUAT, sets: 2, reps: 5, weight_kg: 100, warmup: false }] });
      const best = b.exercises[0]!.bests!.e1rm;
      await log(b.workoutId, 's1.1', 3, 105); // a tie
      await log(b.workoutId, 's1.2', 6, 105); // beats it
      const summary = (await call(client, 'finish_workout', { workoutId: b.workoutId })).data.exercises as { personalRecord?: string }[];
      expect(summary[0]!.personalRecord).toContain(`(was ${Math.round(best * 10) / 10} kg)`);
    });

    it('leaves out bodyweight and timed exercises, and keeps each list within the cap', async () => {
      const a = await start({ exercises: [{ id: SQUAT, sets: 10, reps: 5, weight_kg: 60, warmup: false }, { id: PULLUP, sets: 1, reps: 8 }] });
      for (let k = 0; k < 10; k++) await log(a.workoutId, `s1.${k + 1}`, k + 1, 60 + 5 * k);
      await log(a.workoutId, 's2.1', 8);
      await call(client, 'finish_workout', { workoutId: a.workoutId });
      const b = await start({ exercises: [{ id: SQUAT, sets: 1, reps: 5, weight_kg: 60, warmup: false }, { id: PULLUP, sets: 1, reps: 8 }] });
      expect(b.exercises[0]!.bests!.byReps.length).toBeLessThanOrEqual(12);
      expect(b.exercises[0]!.bests!.atWeight.length).toBeLessThanOrEqual(12);
      expect(b.exercises[1]!.bests).toBeUndefined();
    });
  });
});
