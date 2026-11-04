// Challenges (B4): opt-in, among friends, consistency-based and rest-day friendly; one number per person is all anyone else sees; a cron closes them and emails each person once.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mail, Mailer } from '../src/auth/mailer';
import type { ChallengeInvite, ChallengeView } from '../src/data/challenges';
import { rankScores } from '../src/data/challenges';
import type { FriendList } from '../src/data/friends';
import { deleteUser, type User } from '../src/data/users';
import { runChallenges } from '../src/digests/challenges';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const NOW = Date.parse('2026-11-04T10:00:00Z'); // Wednesday
const thisMonday = weekStart('2026-11-04');
const nextMonday = addDays(thisMonday, 7);

let env: Env;
let ana: User;
let bo: User;
let cy: User;
let anaC: Client;
let boC: Client;
let cyC: Client;
let sent: Mail[];
let mailer: Mailer;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); // the challenge's own clock: Wednesday 4 November 2026
  vi.setSystemTime(NOW);
  env = createTestEnv().env;
  sent = [];
  mailer = { async send(m) { sent.push(m); } };
  [ana, bo, cy] = [await signedInUser(env, 'ana@example.com'), await signedInUser(env, 'bo@example.com'), await signedInUser(env, 'cy@example.com')];
  [anaC, boC, cyC] = [await connectAs(env, ana), await connectAs(env, bo), await connectAs(env, cy)];
});

afterEach(() => {
  vi.useRealTimers();
});

async function befriend(from: Client, to: Client, email: string) {
  await call(from, 'request_friend', { email });
  const incoming = ((await call(to, 'list_friends')).data as unknown as FriendList).incoming.at(-1)!.connectionId;
  await call(to, 'accept_friend', { connection_id: incoming });
  return ((await call(from, 'list_friends')).data as unknown as FriendList).friends.find((f) => f.email === email)!.connectionId;
}
const list = async (c: Client) => (await call(c, 'list_challenges')).data as unknown as { challenges: ChallengeView[]; invitations: ChallengeInvite[] };
const make = async (extra: Record<string, unknown> = {}) => {
  const r = await call(anaC, 'create_challenge', { name: 'Train', metric: 'training_days', per_week: 3, weeks: 2, start_day: thisMonday, ...extra });
  return r.isError ? null : (r.data as unknown as { created: { id: string } }).created.id;
};
/** Ana and Bo are friends and Bo joined Ana's challenge. */
async function joined(extra: Record<string, unknown> = {}) {
  const conn = await befriend(anaC, boC, 'bo@example.com');
  const id = (await make(extra))!;
  await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn });
  await call(boC, 'accept_challenge', { challenge_id: id });
  return id;
}
const workout = (userId: string, day: string, n = 1) =>
  env.DB.prepare("INSERT INTO workouts (id, user_id, day, type, name, started_at, finished_at, exercises, created_at, updated_at) VALUES (?, ?, ?, 'strength', 'W', 1, 2, '[]', 1, 1)").bind(`w-${userId}-${day}-${n}`, userId, day).run();
const score = async (c: Client, id: string, who: string) => (await list(c)).challenges.find((x) => x.id === id)!.standings.find((s) => s.who === who)?.score;

describe('the pure rules', () => {
  it('shares a place between ties', () => {
    expect(rankScores([5, 3, 3, 1])).toEqual([1, 2, 2, 4]);
    expect(rankScores([])).toEqual([]);
  });
});

describe('making one and answering', () => {
  it('is created by its owner, who is in it, and invites only friends', async () => {
    const id = (await make())!;
    expect((await list(anaC)).challenges).toMatchObject([{ id, name: 'Train', state: 'running', yours: true, maxScore: 6, standings: [{ who: 'You', score: 0, rank: 1 }] }]);
    expect((await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: 'nope' })).isError).toBe(true);
    await call(anaC, 'request_friend', { email: 'cy@example.com' }); // a request is not a friend
    const pending = ((await call(cyC, 'list_friends')).data as unknown as FriendList).incoming[0]!.connectionId;
    expect((await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: pending })).isError).toBe(true);
  });

  it('shows an invitation with the rule to the friend only, who decides', async () => {
    const conn = await befriend(anaC, boC, 'bo@example.com');
    const id = (await make())!;
    await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn });
    expect((await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn })).isError).toBe(true); // again
    expect((await list(boC)).invitations).toMatchObject([{ challengeId: id, name: 'Train', from: 'ana@example.com', rule: expect.stringContaining('a rest day never costs a point') }]);
    expect((await list(boC)).challenges).toEqual([]); // not joined: nothing of it is listed
    expect((await list(cyC)).invitations).toEqual([]);
    expect((await call(cyC, 'accept_challenge', { challenge_id: id })).isError).toBe(true);
    expect((await call(cyC, 'decline_challenge', { challenge_id: id })).isError).toBe(true);
    expect((await call(boC, 'accept_challenge', { challenge_id: id })).isError).toBe(false);
    expect((await list(anaC)).challenges[0]!.standings.map((s) => s.who).sort()).toEqual(['You', 'bo@example.com']);
  });

  it('an invitation from someone who is no longer a friend can neither be seen nor accepted', async () => {
    const conn = await befriend(anaC, boC, 'bo@example.com');
    const id = (await make())!;
    await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn });
    await call(anaC, 'remove_friend', { connection_id: conn });
    expect((await list(boC)).invitations).toEqual([]);
    expect((await call(boC, 'accept_challenge', { challenge_id: id })).isError).toBe(true);
    expect((await list(anaC)).challenges[0]!.standings.map((s) => s.who)).toEqual(['You']);
  });

  it('a decline deletes the invitation, and only the owner invites', async () => {
    const conn = await befriend(anaC, boC, 'bo@example.com');
    const id = (await make())!;
    await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn });
    expect((await call(boC, 'decline_challenge', { challenge_id: id })).isError).toBe(false);
    expect((await list(boC)).invitations).toEqual([]);
    const cyConn = await befriend(boC, cyC, 'cy@example.com');
    expect((await call(boC, 'invite_to_challenge', { challenge_id: id, connection_id: cyConn })).isError).toBe(true); // Bo is not the owner
  });

  it('refuses a bad start, a steps challenge without a threshold, and more than three of one\'s own', async () => {
    expect(await make({ start_day: addDays(thisMonday, 1) })).toBeNull();
    expect(await make({ start_day: addDays(thisMonday, -7) })).toBeNull();
    expect(await make({ metric: 'steps_days' })).toBeNull();
    for (let i = 0; i < 3; i++) expect(await make({ name: `C${i}` })).not.toBeNull();
    expect(await make({ name: 'C4' })).toBeNull();
  });

  it('a protein challenge needs the person\'s own protein goal, and the goal itself is never shown', async () => {
    const conn = await befriend(anaC, boC, 'bo@example.com');
    const id = (await make({ metric: 'protein_days' }))!;
    await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn });
    expect((await call(boC, 'accept_challenge', { challenge_id: id })).text).toContain('protein goal');
    await call(boC, 'set_goals', { protein_g: 123 });
    expect((await call(boC, 'accept_challenge', { challenge_id: id })).isError).toBe(false);
    expect(JSON.stringify((await list(anaC)).challenges)).not.toContain('123');
  });
});

describe('the score', () => {
  it('counts days, at most per_week in a week, so a rest day costs nothing and extra days do not run away', async () => {
    const id = await joined({ per_week: 2, weeks: 2 });
    for (const d of [0, 1, 2]) await workout(ana.id, addDays(thisMonday, d)); // three days so far this week: counts 2
    await workout(ana.id, addDays(thisMonday, 2), 2); // a second workout the same day: still one day
    await workout(bo.id, addDays(thisMonday, 1));
    await workout(bo.id, addDays(nextMonday, 0));
    expect(await score(anaC, id, 'You')).toBe(2);
    expect(await score(boC, id, 'You')).toBe(1); // next week has not happened yet
    expect(await score(anaC, id, 'bo@example.com')).toBe(1);
  });

  it('counts only finished strength workouts, and logged cardio or sessions', async () => {
    const id = await joined();
    await env.DB.prepare("INSERT INTO workouts (id, user_id, day, type, name, started_at, finished_at, exercises, created_at, updated_at) VALUES ('open', ?, ?, 'strength', 'W', 1, NULL, '[]', 1, 1)").bind(ana.id, thisMonday).run();
    expect(await score(anaC, id, 'You')).toBe(0);
    await call(anaC, 'log_cardio', { activity_id: 'act:run-10', duration_min: 20, day: thisMonday });
    expect(await score(anaC, id, 'You')).toBe(1);
  });

  it('counts steps days at the threshold and protein days at each one\'s own goal', async () => {
    const steps = await joined({ metric: 'steps_days', steps_threshold: 8000 });
    await call(anaC, 'log_body', { day: thisMonday, steps: 8000 });
    await call(anaC, 'log_body', { day: addDays(thisMonday, 1), steps: 7999 });
    expect(await score(anaC, steps, 'You')).toBe(1);
    await call(anaC, 'cancel_challenge', { challenge_id: steps });
    await call(anaC, 'set_goals', { protein_g: 20 });
    await call(boC, 'set_goals', { protein_g: 60 });
    const conn = ((await call(anaC, 'list_friends')).data as unknown as FriendList).friends[0]!.connectionId;
    const id = (await make({ metric: 'protein_days' }))!;
    await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn });
    await call(boC, 'accept_challenge', { challenge_id: id });
    const food = (c: Client) => call(c, 'log_food', { day: thisMonday, items: [{ food_id: 'frida:413', grams: 400 }] }); // about 11.6 g protein... rye bread
    await call(anaC, 'log_food', { day: thisMonday, items: [{ food_id: 'frida:59', grams: 200 }] }); // oats: over 20 g
    await food(boC);
    expect(await score(anaC, id, 'You')).toBe(1);
    expect(await score(anaC, id, 'bo@example.com')).toBe(0); // under Bo's own, higher goal
  });
});

describe('what others see', () => {
  it('shows a non-friend by nickname only, or as "A participant", never their email, and nothing else of anyone', async () => {
    const conn = await befriend(anaC, boC, 'bo@example.com');
    const cyConn = await befriend(anaC, cyC, 'cy@example.com');
    const id = (await make())!;
    for (const c of [conn, cyConn]) await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: c });
    await call(boC, 'accept_challenge', { challenge_id: id });
    await call(cyC, 'accept_challenge', { challenge_id: id });
    await call(boC, 'log_body', { weight_kg: 81.3, day: thisMonday });
    await call(boC, 'update_profile', { diet: { allergies: ['peanut'] } });
    const seenByBo = (await call(boC, 'list_challenges')).data as unknown as { challenges: ChallengeView[] };
    expect(seenByBo.challenges[0]!.standings.map((s) => s.who).sort()).toEqual(['A participant', 'You', 'ana@example.com']); // Cy is not Bo's friend
    expect(JSON.stringify((await call(anaC, 'list_challenges')).data)).not.toMatch(/81\.3|peanut/);
    await call(cyC, 'set_nickname', { nickname: 'cy.runs' });
    expect((await list(boC)).challenges[0]!.standings.map((s) => s.who).sort()).toEqual(['A participant'.length ? 'You' : '', 'ana@example.com', 'cy.runs'].sort());
  });

  it('is invisible to someone who is not in it', async () => {
    await joined();
    expect((await list(cyC)).challenges).toEqual([]);
    expect((await call(cyC, 'cancel_challenge', { challenge_id: (await list(anaC)).challenges[0]!.id })).isError).toBe(true);
  });

  it('leaving takes the score out; the owner cancels instead and it goes for everyone', async () => {
    const id = await joined();
    expect((await call(anaC, 'leave_challenge', { challenge_id: id })).isError).toBe(true); // her own
    expect((await call(boC, 'leave_challenge', { challenge_id: id })).isError).toBe(false);
    expect((await list(anaC)).challenges[0]!.standings).toHaveLength(1);
    expect((await call(anaC, 'cancel_challenge', { challenge_id: id })).isError).toBe(false);
    expect((await list(anaC)).challenges).toEqual([]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM challenge_members').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('closing', () => {
  const run = (now: number, skip?: (e: string) => boolean) => runChallenges({ db: env.DB, mailer, publicUrl: 'https://mcp.fitwell.test', now: () => now, skip });

  it('closes a challenge once its last day is over, fixes the scores and places, and emails each person once', async () => {
    const id = await joined({ weeks: 1, per_week: 3 }); // this week, ends Sunday 8 Nov
    for (const d of [0, 1, 2]) await workout(ana.id, addDays(thisMonday, d));
    await workout(bo.id, addDays(thisMonday, 1));
    expect(await run(Date.parse('2026-11-08T12:00:00Z'))).toMatchObject({ closed: 0, emailed: 0 }); // the last day is not over yet
    const after = Date.parse('2026-11-09T01:00:00Z');
    expect(await run(after)).toEqual({ closed: 1, emailed: 2, failed: 0 });
    const toAna = sent.find((m) => m.to === 'ana@example.com')!;
    expect(toAna.subject).toBe('Challenge results: Train');
    expect(toAna.text).toContain('You counted 3 days of a possible 3, place 1 of 2.');
    expect(toAna.text).toContain('2. bo@example.com: 1 day');
    expect(toAna.text).toContain('joined the challenge');
    expect(toAna.text).not.toMatch(/weight|kg|kcal/i);
    expect(sent.find((m) => m.to === 'bo@example.com')!.text).toContain('place 2 of 2');
    expect(await run(after + 3_600_000)).toEqual({ closed: 0, emailed: 0, failed: 0 }); // once only
    expect((await list(anaC)).challenges[0]).toMatchObject({ state: 'closed', standings: [{ who: 'You', score: 3, rank: 1 }, { who: 'bo@example.com', score: 1, rank: 2 }] });
    await workout(bo.id, addDays(thisMonday, 3)); // later logging never changes a closed result
    expect(((await list(anaC)).challenges.find((c) => c.id === id)!.standings.find((s) => s.who === 'bo@example.com'))!.score).toBe(1);
  });

  it('retries a failed email on the next run and never emails a skipped address or someone who only has an open invitation', async () => {
    const conn = await befriend(anaC, boC, 'bo@example.com');
    const id = (await make({ weeks: 1 }))!;
    await call(anaC, 'invite_to_challenge', { challenge_id: id, connection_id: conn }); // Bo never answers
    const after = Date.parse('2026-11-09T01:00:00Z');
    let fail = true;
    mailer = { async send(m) { if (fail) throw new Error('down'); sent.push(m); } };
    expect(await run(after)).toMatchObject({ closed: 1, emailed: 0, failed: 1 });
    fail = false;
    expect(await run(after + 3_600_000)).toMatchObject({ emailed: 1 });
    expect(sent.map((m) => m.to)).toEqual(['ana@example.com']);
    expect((await list(boC)).invitations).toEqual([]); // the unanswered invitation went with the closing
    const again = await runChallenges({ db: env.DB, mailer, publicUrl: 'x', now: () => after, skip: () => true });
    expect(again.emailed).toBe(0);
  });
});

describe('the account and the hints', () => {
  it('is in the export with only the person\'s own score, and goes with the account (a joined one just leaves)', async () => {
    const id = await joined();
    await workout(ana.id, thisMonday);
    const exp = (await call(anaC, 'export_my_data')).data as unknown as { challenges: { name: string; yourScore: number }[] };
    expect(exp.challenges).toMatchObject([{ name: 'Train', yourScore: 1 }]);
    await deleteUser(env.DB, bo);
    expect((await list(anaC)).challenges[0]!.standings).toHaveLength(1);
    await deleteUser(env.DB, ana);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM challenges').first<{ n: number }>())!.n).toBe(0);
    expect(id).toBeTruthy();
  });

  it('carries the right hints', async () => {
    const tools = (await anaC.listTools()).tools;
    expect(tools.find((t) => t.name === 'list_challenges')?.annotations).toMatchObject({ readOnlyHint: true });
    for (const n of ['decline_challenge', 'leave_challenge', 'cancel_challenge']) expect(tools.find((t) => t.name === n)?.annotations, n).toMatchObject({ destructiveHint: true });
    for (const n of ['create_challenge', 'invite_to_challenge', 'accept_challenge']) expect(tools.find((t) => t.name === n)?.annotations, n).toMatchObject({ destructiveHint: false });
  });
});
