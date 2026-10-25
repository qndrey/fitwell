// Members inviting friends: who may invite, the limits, the email, expiry, and what the owner and the export show.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Mail } from '../src/auth/mailer';
import { handleRequestAccess } from '../src/auth/requestAccess';
import { INVITE_TTL_MS, INVITE_WINDOW_MS, insertInvitee, pruneExpiredInvitations, reserveInvite } from '../src/data/memberInvites';
import { addInviteRequest, listInviteRequests } from '../src/data/inviteRequests';
import { deleteUser, findUserByEmail, inviteUser, recordLogin, type User } from '../src/data/users';
import { privacyBody } from '../src/auth/pages';
import worker from '../src/index';
import { createTestEnv, ctx } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const ORIGIN = 'https://mcp.fitwell.test';
const DAY = 86_400_000;
const ago = (days: number) => Date.now() - days * DAY;

let env: Env;
let sent: Mail[];
let signInMails: Mail[];
let failMail = false;
const mailer = { send: async (m: Mail) => { if (failMail) throw new Error('mail down'); sent.push(m); } };
const extra = { publicUrl: ORIGIN, contact: 'ask@fitwell.test', mailer };

beforeEach(() => {
  ({ env, sent: signInMails } = createTestEnv());
  sent = [];
  failMail = false;
});

/** Someone who first signed in `signedInDaysAgo` days ago and stored a weigh-in on each of the given days ago. */
async function member(email: string, signedInDaysAgo: number, loggedDaysAgo: number[]): Promise<User> {
  const u = await signedInUser(env, email);
  await env.DB.prepare('UPDATE users SET consented_at = ? WHERE id = ?').bind(ago(signedInDaysAgo), u.id).run();
  for (const d of loggedDaysAgo) {
    const t = ago(d);
    await env.DB.prepare('INSERT INTO weights (user_id, day, kg, created_at, updated_at) VALUES (?, ?, 70, ?, ?)').bind(u.id, new Date(t).toISOString().slice(0, 10), t, t).run();
  }
  return (await findUserByEmail(env.DB, email))!;
}
const active = (email = 'sam@example.com') => member(email, 10, [1, 2, 3]);
const as = async (u: User, admin = false, more: Record<string, unknown> = {}) => connectAs(env, u, undefined, { ...extra, isAdmin: admin, ...more });
const send = async (u: User, to: string) => call(await as(u), 'invite_friend', { action: 'send', email: to });
const logRows = async (id: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM member_invites WHERE inviter_id = ?').bind(id).first<number>('n'))!;

describe('who may invite', () => {
  it('lets an active person invite: the friend is stored as invited by them and gets one email naming them', async () => {
    const sam = await active();
    const r = await send(sam, 'Ana@Example.com');
    expect(r.isError).toBe(false);
    expect(r.data).toEqual({ email: 'ana@example.com', invited: true, expiresOn: new Date(Date.now() + INVITE_TTL_MS).toISOString().slice(0, 10), invitationsLeft: 2 });
    const ana = await findUserByEmail(env.DB, 'ana@example.com');
    expect(ana).toMatchObject({ status: 'invited', invited_by: sam.id });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ana@example.com');
    expect(sent[0]!.subject).toBe('sam@example.com invited you to Fitwell');
    expect(sent[0]!.text).toContain('sam@example.com');
    expect(await logRows(sam.id)).toBe(1);
  });

  it('counts food entries and workouts as logging days too', async () => {
    const u = await member('lena@example.com', 10, []);
    const stamps = [ago(1), ago(2), ago(3)];
    await env.DB.prepare('INSERT INTO food_entries (id, user_id, day, slot, food_name, grams, kcal, protein, carbs, fat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 100, 1, 1, 1, 1, ?, ?)').bind('f1', u.id, '2026-10-01', 'lunch', 'x', stamps[0], stamps[0]).run();
    await env.DB.prepare("INSERT INTO workouts (id, user_id, day, type, created_at, updated_at) VALUES (?, ?, ?, 'strength', ?, ?)").bind('w1', u.id, '2026-10-02', stamps[1], stamps[1]).run();
    await env.DB.prepare('INSERT INTO weights (user_id, day, kg, created_at, updated_at) VALUES (?, ?, 70, ?, ?)').bind(u.id, '2026-10-03', stamps[2], stamps[2]).run();
    expect((await send(u, 'ana@example.com')).isError).toBe(false);
  });

  it('refuses a new account, with the numbers, and sends nothing', async () => {
    const newcomer = await member('new@example.com', 2, [0, 1, 2]);
    const r = await send(newcomer, 'ana@example.com');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('signed in 2 days ago');
    expect(r.text).toContain('3 days logged');
    expect(sent).toHaveLength(0);
    expect(await findUserByEmail(env.DB, 'ana@example.com')).toBeNull();
  });

  it('refuses someone who logged on too few days, or only sleep and steps, or only long ago', async () => {
    const few = await member('few@example.com', 20, [1, 2]);
    expect((await send(few, 'a@example.com')).text).toContain('2 days logged');
    const sleeper = await member('sleep@example.com', 20, []);
    await env.DB.batch([1, 2, 3, 4].map((d) => env.DB.prepare('INSERT INTO daily_metrics (user_id, day, sleep_h, steps, updated_at) VALUES (?, ?, 8, 9000, ?)').bind(sleeper.id, `2026-10-0${d}`, ago(d))));
    expect((await send(sleeper, 'b@example.com')).text).toContain('0 days logged');
    const old = await member('old@example.com', 90, [40, 41, 42]);
    expect((await send(old, 'c@example.com')).text).toContain('0 days logged');
    expect(sent).toHaveLength(0);
  });

  it('counts the days once, even with several entries a day', async () => {
    const u = await member('two@example.com', 10, [1, 2]);
    const t = ago(1);
    await env.DB.prepare('INSERT INTO food_entries (id, user_id, day, slot, food_name, grams, kcal, protein, carbs, fat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 100, 1, 1, 1, 1, ?, ?)').bind('f2', u.id, '2026-10-01', 'lunch', 'x', t + 1000, t + 1000).run();
    expect((await send(u, 'ana@example.com')).isError).toBe(true);
  });

  it('refuses someone invited but not signed in yet', async () => {
    const ghost = await inviteUser(env.DB, 'ghost@example.com');
    const r = await send(ghost, 'ana@example.com');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('not finished signing in');
  });

  it('lets an owner skip the activity rule only', async () => {
    const owner = await signedInUser(env, 'owner@example.com');
    const client = await as(owner, true);
    expect((await call(client, 'invite_friend', { action: 'send', email: 'a@example.com' })).isError).toBe(false);
    expect((await call(client, 'invite_friend', { action: 'send', email: 'b@example.com' })).isError).toBe(false);
    expect((await call(client, 'invite_friend', { action: 'send', email: 'c@example.com' })).isError).toBe(false);
    const fourth = await call(client, 'invite_friend', { action: 'send', email: 'd@example.com' });
    expect(fourth.isError).toBe(true);
    expect(fourth.text).toContain('3 invitations');
  });

  it('refuses the reviewers\' demo account however active it is', async () => {
    const demo = await active('review@example.com');
    const r = await call(await as(demo, false, { isReviewer: true }), 'invite_friend', { action: 'send', email: 'ana@example.com' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('demo account');
    expect(sent).toHaveLength(0);
  });

  it('is a tool everyone sees, and the owner one only for owners', async () => {
    const sam = await active();
    const names = async (admin: boolean) => (await (await as(sam, admin)).listTools()).tools.map((t) => t.name);
    expect(await names(false)).toContain('invite_friend');
    expect(await names(false)).not.toContain('manage_invites');
    expect(await names(true)).toContain('manage_invites');
  });

  it('checks the address and refuses your own', async () => {
    const sam = await active();
    expect((await send(sam, 'not an address')).text).toContain('email address');
    expect((await send(sam, '')).isError).toBe(true);
    expect((await send(sam, ' Sam@Example.com ')).text).toContain('your own address');
    expect(await logRows(sam.id)).toBe(0);
  });
});

describe('limits', () => {
  it('allows 3 in 30 days, then says when one frees up; cancelling does not give one back', async () => {
    const sam = await active();
    for (const a of ['a', 'b', 'c']) expect((await send(sam, `${a}@example.com`)).isError).toBe(false);
    const fourth = await send(sam, 'd@example.com');
    expect(fourth.isError).toBe(true);
    expect(fourth.text).toContain(`frees up on ${new Date(Date.now() + INVITE_WINDOW_MS).toISOString().slice(0, 10)}`);
    await call(await as(sam), 'invite_friend', { action: 'cancel', email: 'a@example.com' });
    expect((await send(sam, 'd@example.com')).isError).toBe(true);
    expect(sent).toHaveLength(3);
    // After 30 days the oldest has aged out.
    await env.DB.prepare('UPDATE member_invites SET created_at = ? WHERE inviter_id = ?').bind(Date.now() - INVITE_WINDOW_MS - 1000, sam.id).run();
    expect((await send(sam, 'd@example.com')).isError).toBe(false);
  });

  it('allows 5 unused invitations at most, even when the 30-day count would allow more', async () => {
    const sam = await active();
    for (let i = 0; i < 5; i++) await env.DB.prepare("INSERT INTO users (id, email, status, created_at, invited_by) VALUES (?, ?, 'invited', ?, ?)").bind(`u${i}`, `u${i}@example.com`, Date.now(), sam.id).run();
    const r = await send(sam, 'z@example.com');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('5 invitations nobody has used');
    expect(await findUserByEmail(env.DB, 'z@example.com')).toBeNull();
    expect(await logRows(sam.id)).toBe(0);
  });

  it('decides the limits in the database, so parallel sends cannot get past them', async () => {
    // The Worker's statements run one at a time in D1; these are the two conditional inserts a send makes.
    const sam = await active();
    const now = Date.now();
    const logs = await Promise.all([1, 2, 3, 4, 5].map(() => reserveInvite(env.DB, sam.id, now)));
    expect(logs.filter(Boolean)).toHaveLength(3);
    expect(await logRows(sam.id)).toBe(3);
    const people = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => insertInvitee(env.DB, sam.id, `p${i}@example.com`, now)));
    expect(people.filter(Boolean)).toHaveLength(5);
    // Two senders racing for one address: one row, the other is told it exists.
    const kim = await active('kim@example.com');
    const same = await Promise.all([insertInvitee(env.DB, kim.id, 'same@example.com', now), insertInvitee(env.DB, sam.id, 'same@example.com', now)]);
    expect(same.filter(Boolean)).toHaveLength(1);
  });
});

describe('addresses that are already people', () => {
  it('answers the same, sends nothing, and still uses one of the 3', async () => {
    const sam = await active();
    await signedInUser(env, 'already@example.com');
    await inviteUser(env.DB, 'owner-added@example.com');
    const fresh = (await send(sam, 'fresh@example.com')).data;
    const a = (await send(sam, 'already@example.com')).data;
    const b = (await send(sam, 'owner-added@example.com')).data;
    expect({ ...a, email: '', invitationsLeft: 0 }).toEqual({ ...fresh, email: '', invitationsLeft: 0 });
    expect({ ...b, email: '', invitationsLeft: 0 }).toEqual({ ...fresh, email: '', invitationsLeft: 0 });
    expect([fresh.invitationsLeft, a.invitationsLeft, b.invitationsLeft]).toEqual([2, 1, 0]);
    expect(sent.map((m) => m.to)).toEqual(['fresh@example.com']);
    // Only the new one is theirs.
    expect((await findUserByEmail(env.DB, 'already@example.com'))!.invited_by).toBeNull();
    const list = await call(await as(sam), 'invite_friend', { action: 'list' });
    expect((list.data.invited as { email: string }[]).map((p) => p.email)).toEqual(['fresh@example.com']);
  });

  it('invites an address waiting at the request form and removes the request', async () => {
    const sam = await active();
    await addInviteRequest(env.DB, { email: 'asked@example.com', platform: 'web', ip: 'x', now: Date.now() });
    const r = await send(sam, 'asked@example.com');
    expect(r.isError).toBe(false);
    expect(await listInviteRequests(env.DB)).toEqual([]);
    expect((await findUserByEmail(env.DB, 'asked@example.com'))!.invited_by).toBe(sam.id);
    const list = await call(await as(sam), 'invite_friend', { action: 'list' });
    expect((list.data.invited as { email: string }[]).map((p) => p.email)).toEqual(['asked@example.com']);
  });
});

describe('the email', () => {
  it('names the inviter and explains the rest, with nothing the inviter wrote', async () => {
    const sam = await active();
    await send(sam, 'ana@example.com');
    const m = sent[0]!;
    const until = new Date(Date.now() + INVITE_TTL_MS).toISOString().slice(0, 10);
    for (const body of [m.text, m.html]) {
      expect(body).toContain('sam@example.com');
      expect(body).toContain(`${ORIGIN}/mcp`);
      expect(body).toContain(`${ORIGIN}/privacy`);
      expect(body).toContain('ask@fitwell.test');
      expect(body).toContain('Set up my Fitwell profile');
      expect(body).toContain('one-off');
      expect(body).toContain('no reminders');
      expect(body).toContain(until);
    }
    const links = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
    expect(links).toEqual([`${ORIGIN}/privacy`]);
  });

  it('does not keep the invitation, or count it, when the email fails', async () => {
    const sam = await active();
    failMail = true;
    const r = await send(sam, 'ana@example.com');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('nothing was invited');
    expect(await findUserByEmail(env.DB, 'ana@example.com')).toBeNull();
    expect(await logRows(sam.id)).toBe(0);
    failMail = false;
    expect((await send(sam, 'ana@example.com')).data.invitationsLeft).toBe(2);
  });

  it('says so when this server cannot send email', async () => {
    const sam = await active();
    const r = await call(await connectAs(env, sam, undefined, { ...extra, mailer: undefined }), 'invite_friend', { action: 'send', email: 'ana@example.com' });
    expect(r.isError).toBe(true);
    expect(await logRows(sam.id)).toBe(0);
  });
});

describe('seeing and cancelling', () => {
  it('lists waiting and joined friends and what is left, and cancels a waiting one', async () => {
    const sam = await active();
    await send(sam, 'ana@example.com');
    await send(sam, 'ben@example.com');
    const ben = (await findUserByEmail(env.DB, 'ben@example.com'))!;
    await recordLogin(env.DB, ben.id);
    const client = await as(sam);
    const list = await call(client, 'invite_friend', { action: 'list' });
    expect(list.data).toEqual({
      invited: [
        { email: 'ana@example.com', status: 'waiting', expiresOn: new Date(Date.now() + INVITE_TTL_MS).toISOString().slice(0, 10) },
        { email: 'ben@example.com', status: 'joined' },
      ],
      invitationsLeft: 1,
      unused: 1,
    });
    expect((await call(client, 'invite_friend', { action: 'cancel', email: 'ana@example.com' })).data).toEqual({ email: 'ana@example.com', cancelled: true });
    expect(await findUserByEmail(env.DB, 'ana@example.com')).toBeNull();
    expect((await call(client, 'invite_friend', { action: 'list' })).data.invitationsLeft).toBe(1);
  });

  it('refuses to cancel someone who joined, someone else\'s invitation, or an unknown address in the same words', async () => {
    const sam = await active();
    const kim = await active('kim@example.com');
    await send(kim, 'kims@example.com');
    await send(sam, 'ben@example.com');
    await recordLogin(env.DB, (await findUserByEmail(env.DB, 'ben@example.com'))!.id);
    const client = await as(sam);
    expect((await call(client, 'invite_friend', { action: 'cancel', email: 'ben@example.com' })).text).toContain('already joined');
    const other = await call(client, 'invite_friend', { action: 'cancel', email: 'kims@example.com' });
    const unknown = await call(client, 'invite_friend', { action: 'cancel', email: 'nobody@example.com' });
    expect(other.isError && unknown.isError).toBe(true);
    expect(other.text).toBe(unknown.text);
    expect(await findUserByEmail(env.DB, 'kims@example.com')).not.toBeNull();
  });

  it('lets someone who is not active (yet) list and cancel, never send', async () => {
    const newcomer = await member('new@example.com', 1, []);
    const client = await as(newcomer);
    expect((await call(client, 'invite_friend', { action: 'list' })).data.invited).toEqual([]);
    expect((await call(client, 'invite_friend', { action: 'cancel', email: 'a@example.com' })).isError).toBe(true);
  });
});

describe('expiry', () => {
  it('drops an unused member invitation after 30 days: gone from the list and the unused count, and it deletes the address', async () => {
    const sam = await active();
    await send(sam, 'ana@example.com');
    await env.DB.prepare('UPDATE users SET created_at = ? WHERE email = ?').bind(Date.now() - INVITE_TTL_MS - 1000, 'ana@example.com').run();
    const list = await call(await as(sam), 'invite_friend', { action: 'list' });
    expect(list.data).toMatchObject({ invited: [], unused: 0 });
    expect(await findUserByEmail(env.DB, 'ana@example.com')).toBeNull();
    // The send still counts for 30 days from when it was sent.
    expect(list.data.invitationsLeft).toBe(2);
  });

  it('keeps an owner-added invitation of any age, and a friend who joined', async () => {
    const sam = await active();
    await send(sam, 'ben@example.com');
    await recordLogin(env.DB, (await findUserByEmail(env.DB, 'ben@example.com'))!.id);
    await inviteUser(env.DB, 'old-owner-invite@example.com', undefined, Date.now() - 400 * DAY);
    await env.DB.prepare('UPDATE users SET created_at = ? WHERE email = ?').bind(Date.now() - 90 * DAY, 'ben@example.com').run();
    await pruneExpiredInvitations(env.DB, Date.now());
    expect(await findUserByEmail(env.DB, 'ben@example.com')).not.toBeNull();
    expect(await findUserByEmail(env.DB, 'old-owner-invite@example.com')).not.toBeNull();
  });

  it('refuses to sign an expired invitation in, and an unexpired one gets its code', async () => {
    const sam = await active();
    await send(sam, 'ana@example.com');
    await send(sam, 'ben@example.com');
    await env.DB.prepare('UPDATE users SET created_at = ? WHERE email = ?').bind(Date.now() - INVITE_TTL_MS - 1000, 'ana@example.com').run();
    const clientId = ((await (await worker.fetch(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }) }), env, ctx)).json()) as { client_id: string }).client_id;
    const signIn = async (email: string) => {
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', scope: 'fitwell', state: 's', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: `${ORIGIN}/mcp` });
      const page = await (await worker.fetch(new Request(`${ORIGIN}/authorize?${q}`, { headers: { 'cf-connecting-ip': '203.0.113.7' } }), env, ctx)).text();
      const handle = page.match(/name="handle" value="([^"]+)"/)![1]!;
      await worker.fetch(new Request(`${ORIGIN}/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.7' }, body: new URLSearchParams({ step: 'email', handle, email, consent: 'yes' }) }), env, ctx);
    };
    await signIn('ana@example.com');
    expect(signInMails).toHaveLength(0);
    await signIn('ben@example.com');
    expect(signInMails.map((m) => m.to)).toEqual(['ben@example.com']);
  });
});

describe('the owner', () => {
  it('sees who invited whom and how many invitations each person sent, and can remove an unused one', async () => {
    const owner = await signedInUser(env, 'owner@example.com');
    const sam = await active();
    await send(sam, 'ana@example.com');
    await send(sam, 'ben@example.com');
    await inviteUser(env.DB, 'added@example.com');
    const client = await as(owner, true);
    const people = (await call(client, 'manage_invites', { action: 'list' })).data.people as { email: string; invitedBy: string | null; invitesLast30Days: number }[];
    const by = Object.fromEntries(people.map((p) => [p.email, p]));
    expect(by['ana@example.com']).toMatchObject({ invitedBy: 'sam@example.com', invitesLast30Days: 0 });
    expect(by['sam@example.com']).toMatchObject({ invitedBy: null, invitesLast30Days: 2 });
    expect(by['added@example.com']).toMatchObject({ invitedBy: null, invitesLast30Days: 0 });
    expect((await call(client, 'manage_invites', { action: 'remove', email: 'ana@example.com' })).data.removed).toBe(true);
    expect(await logRows(sam.id)).toBe(2);
    expect((await call(await as(sam), 'invite_friend', { action: 'list' })).data.invitationsLeft).toBe(1);
  });
});

describe('request form', () => {
  it('deletes expired member invitations when a request is posted', async () => {
    const sam = await active();
    await send(sam, 'ana@example.com');
    await env.DB.prepare('UPDATE users SET created_at = ? WHERE email = ?').bind(Date.now() - INVITE_TTL_MS - 1000, 'ana@example.com').run();
    await handleRequestAccess(
      new Request(`${ORIGIN}/request-access`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9' }, body: new URLSearchParams({ email: 'someone@example.com', consent: 'yes', website: '' }) }),
      { db: env.DB },
    );
    expect(await findUserByEmail(env.DB, 'ana@example.com')).toBeNull();
  });
});

describe('export, delete and the privacy notice', () => {
  it('exports the invitations a person sent, and who invited an invited person', async () => {
    const sam = await active();
    await send(sam, 'ana@example.com');
    await send(sam, 'ben@example.com');
    const ben = (await findUserByEmail(env.DB, 'ben@example.com'))!;
    await recordLogin(env.DB, ben.id);
    const mine = (await call(await as(sam), 'export_my_data')).data;
    expect(mine.invitedBy).toBeNull();
    expect((mine.invitationsSent as { email: string; status: string }[]).map((p) => [p.email, p.status])).toEqual([['ana@example.com', 'waiting'], ['ben@example.com', 'joined']]);
    expect((await call(await as((await findUserByEmail(env.DB, 'ben@example.com'))!), 'export_my_data')).data.invitedBy).toBe('sam@example.com');
  });

  it('removes unused invitations and the log with the inviter, keeps joined friends, and clears who invited them', async () => {
    const sam = await active();
    await send(sam, 'ana@example.com');
    await send(sam, 'ben@example.com');
    await recordLogin(env.DB, (await findUserByEmail(env.DB, 'ben@example.com'))!.id);
    await deleteUser(env.DB, sam);
    expect(await findUserByEmail(env.DB, 'ana@example.com')).toBeNull();
    expect(await findUserByEmail(env.DB, 'ben@example.com')).toMatchObject({ status: 'active', invited_by: null });
    expect(await logRows(sam.id)).toBe(0);
  });

  it('lets a friend who deleted their account leave the list while the inviter keeps their count', async () => {
    const sam = await active();
    await send(sam, 'ben@example.com');
    const ben = (await findUserByEmail(env.DB, 'ben@example.com'))!;
    await recordLogin(env.DB, ben.id);
    await deleteUser(env.DB, ben);
    const list = await call(await as(sam), 'invite_friend', { action: 'list' });
    expect(list.data).toMatchObject({ invited: [], invitationsLeft: 2 });
  });

  it('says in the privacy notice what is kept for an invitation', () => {
    const text = privacyBody('privacy@fitwell.test').replace(/<[^>]+>/g, ' ');
    expect(text).toContain('invites a friend');
    expect(text).toContain('who invited them');
    expect(text).toContain('30 days');
    expect(text).toContain("shows the inviter's email address");
  });
});
