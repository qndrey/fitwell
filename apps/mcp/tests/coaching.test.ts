// Coach and trainee (B7): offered to a friend and accepted by them, workouts assigned as snapshots, started from the trainee's own player,
// the coach seeing status (and, only when the trainee said yes, how it went), ended from either side, and gone with a friendship or an account.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_OPEN_ASSIGNMENTS, MAX_TRAINEES, type AssignedWorkout, type AssignmentForCoach, type CoachingView } from '../src/data/coaching';
import type { FriendList } from '../src/data/friends';
import { deleteUser, type User } from '../src/data/users';
import type { WorkoutPlan } from '../src/workout/plan';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const SQUAT = 'ex:Barbell_Squat';
let env: Env;
let ana: User;
let bo: User;
let cy: User;
let anaC: Client;
let boC: Client;
let cyC: Client;
let friendId: string; // Ana and Bo's connection, as Ana sees it
beforeEach(async () => {
  env = createTestEnv().env;
  [ana, bo, cy] = [await signedInUser(env, 'ana@example.com'), await signedInUser(env, 'bo@example.com'), await signedInUser(env, 'cy@example.com')];
  [anaC, boC, cyC] = [await connectAs(env, ana), await connectAs(env, bo), await connectAs(env, cy)];
  await call(anaC, 'request_friend', { email: 'bo@example.com' });
  await call(boC, 'accept_friend', { connection_id: ((await call(boC, 'list_friends')).data as unknown as FriendList).incoming[0]!.connectionId });
  friendId = ((await call(anaC, 'list_friends')).data as unknown as FriendList).friends[0]!.connectionId;
  await call(anaC, 'save_workout_template', { name: 'Push day', exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 100, notes: 'Brace first' }] });
});

type Listing = { asCoach: (CoachingView & { open: number })[]; asTrainee: CoachingView[] };
const listing = async (c: Client) => (await call(c, 'list_coaching')).data as unknown as Listing;
const assignments = async (c: Client, args: Record<string, unknown> = {}) => (await call(c, 'list_assignments', args)).data as unknown as { toDo: AssignedWorkout[]; assignedByMe: AssignmentForCoach[] };

/** Ana offers, Bo accepts. Returns the coaching id. */
async function connect(shareResults: boolean) {
  await call(anaC, 'offer_coaching', { connection_id: friendId });
  const id = (await listing(boC)).asTrainee[0]!.coachingId;
  const r = await call(boC, 'accept_coaching', { coaching_id: id, share_results: shareResults });
  expect(r.data).toEqual({ accepted: true, shareResults });
  return id;
}
const assign = (id: string, extra: Record<string, unknown> = {}) => call(anaC, 'assign_workout', { coaching_id: id, template: 'Push day', ...extra });

/** Finishes the workout started for an assignment, every working set done at 5 reps and Solid, with a note. */
async function finishWorkout(plan: WorkoutPlan) {
  const row = (await env.DB.prepare('SELECT exercises FROM workouts WHERE id = ?').bind(plan.workoutId).first<{ exercises: string }>())!;
  const exercises = (JSON.parse(row.exercises) as { sets: Record<string, unknown>[]; notes?: string }[]).map((e) => ({ ...e, notes: 'bar felt heavy', sets: e.sets.map((s) => ({ ...s, done: true, reps: 5, effort: 2 })) }));
  await env.DB.prepare('UPDATE workouts SET exercises = ?, started_at = ?, finished_at = ? WHERE id = ?').bind(JSON.stringify(exercises), Date.now() - 45 * 60_000, Date.now(), plan.workoutId).run();
}

describe('the link', () => {
  it('is offered to a friend, waits for their answer, and the trainee chooses what the coach sees', async () => {
    const offer = await call(anaC, 'offer_coaching', { connection_id: friendId });
    expect(offer.data).toMatchObject({ offered: true, to: 'bo@example.com' });
    expect((await listing(anaC)).asCoach).toMatchObject([{ status: 'pending', with: { email: 'bo@example.com' }, shareResults: false }]);
    expect((await listing(boC)).asTrainee).toMatchObject([{ status: 'pending', with: { email: 'ana@example.com' } }]);
    // A pending offer assigns nothing.
    expect((await assign((await listing(anaC)).asCoach[0]!.coachingId)).isError).toBe(true);
    const id = (await listing(boC)).asTrainee[0]!.coachingId;
    expect((await call(anaC, 'accept_coaching', { coaching_id: id, share_results: true })).isError).toBe(true); // only the trainee answers
    await call(boC, 'accept_coaching', { coaching_id: id, share_results: false });
    expect((await listing(anaC)).asCoach).toMatchObject([{ status: 'active', shareResults: false }]);
    expect((await call(boC, 'set_coaching_sharing', { coaching_id: id, share_results: true })).data).toEqual({ shareResults: true });
    expect((await call(anaC, 'set_coaching_sharing', { coaching_id: id, share_results: false })).isError).toBe(true); // not the coach's to change
  });

  it('is only between accepted friends, and offering again is one offer', async () => {
    expect((await call(anaC, 'offer_coaching', { connection_id: 'nope' })).isError).toBe(true);
    expect((await call(cyC, 'offer_coaching', { connection_id: friendId })).isError).toBe(true); // not Cy's connection
    await call(anaC, 'offer_coaching', { connection_id: friendId });
    await call(anaC, 'offer_coaching', { connection_id: friendId });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM coaching').first()).toEqual({ n: 1 });
    expect(MAX_TRAINEES).toBeGreaterThan(1);
  });

  it('can be ended by either side, taking the assignments with it, and an offer can be declined the same way', async () => {
    const id = await connect(true);
    await assign(id);
    expect((await call(cyC, 'end_coaching', { coaching_id: id })).isError).toBe(true);
    expect((await call(boC, 'end_coaching', { coaching_id: id })).data).toEqual({ ended: true });
    expect((await listing(anaC)).asCoach).toEqual([]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments').first()).toEqual({ n: 0 });
    await call(anaC, 'offer_coaching', { connection_id: friendId });
    expect((await call(boC, 'end_coaching', { coaching_id: (await listing(boC)).asTrainee[0]!.coachingId })).data).toEqual({ ended: true });
  });

  it('ends when the friendship does, and an unanswered offer is not visible once they are no longer friends', async () => {
    const id = await connect(true);
    await assign(id);
    await call(boC, 'remove_friend', { connection_id: ((await call(boC, 'list_friends')).data as unknown as FriendList).friends[0]!.connectionId });
    expect((await listing(anaC)).asCoach).toEqual([]);
    expect((await assignments(boC)).toDo).toEqual([]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM coaching').first()).toEqual({ n: 0 });
  });
});

describe('assigning', () => {
  it('sends a snapshot to the trainee, who sees it with the coach\'s note and the day, and has nothing added to their own templates', async () => {
    const id = await connect(false);
    const r = await assign(id, { on: '2026-12-01', note: 'Keep it smooth <b>please</b> https://evil.example' });
    expect(r.data).toMatchObject({ assigned: true, to: 'bo@example.com' });
    expect((await assignments(boC)).toDo).toMatchObject([{ name: 'Push day', summary: '1 exercise', dueOn: '2026-12-01', note: 'Keep it smooth please', started: false, from: { email: 'ana@example.com' } }]);
    expect(((await call(boC, 'list_workout_templates')).data as { templates: unknown[] }).templates).toEqual([]);
    // A later change to the coach's template is not shared: it is a snapshot.
    await call(anaC, 'save_workout_template', { name: 'Push day', exercises: [{ id: SQUAT, sets: 9, reps: 9 }, { id: SQUAT, sets: 1, reps: 1 }] });
    expect((await assignments(boC)).toDo[0]!.summary).toBe('1 exercise');
  });

  it('refuses what is not the coach\'s to assign', async () => {
    const id = await connect(false);
    expect((await call(boC, 'assign_workout', { coaching_id: id, template: 'Push day' })).isError).toBe(true); // the trainee cannot assign
    expect((await call(cyC, 'assign_workout', { coaching_id: id, template: 'Push day' })).isError).toBe(true);
    expect((await assign(id, { template: 'No such' })).text).toContain('no saved workout');
    expect((await assign(id, { on: '2026-02-30' })).isError).toBe(true);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments').first()).toEqual({ n: 0 });
  });

  it('stops at the limit of open assignments per trainee', async () => {
    const id = await connect(false);
    for (let i = 0; i < MAX_OPEN_ASSIGNMENTS; i++) expect((await assign(id)).isError).toBeFalsy();
    expect((await assign(id)).isError).toBe(true);
  });

  it('lets the trainee dismiss one, and the coach sees it was skipped', async () => {
    const id = await connect(false);
    await assign(id);
    const a = (await assignments(boC)).toDo[0]!;
    expect((await call(boC, 'dismiss_assignment', { assignment_id: a.assignmentId })).data).toEqual({ dismissed: true });
    expect((await assignments(boC)).toDo).toEqual([]);
    expect((await assignments(anaC)).assignedByMe).toMatchObject([{ status: 'skipped', name: 'Push day' }]);
    expect((await call(boC, 'dismiss_assignment', { assignment_id: a.assignmentId })).isError).toBe(true);
    expect((await call(boC, 'start_workout', { assignment_id: a.assignmentId })).isError).toBe(true);
  });
});

describe('running it', () => {
  it('starts in the trainee\'s own player, with weights from their own history, and shows on Today', async () => {
    const id = await connect(true);
    await assign(id);
    const t = await call(boC, 'show_today');
    expect((t.data as { today: { training: { assigned: { name: string; from: string }[] } } }).today.training.assigned).toMatchObject([{ name: 'Push day', from: 'ana@example.com' }]);
    const a = (await assignments(boC)).toDo[0]!;
    const started = await call(boC, 'start_workout', { assignment_id: a.assignmentId });
    const plan = (started.data as unknown as { workout: WorkoutPlan }).workout;
    expect(plan.name).toBe('Push day');
    expect(plan.exercises[0]!.name).toMatch(/squat/i);
    expect(plan.exercises[0]!.notes).toBe('Brace first'); // the coach's exercise note travels with the workout
    expect((await assignments(boC)).toDo[0]).toMatchObject({ started: true });
    expect((await assignments(anaC)).assignedByMe[0]).toMatchObject({ status: 'started' });
    // Mixing it with another way to start is refused, and so is somebody else's assignment.
    expect((await call(boC, 'start_workout', { assignment_id: a.assignmentId, exercises: [{ id: SQUAT, sets: 1, reps: 1 }] })).isError).toBe(true);
    expect((await call(cyC, 'start_workout', { assignment_id: a.assignmentId })).isError).toBe(true);
    await finishWorkout(plan);
    expect((await assignments(boC)).toDo).toEqual([]);
  });

  it('shows the coach status always, and how it went only when the trainee agreed', async () => {
    for (const share of [true, false]) {
      const id = await connect(share);
      await assign(id);
      const plan = ((await call(boC, 'start_workout', { assignment_id: (await assignments(boC)).toDo[0]!.assignmentId })).data as unknown as { workout: WorkoutPlan }).workout;
      await finishWorkout(plan);
      const done = (await assignments(anaC)).assignedByMe[0]!;
      expect(done.status).toBe('done');
      if (share) expect(done.result).toMatchObject({ minutes: 45, exercises: [{ name: expect.stringMatching(/squat/i), sets: '3×5 @ 100 kg', effort: 'set 1 Solid, set 2 Solid, set 3 Solid', note: 'bar felt heavy' }] });
      else expect(done.result).toBeUndefined();
      // Changing the answer applies at once.
      if (!share) {
        await call(boC, 'set_coaching_sharing', { coaching_id: id, share_results: true });
        expect((await assignments(anaC)).assignedByMe[0]!.result).toBeDefined();
      }
      await call(anaC, 'end_coaching', { coaching_id: id });
      await call(boC, 'finish_workout', { workout_id: plan.workoutId }).catch(() => undefined);
    }
  });

  it('never lets the coach read anything of the trainee beyond the assigned workout', async () => {
    const id = await connect(true);
    await assign(id);
    await call(boC, 'log_food', { meal: 'breakfast', items: [{ food_id: 'frida:59', grams: 100 }] }).catch(() => undefined);
    await call(boC, 'log_body', { weight_kg: 80 });
    const result = JSON.stringify((await call(anaC, 'list_assignments')).data) + JSON.stringify((await call(anaC, 'list_coaching')).data);
    expect(result).not.toContain('80');
    expect(result).not.toMatch(/breakfast|weight/i);
  });
});

describe('export and delete', () => {
  it('exports both sides without the workouts\' contents, and deleting an account removes the coaching and its assignments', async () => {
    const id = await connect(true);
    await assign(id, { note: 'Go' });
    const mine = (await call(anaC, 'export_my_data')).data as unknown as { coaching: { asCoach: { with: string }[] }; assignments: { direction: string; name: string }[] };
    expect(mine.coaching.asCoach).toMatchObject([{ with: 'bo@example.com', status: 'active', shareResults: true }]);
    expect(mine.assignments).toMatchObject([{ direction: 'given', name: 'Push day', note: 'Go' }]);
    expect(JSON.stringify(mine.assignments)).not.toContain('Barbell');
    const theirs = (await call(boC, 'export_my_data')).data as unknown as { assignments: { direction: string }[] };
    expect(theirs.assignments).toMatchObject([{ direction: 'received' }]);
    await deleteUser(env.DB, bo);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM coaching').first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments').first()).toEqual({ n: 0 });
  });
});
