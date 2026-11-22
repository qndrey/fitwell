// Coaching, part three (B7): a whole program assigned and accepted, the coach roster, the coach's note in the player, and the reminder email.
import type { Client } from '@modelcontextprotocol/client';
import { addDays } from '@fitwell/core/domain/dates';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CoachRoster } from '../src/analytics/coachTypes';
import type { Mail, Mailer } from '../src/auth/mailer';
import type { AssignedProgram, ProgramForCoach } from '../src/data/coaching';
import type { FriendList } from '../src/data/friends';
import { deleteUser, type User } from '../src/data/users';
import { runDigests } from '../src/digests/run';
import { handleUnsubscribe } from '../src/digests/unsubscribe';
import coachHtml from '../src/ui/generated/coach';
import workoutHtml from '../src/ui/generated/workout';
import type { WorkoutPlan } from '../src/workout/plan';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView } from './support/viewHost';

const SQUAT = 'ex:Barbell_Squat';
const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip';
let env: Env;
let ana: User;
let bo: User;
let cy: User;
let anaC: Client;
let boC: Client;
let cyC: Client;
let coachingId: string; // Ana coaches Bo

async function befriend(a: Client, b: Client, bEmail: string) {
  await call(a, 'request_friend', { email: bEmail });
  await call(b, 'accept_friend', { connection_id: ((await call(b, 'list_friends')).data as unknown as FriendList).incoming[0]!.connectionId });
  return ((await call(a, 'list_friends')).data as unknown as FriendList).friends.find((f) => f.email === bEmail)!.connectionId;
}
async function coach(c: Client, trainee: Client, connection: string, extra: Record<string, unknown> = {}) {
  await call(c, 'offer_coaching', { connection_id: connection });
  const id = ((await call(trainee, 'list_coaching')).data as unknown as { asTrainee: { coachingId: string }[] }).asTrainee.at(-1)!.coachingId;
  await call(trainee, 'accept_coaching', { coaching_id: id, share_results: false, ...extra });
  return id;
}
beforeEach(async () => {
  env = createTestEnv().env;
  [ana, bo, cy] = [await signedInUser(env, 'ana@example.com'), await signedInUser(env, 'bo@example.com'), await signedInUser(env, 'cy@example.com')];
  [anaC, boC, cyC] = [await connectAs(env, ana), await connectAs(env, bo), await connectAs(env, cy)];
  coachingId = await coach(anaC, boC, await befriend(anaC, boC, 'bo@example.com'));
  await call(anaC, 'save_workout_template', { name: 'Push day', exercises: [{ id: BENCH, sets: 3, reps: 5, weight_kg: 60, notes: 'Pause on the chest' }] });
  await call(anaC, 'save_workout_template', { name: 'Leg day', exercises: [{ id: SQUAT, sets: 3, reps: 5, weight_kg: 100 }] });
});

const makeProgram = () => call(anaC, 'create_program', { name: 'Block 1', weeks: 4, days: [{ template_name: 'Push day' }, { template_name: 'Leg day', label: 'Legs' }], deload_every: 4 });
const lists = async (c: Client, args: Record<string, unknown> = {}) => (await call(c, 'list_assignments', args)).data as unknown as { programs: AssignedProgram[]; programsByMe: ProgramForCoach[]; toDo: { assignmentId: string; name: string }[] };
async function finish(plan: WorkoutPlan) {
  await env.DB.prepare('UPDATE workouts SET finished_at = ? WHERE id = ?').bind(Date.now(), plan.workoutId).run();
}

describe('a whole program', () => {
  it('is assigned as a snapshot that waits, accepted into the trainee\'s own workouts and program, and followed by the coach', async () => {
    await makeProgram();
    const r = await call(anaC, 'assign_program', { coaching_id: coachingId, note: 'Eight weeks, <b>go</b>' });
    expect(r.data).toMatchObject({ assigned: true, to: 'bo@example.com' });
    // Waiting: nothing of Bo's changes yet.
    expect((await lists(boC)).programs).toMatchObject([{ name: 'Block 1', weeks: 4, deloadWeeks: [4], note: 'Eight weeks, go', from: { email: 'ana@example.com' }, days: [{ label: 'A', workout: 'Push day', exercises: 1 }, { label: 'Legs', workout: 'Leg day', exercises: 1 }] }]);
    expect(((await call(boC, 'list_workout_templates')).data as { templates: unknown[] }).templates).toEqual([]);
    expect((await call(boC, 'get_program')).text).not.toContain('Block 1');
    expect((await lists(anaC)).programsByMe).toMatchObject([{ name: 'Block 1', status: 'waiting', sessionsDone: null, sessionsTotal: 8 }]);
    // Accepted: workouts saved as Bo's own, the program running.
    const id = (await lists(boC)).programs[0]!.assignmentId;
    expect((await call(cyC, 'accept_assigned_program', { assignment_id: id })).isError).toBe(true);
    expect((await call(anaC, 'accept_assigned_program', { assignment_id: id })).isError).toBe(true); // the coach cannot accept for them
    expect((await call(boC, 'accept_assigned_program', { assignment_id: id })).data).toMatchObject({ accepted: true, program: 'Block 1', weeks: 4, savedWorkouts: ['Push day', 'Leg day'] });
    expect(((await call(boC, 'list_workout_templates')).data as { templates: { name: string }[] }).templates.map((t) => t.name).sort()).toEqual(['Leg day', 'Push day']);
    expect((await lists(boC)).programs).toEqual([]);
    expect((await lists(anaC)).programsByMe).toMatchObject([{ status: 'running', sessionsDone: 0, sessionsTotal: 8 }]);
    // Bo runs the first session like any program; the coach sees the count.
    const started = await call(boC, 'start_workout', { program: true });
    expect(started.text).toContain('Week 1, Day A');
    await finish((started.data as unknown as { workout: WorkoutPlan }).workout);
    expect((await lists(anaC)).programsByMe).toMatchObject([{ status: 'running', sessionsDone: 1 }]);
    expect((await call(boC, 'accept_assigned_program', { assignment_id: id })).isError).toBe(true); // nothing left to accept
  });

  it('never replaces a workout Bo already has, and ends the program Bo was on (which is why it is asked first)', async () => {
    await makeProgram();
    await call(boC, 'save_workout_template', { name: 'Push day', exercises: [{ id: SQUAT, sets: 1, reps: 1 }] });
    await call(anaC, 'assign_program', { coaching_id: coachingId });
    const r = await call(boC, 'accept_assigned_program', { assignment_id: (await lists(boC)).programs[0]!.assignmentId });
    expect((r.data as { savedWorkouts: string[] }).savedWorkouts).toEqual(['Push day (from coach)', 'Leg day']);
    const own = await env.DB.prepare("SELECT exercises FROM workout_templates WHERE user_id = ? AND name = 'Push day'").bind(bo.id).first<{ exercises: string }>();
    expect(own!.exercises).toContain('Barbell_Squat'); // Bo's own, unchanged
    const tools = (await boC.listTools()).tools;
    expect(tools.find((t) => t.name === 'accept_assigned_program')!.annotations?.destructiveHint).toBe(true);
  });

  it('can be dismissed, which the coach sees, and a newer one replaces one still waiting', async () => {
    await makeProgram();
    await call(anaC, 'assign_program', { coaching_id: coachingId });
    await call(anaC, 'assign_program', { coaching_id: coachingId, note: 'newer' });
    expect((await lists(boC)).programs).toMatchObject([{ note: 'newer' }]);
    const id = (await lists(boC)).programs[0]!.assignmentId;
    expect((await call(boC, 'dismiss_assignment', { assignment_id: id })).data).toEqual({ dismissed: true });
    expect((await lists(boC)).programs).toEqual([]);
    expect((await lists(anaC)).programsByMe).toMatchObject([{ status: 'skipped' }]);
    expect((await call(boC, 'dismiss_assignment', { assignment_id: id })).isError).toBe(true);
  });

  it('is refused without a program, for someone who is not a trainee, and for a program with the coach\'s own exercises', async () => {
    expect((await call(anaC, 'assign_program', { coaching_id: coachingId })).text).toContain('no active program');
    await makeProgram();
    expect((await call(boC, 'assign_program', { coaching_id: coachingId })).isError).toBe(true);
    expect((await call(cyC, 'assign_program', { coaching_id: coachingId })).isError).toBe(true);
    await env.DB.prepare("UPDATE workout_templates SET exercises = REPLACE(exercises, 'ex:Barbell_Squat', 'cx:mine') WHERE user_id = ? AND name = 'Leg day'").bind(ana.id).run();
    expect((await call(anaC, 'assign_program', { coaching_id: coachingId })).text).toContain('own exercises');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assigned_programs').first()).toEqual({ n: 0 });
  });

  it('goes with the coaching, the friendship and the account, and is in the export', async () => {
    await makeProgram();
    await call(anaC, 'assign_program', { coaching_id: coachingId, note: 'Go' });
    expect(((await call(anaC, 'export_my_data')).data as unknown as { assignedPrograms: { direction: string; name: string }[] }).assignedPrograms).toMatchObject([{ direction: 'given', name: 'Block 1', note: 'Go' }]);
    expect(((await call(boC, 'export_my_data')).data as unknown as { assignedPrograms: { direction: string }[] }).assignedPrograms).toMatchObject([{ direction: 'received' }]);
    await call(boC, 'end_coaching', { coaching_id: coachingId });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assigned_programs').first()).toEqual({ n: 0 });
    const again = await coach(anaC, boC, ((await call(anaC, 'list_friends')).data as unknown as FriendList).friends[0]!.connectionId);
    await call(anaC, 'assign_program', { coaching_id: again });
    await call(boC, 'remove_friend', { connection_id: ((await call(boC, 'list_friends')).data as unknown as FriendList).friends[0]!.connectionId });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assigned_programs').first()).toEqual({ n: 0 });
    const third = await coach(anaC, cyC, await befriend(anaC, cyC, 'cy@example.com'));
    await call(anaC, 'assign_program', { coaching_id: third });
    await deleteUser(env.DB, ana);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM assigned_programs').first()).toEqual({ n: 0 });
  });
});

describe('the roster', () => {
  const roster = async (c: Client = anaC) => (await call(c, 'show_coach_roster')).data as unknown as { roster: CoachRoster };

  it('counts what came due, what is overdue and when the last one was finished, and shows food only when shared', async () => {
    const today = (await roster()).roster.today;
    const yesterday = addDays(today, -1);
    const assign = async (on?: string) => ((await call(anaC, 'assign_workout', { coaching_id: coachingId, template: 'Push day', ...(on ? { on } : {}) })).data as { assignmentId: string }).assignmentId;
    const a = await assign(yesterday); // done
    const b = await assign(yesterday); // skipped
    await assign(yesterday); // overdue
    await assign(addDays(today, 2)); // not due yet
    const started = await call(boC, 'start_workout', { assignment_id: a });
    const plan = (started.data as unknown as { workout: WorkoutPlan }).workout;
    await finish(plan);
    await call(boC, 'dismiss_assignment', { assignment_id: b });
    let t = (await roster()).roster.trainees[0]!;
    expect(t).toMatchObject({ status: 'active', workouts: { assigned: 4, done: 1, skipped: 1, waiting: 2, overdue: 1, adherencePct: 33 }, lastDone: today, next: { name: 'Push day', dueOn: yesterday }, food: null, targetsWaiting: false });
    expect(t.shareFood).toBe(false);
    await call(boC, 'set_coaching_sharing', { coaching_id: coachingId, share_food: true });
    await call(boC, 'log_food', { day: yesterday, items: [{ food_id: 'frida:59', grams: 300 }] });
    await call(boC, 'set_goals', { kcal: 2400 });
    t = (await roster()).roster.trainees[0]!;
    expect(t.food).toMatchObject({ loggedDays: 1, goalKcal: 2400 });
    expect(JSON.stringify(t)).not.toMatch(/rye|frida|grams/i);
  });

  it('lists an unanswered offer without numbers, is empty for someone who coaches nobody, and shows each coach only their own trainees', async () => {
    await call(anaC, 'offer_coaching', { connection_id: await befriend(anaC, cyC, 'cy@example.com') });
    const r = (await roster()).roster;
    expect(r.trainees.map((t) => [t.who.email, t.status])).toEqual([['bo@example.com', 'active'], ['cy@example.com', 'pending']]);
    expect(r.trainees[1]).toMatchObject({ workouts: { assigned: 0, adherencePct: null }, next: null });
    expect((await roster(boC)).roster.trainees).toEqual([]);
    expect((await roster(cyC)).roster.trainees).toEqual([]);
  });

  it('shows the program a trainee is on', async () => {
    await makeProgram();
    await call(anaC, 'assign_program', { coaching_id: coachingId });
    expect((await roster()).roster.trainees[0]!.program).toMatchObject({ name: 'Block 1', status: 'waiting', sessionsTotal: 8 });
    await call(boC, 'accept_assigned_program', { assignment_id: (await lists(boC)).programs[0]!.assignmentId });
    expect((await roster()).roster.trainees[0]!.program).toMatchObject({ status: 'running', sessionsDone: 0 });
  });
});

describe("the coach's note in the player", () => {
  const plan = async (r: Awaited<ReturnType<typeof call>>) => (r.data as unknown as { workout: WorkoutPlan }).workout;

  it('comes with the workout when it is opened for an assignment, again when it is reopened, and not for any other workout', async () => {
    const id = ((await call(anaC, 'assign_workout', { coaching_id: coachingId, template: 'Push day', note: 'Keep it <b>smooth</b>' })).data as { assignmentId: string }).assignmentId;
    const w = await plan(await call(boC, 'start_workout', { assignment_id: id }));
    expect(w.coach).toEqual({ from: 'ana@example.com', note: 'Keep it smooth' });
    expect((await plan(await call(boC, 'get_workout', { workoutId: w.workoutId }))).coach).toEqual(w.coach);
    expect((await plan(await call(boC, 'start_workout', { exercises: [{ id: SQUAT, sets: 1, reps: 1 }] }))).coach).toBeUndefined();
    // An assignment without a note adds nothing.
    const bare = ((await call(anaC, 'assign_workout', { coaching_id: coachingId, template: 'Leg day' })).data as { assignmentId: string }).assignmentId;
    expect((await plan(await call(boC, 'start_workout', { assignment_id: bare }))).coach).toBeUndefined();
  });

  describe('on the overview card', () => {
    beforeAll(launch, 60_000);
    afterAll(closeAll);
    const base: WorkoutPlan = { workoutId: 'w1', name: 'Push day', startedAt: Date.now(), finished: false, cardio: [], exercises: [{ uid: 'u1', id: BENCH, name: 'Bench Press', equipment: 'barbell', restSec: 90, bodyweight: false, sets: [{ id: 'a', targetReps: 5, weightKg: 60, done: false }] }] };

    it('is shown as text with who wrote it, and nothing is drawn for a workout without one', async () => {
      const v = await openView(workoutHtml, { content: [{ type: 'text', text: 'open' }], structuredContent: { workout: { ...base, coach: { from: 'ana_fit', note: 'Keep it <b>smooth</b> and pause on the chest' } } } });
      await pwExpect(v.frame.getByText('Note from ana_fit')).toBeVisible();
      await pwExpect(v.frame.getByText('Keep it <b>smooth</b> and pause on the chest')).toBeVisible(); // markup stays text
      const none = await openView(workoutHtml, { content: [{ type: 'text', text: 'open' }], structuredContent: { workout: base } });
      await pwExpect(none.frame.getByRole('heading', { name: 'Today' })).toBeVisible();
      expect(await none.frame.getByText(/Note from/).count()).toBe(0);
    }, 30_000);
  });
});

describe('the roster view', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);
  const trainee = (o: Record<string, unknown>) => ({ coachingId: 'c1', who: { nickname: 'bo.lifts', email: null }, status: 'active', since: '2026-10-01', shareResults: false, shareFood: false, workouts: { assigned: 6, done: 4, skipped: 1, waiting: 1, overdue: 1, adherencePct: 67 }, lastDone: '2026-11-18', next: { name: 'Push day', dueOn: '2026-11-20', started: false }, program: { name: 'Block 1', status: 'running', sessionsDone: 3, sessionsTotal: 12 }, food: null, targetsWaiting: false, ...o });
  const result = (trainees: unknown[]) => ({ content: [{ type: 'text', text: 'open' }], structuredContent: { roster: { today: '2026-11-19', limit: 10, trainees } } });

  it('shows each trainee with adherence, what is overdue, the program and the review button, and food only when shared', async () => {
    const v = await openView(coachHtml, result([trainee({}), trainee({ coachingId: 'c2', who: { nickname: null, email: 'cy@example.com' }, shareFood: true, food: { loggedDays: 5, kcal: 2310, goalKcal: 2400, proteinG: 148, goalProteinG: 160 }, targetsWaiting: true, program: null }), trainee({ coachingId: 'c3', who: { nickname: 'di', email: null }, status: 'pending' })]));
    await pwExpect(v.frame.getByRole('heading', { name: 'Coaching' })).toBeVisible();
    await pwExpect(v.frame.getByText('3 trainees of 10')).toBeVisible();
    await pwExpect(v.frame.getByText('67 % of what came due was done · 4 done · 1 skipped · 1 waiting').first()).toBeVisible();
    expect(await v.frame.getByText('67 % of what came due was done').count()).toBe(2); // the two active trainees
    await pwExpect(v.frame.getByText('1 workout overdue').first()).toBeVisible();
    await pwExpect(v.frame.getByText(/Last finished 18 Nov · next: Push day, due 20 Nov/).first()).toBeVisible();
    await pwExpect(v.frame.getByText('Program “Block 1”: 3 of 12 sessions done')).toBeVisible(); // only the trainee who has one
    await pwExpect(v.frame.getByRole('img', { name: "25 % of the program's sessions are done" })).toBeVisible();
    await pwExpect(v.frame.getByText('Food: logged 5 of the last 7 days, averaging 2,310 of 2,400 kcal and 148 of 160 g protein')).toBeVisible();
    expect(await v.frame.getByText(/^Food:/).count()).toBe(1); // only the trainee who shares food
    await pwExpect(v.frame.getByText('Targets proposed, not answered yet.')).toBeVisible();
    await pwExpect(v.frame.getByText('Nothing can be assigned until they accept.')).toBeVisible();
  }, 30_000);

  it('asks Claude to review one trainee through the chat, naming the coaching id and the tools, and never by itself', async () => {
    const v = await openView(coachHtml, result([trainee({ shareFood: true })]));
    expect(v.calls).toEqual([]);
    await v.frame.getByRole('button', { name: 'Ask Claude to review how bo.lifts is doing' }).click();
    await expect.poll(() => v.calls.length).toBe(1);
    expect(v.calls[0]!.name).toBe('ui/message');
    expect(JSON.stringify(v.calls[0]!.args)).toContain('list_assignments with coaching_id c1');
    expect(JSON.stringify(v.calls[0]!.args)).toContain('get_trainee_food');
  }, 30_000);

  it('says so when nobody is coached, and draws a hostile name as text', async () => {
    const none = await openView(coachHtml, result([]));
    await pwExpect(none.frame.getByText('You are not coaching anyone yet.')).toBeVisible();
    const evil = await openView(coachHtml, result([trainee({ who: { nickname: '<img src=x onerror=alert(1)>', email: null } })]));
    await pwExpect(evil.frame.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
    expect(await evil.frame.locator('img').count()).toBe(0);
  }, 30_000);
});

describe('the reminder email', () => {
  const WED_08_CPH = Date.parse('2026-11-04T07:00:00Z'); // 08:00 in Copenhagen (UTC+1)
  const WED_19_CPH = Date.parse('2026-11-04T18:00:00Z');
  const TODAY = '2026-11-04';
  let sent: Mail[];
  let mailer: Mailer;
  beforeEach(() => {
    sent = [];
    mailer = { async send(m) { sent.push(m); } };
  });
  const run = (now: number) => runDigests({ db: env.DB, mailer, publicUrl: 'https://mcp.fitwell.test', now: () => now });
  const assign = async (on?: string, template = 'Push day') => ((await call(anaC, 'assign_workout', { coaching_id: coachingId, template, ...(on ? { on } : {}) })).data as { assignmentId: string }).assignmentId;
  const optIn = () => call(boC, 'update_profile', { email_digests: { assignment_reminder: true } });

  it('is off until the trainee asks, shown in get_profile, and nothing is sent without it', async () => {
    await assign(TODAY);
    expect((await call(boC, 'get_profile')).data.emailDigests).toMatchObject({ assignmentReminder: false, coachSummary: false });
    expect(await run(WED_08_CPH)).toEqual({ weekly: 0, nudge: 0, assigned: 0, coach: 0, failed: 0 });
    expect(sent).toEqual([]);
    expect((await optIn()).data.emailDigests).toMatchObject({ assignmentReminder: true });
  });

  it('goes out once, in the morning, for a workout due today, with names and no coach note, and an unsubscribe link', async () => {
    await optIn();
    await call(anaC, 'assign_workout', { coaching_id: coachingId, template: 'Push day', on: TODAY, note: 'secret note text' });
    expect(await run(WED_19_CPH)).toMatchObject({ assigned: 0 }); // not in the evening
    expect(await run(WED_08_CPH)).toEqual({ weekly: 0, nudge: 0, assigned: 1, coach: 0, failed: 0 });
    expect(await run(WED_08_CPH + 600_000)).toMatchObject({ assigned: 0 }); // once a day
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe('bo@example.com');
    expect(m.subject).toBe('Fitwell: Push day is due today');
    expect(m.text).toContain('Push day (from ana@example.com), due today');
    expect(m.text).not.toContain('secret note text');
    expect(m.text).toMatch(/Unsubscribe: https:\/\/mcp\.fitwell\.test\/unsubscribe\?u=.+&t=.+&k=assigned/);
    expect(m.headers?.['List-Unsubscribe']).toContain('k=assigned');
  });

  it('says nothing for a workout without a day, not yet due, already started, long overdue, or dismissed', async () => {
    await optIn();
    await assign(); // no day
    await assign('2026-11-05'); // tomorrow
    await assign('2026-10-30'); // five days ago
    const started = await assign(TODAY);
    await call(boC, 'start_workout', { assignment_id: started });
    const dismissed = await assign(TODAY, 'Leg day');
    await call(boC, 'dismiss_assignment', { assignment_id: dismissed });
    expect(await run(WED_08_CPH)).toMatchObject({ assigned: 0 });
    expect(sent).toEqual([]);
    await assign('2026-11-02'); // two days overdue still counts
    expect(await run(WED_08_CPH)).toMatchObject({ assigned: 1 });
    expect(sent[0]!.text).toContain('due Monday 2 Nov');
  });

  it('is switched off by its own unsubscribe link, which leaves the other emails as they were, and is retried after a failed send', async () => {
    await call(boC, 'update_profile', { email_digests: { weekly_review: true, assignment_reminder: true } });
    await assign(TODAY);
    let fail = true;
    mailer = { async send(m) { if (fail) throw new Error('down'); sent.push(m); } };
    expect(await run(WED_08_CPH)).toMatchObject({ assigned: 0, coach: 0, failed: 1 });
    fail = false;
    expect(await run(WED_08_CPH + 600_000)).toMatchObject({ assigned: 1 });
    const url = new URL(sent[0]!.text.match(/Unsubscribe: (\S+)/)![1]!);
    const res = await handleUnsubscribe(new Request(url, { method: 'POST' }), { db: env.DB });
    expect(res.status).toBe(200);
    expect((await call(boC, 'get_profile')).data.emailDigests).toEqual({ weeklyReview: true, inactivityNudge: false, assignmentReminder: false, coachSummary: false });
  });

  it('goes with the account, and the digest log still accepts the older kinds after the migration rebuilt it', async () => {
    await optIn();
    await assign(TODAY);
    await run(WED_08_CPH);
    await env.DB.prepare("INSERT INTO digest_log (user_id, kind, period, sent_at) VALUES (?, 'weekly', '2026-11-02', 1)").bind(bo.id).run();
    await deleteUser(env.DB, bo);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM digest_log').first()).toEqual({ n: 0 });
  });
});

describe('the coach summary email', () => {
  const MON_08_CPH = Date.parse('2026-11-02T07:00:00Z'); // Monday 08:00 in Copenhagen (UTC+1)
  const TUE_08_CPH = Date.parse('2026-11-03T07:00:00Z');
  const MON_19_CPH = Date.parse('2026-11-02T18:00:00Z');
  let sent: Mail[];
  let mailer: Mailer;
  beforeEach(() => {
    sent = [];
    mailer = { async send(m) { sent.push(m); } };
  });
  const run = (now: number) => runDigests({ db: env.DB, mailer, publicUrl: 'https://mcp.fitwell.test', now: () => now });
  const optIn = () => call(anaC, 'update_profile', { email_digests: { coach_summary: true } });

  it('is off until the coach asks, and shown in get_profile', async () => {
    expect((await call(anaC, 'get_profile')).data.emailDigests).toMatchObject({ coachSummary: false });
    expect(await run(MON_08_CPH)).toEqual({ weekly: 0, nudge: 0, assigned: 0, coach: 0, failed: 0 });
    expect((await optIn()).data.emailDigests).toMatchObject({ coachSummary: true });
    expect(sent).toEqual([]);
  });

  it('goes out once on Monday morning with each trainee\'s numbers, and food only for one who shares it, never a note', async () => {
    await optIn();
    const cyCoaching = await coach(anaC, cyC, await befriend(anaC, cyC, 'cy@example.com'), { share_food: true });
    const a = ((await call(anaC, 'assign_workout', { coaching_id: coachingId, template: 'Push day', on: '2026-10-30', note: 'secret note text' })).data as { assignmentId: string }).assignmentId;
    await call(anaC, 'assign_workout', { coaching_id: coachingId, template: 'Leg day', on: '2026-10-31' }); // overdue
    await finish((await call(boC, 'start_workout', { assignment_id: a })).data.workout as WorkoutPlan);
    await call(cyC, 'log_food', { day: '2026-11-01', items: [{ food_id: 'frida:59', grams: 300 }] });
    await call(cyC, 'set_goals', { kcal: 2400 });
    expect(await run(TUE_08_CPH)).toMatchObject({ coach: 0 }); // not on a Tuesday
    expect(await run(MON_19_CPH)).toMatchObject({ coach: 0 }); // not in the evening
    expect(await run(MON_08_CPH)).toEqual({ weekly: 0, nudge: 0, assigned: 0, coach: 1, failed: 0 });
    expect(await run(MON_08_CPH + 600_000)).toMatchObject({ coach: 0 }); // once a week
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe('ana@example.com');
    expect(m.subject).toBe('Your trainees in Fitwell, 2 Nov');
    expect(m.text).toContain('bo@example.com: 1 of 2 assigned workouts done (50 % of what came due), 1 overdue.');
    expect(m.text).toContain('cy@example.com: no workout assigned in the last 4 weeks.');
    expect(m.text).toMatch(/Food, last 7 days: logged 1, averaging \d[\d,]* of 2,400 kcal/);
    expect(m.text.match(/Food, last 7 days/g)).toHaveLength(1); // Bo does not share food
    expect(m.text).not.toContain('secret note text');
    expect(m.text).not.toMatch(/rye|frida/i);
    expect(m.text).toMatch(/Unsubscribe: https:\/\/mcp\.fitwell\.test\/unsubscribe\?u=.+&t=.+&k=coach/);
    expect(m.headers?.['List-Unsubscribe']).toContain('k=coach');
    expect(cyCoaching).toBeTruthy();
  });

  it('is not sent to someone nobody has accepted coaching from, and a hostile name stays text', async () => {
    await optIn();
    await call(boC, 'end_coaching', { coaching_id: coachingId });
    await call(anaC, 'offer_coaching', { connection_id: ((await call(anaC, 'list_friends')).data as unknown as FriendList).friends[0]!.connectionId });
    expect(await run(MON_08_CPH)).toMatchObject({ coach: 0 }); // an unanswered offer is nothing to report
    expect(sent).toEqual([]);
    const id = ((await call(boC, 'list_coaching')).data as unknown as { asTrainee: { coachingId: string }[] }).asTrainee[0]!.coachingId;
    await call(boC, 'accept_coaching', { coaching_id: id, share_results: false });
    await call(boC, 'set_nickname', { nickname: 'bo_<b>x' }).catch(() => undefined);
    await env.DB.prepare("UPDATE profiles SET nickname = '<b>bold</b>' WHERE user_id = ?").bind(bo.id).run();
    expect(await run(MON_08_CPH)).toMatchObject({ coach: 1 });
    expect(sent[0]!.html).not.toContain('<b>bold</b>');
    expect(sent[0]!.html).toContain('&#60;b&#62;bold');
  });

  it('is switched off by its own link, leaving the other emails as they were, and is retried after a failed send', async () => {
    await call(anaC, 'update_profile', { email_digests: { weekly_review: true, coach_summary: true } });
    let fail = true;
    mailer = { async send(m) { if (fail) throw new Error('down'); sent.push(m); } };
    expect(await run(MON_08_CPH)).toMatchObject({ coach: 0, failed: 1 });
    fail = false;
    expect(await run(MON_08_CPH + 600_000)).toMatchObject({ coach: 1 });
    const res = await handleUnsubscribe(new Request(new URL(sent[0]!.text.match(/Unsubscribe: (\S+)/)![1]!), { method: 'POST' }), { db: env.DB });
    expect(res.status).toBe(200);
    expect((await call(anaC, 'get_profile')).data.emailDigests).toEqual({ weeklyReview: true, inactivityNudge: false, assignmentReminder: false, coachSummary: false });
  });
});
