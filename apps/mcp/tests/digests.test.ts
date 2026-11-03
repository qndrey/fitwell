// Email digests (E1): opt-in only, sent in the person's own evening and once, neutral in tone, with a working unsubscribe, and gone with the account.
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Mail, Mailer } from '../src/auth/mailer';
import { runDigests } from '../src/digests/run';
import { handleUnsubscribe } from '../src/digests/unsubscribe';
import worker from '../src/index';
import { deleteUser, type User } from '../src/data/users';
import { createTestEnv, ctx } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

// Sunday 1 November 2026: Copenhagen is on winter time (UTC+1), New York too (UTC-5 until the night of 1 Nov, 2 am; so 23:30 UTC is 18:30 there).
const SUNDAY_18_30_CPH = Date.parse('2026-11-01T17:30:00Z');
const WEDNESDAY_19_00_CPH = Date.parse('2026-11-04T18:00:00Z');

let env: Env;
let sent: Mail[];
let mailer: Mailer;
let failNext = false;
let ana: User;
let anaC: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  sent = [];
  failNext = false;
  mailer = {
    async send(m) {
      if (failNext) throw new Error('mail is down');
      sent.push(m);
    },
  };
  ana = await signedInUser(env, 'ana@example.com');
  anaC = await connectAs(env, ana);
});

const run = (now: number, skip?: (e: string) => boolean) => runDigests({ db: env.DB, mailer, publicUrl: 'https://mcp.fitwell.test', now: () => now, skip });
const optIn = (c: Client, digests: { weekly_review?: boolean; inactivity_nudge?: boolean }) => call(c, 'update_profile', { email_digests: digests });
const food = (c: Client, day: string) => call(c, 'log_food', { day, items: [{ food_id: 'frida:59', grams: 300 }] });
const logWeek = async (c: Client) => {
  for (const d of ['2026-10-27', '2026-10-28', '2026-10-30']) await food(c, d);
  for (const [d, kg] of [['2026-10-27', 80.4], ['2026-10-29', 80.2], ['2026-10-31', 80.0]] as const) await call(c, 'log_body', { weight_kg: kg, day: d });
  await call(c, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day: '2026-10-29' });
};
const BANNED = /cheat|guilty|\bbad\b|lazy|behind|off track|missed|failed|healthy|great|\bonly\b|stalled|should|\bmust\b|need to|broke|lost/i;

describe('opt-in', () => {
  it('is off for everyone until they ask, shows in get_profile, and nothing is sent without it', async () => {
    await logWeek(anaC);
    expect((await call(anaC, 'get_profile')).data.emailDigests).toEqual({ weeklyReview: false, inactivityNudge: false });
    expect(await run(SUNDAY_18_30_CPH)).toEqual({ weekly: 0, nudge: 0, failed: 0 });
    expect(sent).toEqual([]);
    expect((await optIn(anaC, { weekly_review: true })).data.emailDigests).toEqual({ weeklyReview: true, inactivityNudge: false });
    expect((await call(anaC, 'get_profile')).data.emailDigests).toEqual({ weeklyReview: true, inactivityNudge: false });
    expect((await call(anaC, 'update_profile', { units: 'imperial' })).data.emailDigests).toEqual({ weeklyReview: true, inactivityNudge: false }); // other changes leave it
    expect((await optIn(anaC, { weekly_review: false })).data.emailDigests).toEqual({ weeklyReview: false, inactivityNudge: false });
  });
});

describe('the weekly summary', () => {
  beforeEach(async () => {
    await logWeek(anaC);
    await optIn(anaC, { weekly_review: true });
  });

  it('goes out on Sunday evening in the person\'s time, once, with facts and an unsubscribe link', async () => {
    expect(await run(SUNDAY_18_30_CPH)).toEqual({ weekly: 1, nudge: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe('ana@example.com');
    expect(m.subject).toBe('Your week in Fitwell, 26 Oct to 1 Nov');
    expect(m.text).toContain('Training: 1 workout (1 cardio)');
    expect(m.text).toContain('Food: logged on 3 of 7 days');
    expect(m.text).toContain('Weight: the 7-day average is');
    expect(m.text).toMatch(/Unsubscribe: https:\/\/mcp\.fitwell\.test\/unsubscribe\?u=.+&t=.+&k=weekly/);
    expect(m.html).toContain('Unsubscribe</a>');
    expect(m.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/mcp\.fitwell\.test\/unsubscribe\?u=/);
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(`${m.subject}\n${m.text}`).not.toMatch(BANNED);
    // Once: the same evening again, and the rest of the week, send nothing.
    expect(await run(SUNDAY_18_30_CPH + 20 * 60_000)).toMatchObject({ weekly: 0 });
    expect(await run(SUNDAY_18_30_CPH + 24 * 3_600_000)).toMatchObject({ weekly: 0 });
    expect(sent).toHaveLength(1);
  });

  it('waits for the person\'s own evening: not before, not at night, not on another day, and each time zone in turn', async () => {
    expect((await run(Date.parse('2026-11-01T12:00:00Z'))).weekly).toBe(0); // 13:00 in Copenhagen
    expect((await run(Date.parse('2026-11-01T21:30:00Z'))).weekly).toBe(0); // 22:30
    expect((await run(Date.parse('2026-11-02T17:30:00Z'))).weekly).toBe(0); // Monday evening
    expect(sent).toEqual([]);
    await call(anaC, 'update_profile', { time_zone: 'America/New_York' });
    expect((await run(SUNDAY_18_30_CPH)).weekly).toBe(0); // 12:30 in New York
    expect((await run(Date.parse('2026-11-01T23:30:00Z'))).weekly).toBe(1); // 18:30 there
  });

  it('is sent again next week, and a week with nothing in it sends nothing and is not recorded', async () => {
    await run(SUNDAY_18_30_CPH);
    expect((await run(SUNDAY_18_30_CPH + 7 * 86_400_000)).weekly).toBe(0); // a quiet week: nothing logged in 2 to 8 November
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM digest_log').first<{ n: number }>())!.n).toBe(1);
    await food(anaC, '2026-11-05');
    expect((await run(SUNDAY_18_30_CPH + 7 * 86_400_000 + 3_600_000)).weekly).toBe(1); // the next hour of the evening, now with something to say
  });

  it('is retried by the next run when the email could not be sent', async () => {
    failNext = true;
    expect(await run(SUNDAY_18_30_CPH)).toEqual({ weekly: 0, nudge: 0, failed: 1 });
    expect(sent).toEqual([]);
    failNext = false;
    expect(await run(SUNDAY_18_30_CPH + 3_600_000)).toMatchObject({ weekly: 1, failed: 0 });
  });

  it('never goes to the skipped addresses (the reviewers\' demo account, the local dev person)', async () => {
    expect(await run(SUNDAY_18_30_CPH, (e) => e === 'ana@example.com')).toEqual({ weekly: 0, nudge: 0, failed: 0 });
    expect(sent).toEqual([]);
  });
});

describe('the nudge', () => {
  beforeEach(async () => {
    await food(anaC, '2026-11-01'); // the last log: a Sunday
    await optIn(anaC, { inactivity_nudge: true });
  });

  it('goes out once after 3 quiet days, in the evening, and not again until they log and lapse anew', async () => {
    expect((await run(Date.parse('2026-11-03T18:00:00Z'))).nudge).toBe(0); // 2 days: not yet
    expect((await run(WEDNESDAY_19_00_CPH)).nudge).toBe(1); // Wednesday: 3 days since Sunday
    const m = sent[0]!;
    expect(m.subject).toBe('Fitwell: nothing logged since Sunday');
    expect(m.text).toContain('Nothing logged since Sunday 1 Nov, 3 days ago.');
    expect(m.headers?.['List-Unsubscribe']).toContain('k=nudge');
    expect(`${m.subject}\n${m.text}`).not.toMatch(BANNED);
    expect((await run(WEDNESDAY_19_00_CPH + 24 * 3_600_000)).nudge).toBe(0); // the next day: still the same lapse
    await food(anaC, '2026-11-05');
    expect((await run(Date.parse('2026-11-08T18:00:00Z'))).nudge).toBe(1); // a new lapse after the new last log
    expect(sent).toHaveLength(2);
  });

  it('is not sent to someone who left long ago, nor when it was turned off', async () => {
    expect((await run(Date.parse('2027-01-10T18:00:00Z'))).nudge).toBe(0); // 70 days
    await optIn(anaC, { inactivity_nudge: false });
    expect((await run(WEDNESDAY_19_00_CPH)).nudge).toBe(0);
    expect(sent).toEqual([]);
  });

  it('is not sent to someone who has never logged anything', async () => {
    const bo = await signedInUser(env, 'bo@example.com');
    await optIn(await connectAs(env, bo), { inactivity_nudge: true });
    await run(WEDNESDAY_19_00_CPH);
    expect(sent.map((m) => m.to)).toEqual(['ana@example.com']);
  });
});

describe('unsubscribe', () => {
  const link = async (kind: 'weekly' | 'nudge' | 'all' = 'weekly') => {
    await optIn(anaC, { weekly_review: true, inactivity_nudge: true });
    const row = (await env.DB.prepare('SELECT digest_token FROM profiles WHERE user_id = ?').bind(ana.id).first<{ digest_token: string }>())!;
    return `https://mcp.fitwell.test/unsubscribe?u=${ana.id}&t=${row.digest_token}&k=${kind}`;
  };
  const get = (url: string) => handleUnsubscribe(new Request(url), { db: env.DB });
  const post = (url: string, body = '') => handleUnsubscribe(new Request(url, { method: 'POST', body }), { db: env.DB });
  const settings = async () => (await call(anaC, 'get_profile')).data.emailDigests;

  it('opening the link changes nothing (scanners open links); the button switches that kind off', async () => {
    const url = await link('weekly');
    const page = await get(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<button type="submit">Unsubscribe</button>');
    expect(await settings()).toEqual({ weeklyReview: true, inactivityNudge: true });
    const done = await post(url);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('You are unsubscribed');
    expect(await settings()).toEqual({ weeklyReview: false, inactivityNudge: true });
    expect(await settings()).not.toEqual({ weeklyReview: false, inactivityNudge: false });
    await post(await link('all'));
    expect(await settings()).toEqual({ weeklyReview: false, inactivityNudge: false });
  });

  it('a mail app\'s one-click POST works, and a wrong secret, another person\'s or a missing one does nothing', async () => {
    const url = await link('nudge');
    expect((await post(url, 'List-Unsubscribe=One-Click')).status).toBe(200);
    expect(await settings()).toEqual({ weeklyReview: true, inactivityNudge: false });
    await optIn(anaC, { inactivity_nudge: true });
    const bad = url.replace(/t=[^&]+/, 't=0000');
    expect((await post(bad)).status).toBe(400);
    expect((await post(url.replace(ana.id, 'someone-else'))).status).toBe(400);
    expect((await post('https://mcp.fitwell.test/unsubscribe')).status).toBe(400);
    expect((await get(bad)).status).toBe(400);
    expect(await settings()).toEqual({ weeklyReview: true, inactivityNudge: true });
    expect((await handleUnsubscribe(new Request(url, { method: 'PUT' }), { db: env.DB })).status).toBe(405);
  });

  it('a person who never turned a digest on has no secret to guess', async () => {
    expect((await post(`https://mcp.fitwell.test/unsubscribe?u=${ana.id}&t=&k=all`)).status).toBe(400);
    expect((await post(`https://mcp.fitwell.test/unsubscribe?u=${ana.id}&t=null&k=all`)).status).toBe(400);
  });
});

describe('the cron when the database is not ready', () => {
  it('says so and stops with one failure instead of throwing every hour (for example before the migration is applied)', async () => {
    const broken = { prepare() { throw new Error('no such column: p.digest_weekly'); } } as unknown as D1Database;
    expect(await runDigests({ db: broken, mailer, publicUrl: 'https://mcp.fitwell.test', now: () => SUNDAY_18_30_CPH })).toEqual({ weekly: 0, nudge: 0, failed: 1 });
    expect(sent).toEqual([]);
  });
});

describe('the account', () => {
  it('exports the settings and erases the log with the account; the cron entry point runs', async () => {
    await logWeek(anaC);
    await optIn(anaC, { weekly_review: true });
    await run(SUNDAY_18_30_CPH);
    expect(((await call(anaC, 'export_my_data')).data as { emailDigests: unknown }).emailDigests).toEqual({ weeklyReview: true, inactivityNudge: false });
    await deleteUser(env.DB, ana);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM digest_log').first<{ n: number }>())!.n).toBe(0);
    await expect(worker.scheduled!({ cron: '0 * * * *', scheduledTime: Date.now(), type: 'scheduled', noRetry() {} } as unknown as ScheduledController, env, ctx)).resolves.toBeUndefined();
  });
});
