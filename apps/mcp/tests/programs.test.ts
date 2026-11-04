// Programs (A4): a block of weeks over saved workouts, "Week 3, Day B", and a deload week planned lighter that the next weights do not build on.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteUser, type User } from '../src/data/users';
import type { WorkoutPlan } from '../src/workout/plan';
import { applyDeload, deloadWeeksFor, positionAfter } from '../src/workout/program';
import type { StoredExercise } from '../src/data/workoutData';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip';
const SQUAT = 'ex:Barbell_Squat';

describe('the pure rules', () => {
  const shape = { weeks: 4, deloadWeeks: [4], days: [{ label: 'A', templateId: 't1' }, { label: 'B', templateId: 't2' }] };
  it('finds the deload weeks of a block and the position after finished sessions', () => {
    expect(deloadWeeksFor(8, 4)).toEqual([4, 8]);
    expect(deloadWeeksFor(6, 4)).toEqual([4]);
    expect(deloadWeeksFor(6, undefined)).toEqual([]);
    expect(positionAfter(shape, 0)).toMatchObject({ week: 1, label: 'Week 1, Day A', deload: false, done: false, total: 8 });
    expect(positionAfter(shape, 3)).toMatchObject({ week: 2, label: 'Week 2, Day B' });
    expect(positionAfter(shape, 6)).toMatchObject({ week: 4, label: 'Week 4, Day A (deload week)', deload: true });
    expect(positionAfter(shape, 8)).toMatchObject({ done: true });
  });

  it('a deload keeps about 60 % of the working sets and 90 % of the weight, only sets for bodyweight and timed work', () => {
    const set = (id: string, type: 'working' | 'warmup', kg: number) => ({ id, type, reps: 5, targetReps: 5, weightKg: kg, done: false });
    const bench = { exerciseRef: BENCH, exerciseName: 'Bench', uid: 'u1', sets: [set('w1', 'warmup', 40), ...['a', 'b', 'c', 'd', 'e'].map((id) => set(id, 'working', 100))] } as unknown as StoredExercise;
    const dips = { exerciseRef: 'ex:Dips', exerciseName: 'Dips', uid: 'u2', load: 'bodyweight', sets: ['a', 'b'].map((id) => set(id, 'working', 80)) } as unknown as StoredExercise;
    const [b, d] = applyDeload([bench, dips]);
    expect(b!.sets.filter((s) => s.type === 'working')).toHaveLength(3); // ceil(5 x 0.6)
    expect(b!.sets.find((s) => s.type === 'working')!.weightKg).toBe(90);
    expect(b!.sets.find((s) => s.type === 'warmup')!.weightKg).toBe(35); // 40 x 0.9 = 36, to the nearest 5
    expect(b!.note).toMatch(/Deload week/);
    expect(d!.sets).toHaveLength(2); // ceil(2 x 0.6) = 2
    expect(d!.sets[0]!.weightKg).toBe(80); // body weight is not scaled
    expect(applyDeload([{ ...bench, sets: [set('x', 'working', 20)] } as unknown as StoredExercise])[0]!.sets).toHaveLength(1); // never below one set
  });
});

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
  await call(client, 'save_workout_template', { name: 'Push day', exercises: [{ id: BENCH, sets: 4, reps: 5, weight_kg: 80 }] });
  await call(client, 'save_workout_template', { name: 'Leg day', exercises: [{ id: SQUAT, sets: 4, reps: 5, weight_kg: 100 }] });
});

const create = (extra: Record<string, unknown> = {}) => call(client, 'create_program', { name: 'Block 1', weeks: 4, days: [{ template_name: 'Push day' }, { template_name: 'Leg day', label: 'Legs' }], deload_every: 4, ...extra });
const next = async () => ((await call(client, 'get_program')).data as unknown as { next: { label: string; deload: boolean } | string }).next;
const startProgram = async () => (await call(client, 'start_workout', { program: true }));
/** Finishes a started workout: every set done at its plan, then finish_workout. */
async function finish(r: Awaited<ReturnType<typeof call>>) {
  const plan = (r.data as unknown as { workout: WorkoutPlan }).workout;
  await env.DB.prepare('UPDATE workouts SET finished_at = ? WHERE id = ?').bind(Date.now(), plan.workoutId).run();
  return plan;
}

describe('creating and following a program', () => {
  it('names the next session, starts it, and moves on after a finished one', async () => {
    expect((await create()).isError).toBe(false);
    expect(await next()).toMatchObject({ label: 'Week 1, Day A', deload: false });
    const r = await startProgram();
    expect(r.text).toContain('Week 1, Day A');
    const plan = await finish(r);
    expect(plan.exercises[0]!.id).toBe(BENCH);
    expect(plan.name).toBe('Block 1: Week 1, Day A');
    expect(await next()).toMatchObject({ label: 'Week 1, Day Legs' });
    const legs = await finish(await startProgram());
    expect(legs.exercises[0]!.id).toBe(SQUAT);
    expect(await next()).toMatchObject({ label: 'Week 2, Day A' });
  });

  it('starting again before finishing repeats the same session rather than skipping it', async () => {
    await create();
    await startProgram();
    expect((await startProgram()).text).toContain('Week 1, Day A');
    expect(await next()).toMatchObject({ label: 'Week 1, Day A' });
  });

  it('plans the deload week lighter, tells so, and the next weights do not build on it', async () => {
    await create({ weeks: 2, deload_every: 2 });
    await finish(await startProgram()); // W1 A
    await finish(await startProgram()); // W1 Legs
    const normalBench = (await finish(await startProgram())) ; // W2 A: the deload week
    expect(normalBench.exercises[0]!.sets.filter((s) => !s.warmup)).toHaveLength(3); // 4 sets -> 3
    expect(normalBench.exercises[0]!.sets.find((s) => !s.warmup)!.weightKg).toBe(72.5); // 80 x 0.9 = 72, to 2.5
    expect(normalBench.exercises[0]!.note).toMatch(/Deload week/);
    const out = await call(client, 'get_workout_history', { limit: 5 });
    expect(out.isError).toBe(false);
    // A plain workout of the same lift afterwards is not built on the lighter deload session: its "last time" is the normal one.
    const after = (await call(client, 'start_workout', { exercises: [{ id: BENCH, sets: 3, reps: 5 }] })).data as unknown as { workout: WorkoutPlan };
    expect(after.workout.exercises[0]!.lastTime ?? '').not.toMatch(/72\.5/);
  });

  it('finishes the block and says so, and creating another one ends the first', async () => {
    await create({ weeks: 2, deload_every: undefined });
    for (let i = 0; i < 4; i++) await finish(await startProgram());
    expect(await next()).toBe('The program is finished.');
    expect((await startProgram()).text).toContain('finished');
    await create({ name: 'Block 2' });
    expect(await next()).toMatchObject({ label: 'Week 1, Day A' });
    expect(((await call(client, 'get_program')).data as unknown as { program: { name: string } }).program.name).toBe('Block 2');
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM programs WHERE status = 'active'").first<{ n: number }>())!.n).toBe(1);
  });
});

describe('refusals and privacy', () => {
  it('needs saved workouts, an active program, and no mix with template_id or exercises', async () => {
    expect((await create({ days: [{ template_name: 'Nope' }] })).isError).toBe(true);
    expect((await startProgram()).text).toContain('no active program');
    await create();
    expect((await call(client, 'start_workout', { program: true, exercises: [{ id: BENCH, sets: 3, reps: 5 }] })).isError).toBe(true);
    expect((await create({ weeks: 1 })).isError).toBe(true);
  });

  it('says so when a saved workout of the program was deleted', async () => {
    await create();
    const t = ((await call(client, 'list_workout_templates')).data as unknown as { templates: { id: string; name: string }[] }).templates.find((x) => x.name === 'Push day')!;
    await call(client, 'delete_item', { kind: 'workout_template', id: t.id });
    expect((await startProgram()).text).toContain('no longer exists');
  });

  it('is one person\'s own: nobody else sees or advances it, it is in the export, ends on request and goes with the account', async () => {
    await create();
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));
    expect(((await call(bo, 'get_program')).data as unknown as { program: unknown }).program).toBeNull();
    expect((await call(bo, 'end_program')).isError).toBe(true);
    expect(((await call(client, 'export_my_data')).data as unknown as { programs: { name: string }[] }).programs).toMatchObject([{ name: 'Block 1' }]);
    expect((await call(client, 'end_program')).isError).toBe(false);
    expect(((await call(client, 'get_program')).data as unknown as { program: unknown }).program).toBeNull();
    await create();
    await deleteUser(env.DB, ana);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM programs').first<{ n: number }>())!.n).toBe(0);
  });

  it('carries the right hints', async () => {
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === 'get_program')?.annotations).toMatchObject({ readOnlyHint: true });
    for (const n of ['create_program', 'end_program']) expect(tools.find((t) => t.name === n)?.annotations, n).toMatchObject({ destructiveHint: true });
  });
});
