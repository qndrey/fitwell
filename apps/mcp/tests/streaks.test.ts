// get_streaks (F2): the engine fed from stored rows, the achievements it records, the goal weight's start day, export and delete.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { todayIn } from '../src/data/time';
import { deleteUser, type User } from '../src/data/users';
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

const today = todayIn('Europe/Copenhagen'); // the default time zone of a new profile
const logFood = (day: string) => call(client, 'log_food', { day, items: [{ food_id: 'frida:59', grams: 300 }] });
const streaks = async () => (await call(client, 'get_streaks')).data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async () => (await env.DB.prepare('SELECT kind, threshold, achieved_at, celebrated_at FROM achievements WHERE user_id = ? ORDER BY kind, threshold').bind(ana.id).all<Record<string, unknown>>()).results;

describe('get_streaks', () => {
  it('answers for a new account with zeros, the reason no_target and the first milestone', async () => {
    const s = await streaks();
    expect(s.asOf).toBe(today);
    expect(s.training).toEqual({ status: 'none', reason: 'no_target' });
    expect(s.proteinDays).toEqual({ status: 'none', reason: 'no_target' });
    expect(s.weightGoal).toEqual({ status: 'none', reason: 'no_target' });
    expect(s.loggingDays).toMatchObject({ unit: 'day', current: 0, startedOn: null, next: { threshold: 1, remaining: 1 } });
    expect(s.newAchievements).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('counts logged days up to today and records each milestone once', async () => {
    for (const back of [2, 1, 0]) await logFood(addDays(today, -back));
    const first = await streaks();
    expect(first.loggingDays).toMatchObject({ current: 3, startedOn: addDays(today, -2), running: { done: 1, target: 1, met: true }, next: { threshold: 5, remaining: 2 } });
    expect(first.loggingDays.milestones).toEqual([
      { threshold: 1, day: addDays(today, -2) }, { threshold: 2, day: addDays(today, -1) }, { threshold: 3, day: today },
    ]);
    expect(first.newAchievements).toHaveLength(3);
    expect(await rows()).toEqual([
      { kind: 'logging_days', threshold: 1, achieved_at: addDays(today, -2), celebrated_at: null },
      { kind: 'logging_days', threshold: 2, achieved_at: addDays(today, -1), celebrated_at: null },
      { kind: 'logging_days', threshold: 3, achieved_at: today, celebrated_at: null },
    ]);
    // Asking again records nothing new and keeps the first day.
    expect((await streaks()).newAchievements).toEqual([]);
    expect(await rows()).toHaveLength(3);
  });

  it('counts a weekly training target from finished cardio and sessions, and the week in progress', async () => {
    await call(client, 'update_profile', { weight_kg: 80 });
    await call(client, 'set_goals', { workouts_per_week: 2 });
    const monday = weekStart(today);
    for (const week of [-14, -7]) {
      await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day: addDays(monday, week) });
      await call(client, 'log_session', { category: 'pilates', duration_min: 45, day: addDays(monday, week + 1) });
    }
    const t = (await streaks()).training;
    expect(t.status).toBe('ok');
    expect(t.streak).toMatchObject({ unit: 'week', current: 2, startedOn: addDays(monday, -14), running: { done: 0, target: 2, met: false }, next: { threshold: 3, remaining: 1 } });
    expect(t.streak.milestones).toEqual([{ threshold: 1, day: addDays(monday, -13) }, { threshold: 2, day: addDays(monday, -6) }]);
    expect((await rows()).map((r) => `${r.kind}:${r.threshold}`)).toEqual(expect.arrayContaining(['training_weeks:1', 'training_weeks:2']));
  });

  it('is mentioned in get_progress as of today, recording nothing, and left out for an earlier period', async () => {
    await logFood(today);
    const p = (await call(client, 'get_progress', { days: 30 })).data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.streaks).toMatchObject({ training: null, proteinDays: null, loggingDays: { unit: 'day', current: 1, best: 1, next: { threshold: 2, remaining: 1 } }, weightGoal: { status: 'none', reason: 'no_target' } });
    expect(await rows()).toEqual([]);
    expect(((await call(client, 'get_progress', { days: 30, to: addDays(today, -1) })).data as Record<string, unknown>).streaks).toBeUndefined();
  });

  it('follows the weekly review for Claude, and leaves the view data alone', async () => {
    await logFood(today);
    const r = await call(client, 'show_weekly_review', {});
    expect(r.text).toContain('Streaks as of today: {');
    expect(r.text).toContain('"loggingDays":{"unit":"day","current":1');
    expect(Object.keys(r.data)).toEqual(['review']);
  });

  it('is not read-only but not destructive either', async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'get_streaks');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  });
});

describe('the goal weight start day', () => {
  const since = async () => (await env.DB.prepare('SELECT goal_weight_since AS d FROM goals WHERE user_id = ?').bind(ana.id).first<{ d: string | null }>())?.d ?? null;

  it('is the day the goal weight was set, kept when other goals change or the same weight is saved again, and cleared with it', async () => {
    await call(client, 'set_goals', { kcal: 2200 });
    expect(await since()).toBeNull();
    await call(client, 'set_goals', { goal_weight_kg: 75 });
    expect(await since()).toBe(today);
    await env.DB.prepare('UPDATE goals SET goal_weight_since = ? WHERE user_id = ?').bind('2026-01-05', ana.id).run();
    await call(client, 'set_goals', { kcal: 2300, goal_weight_kg: 75 });
    expect(await since()).toBe('2026-01-05');
    await call(client, 'set_goals', { goal_weight_kg: 72 });
    expect(await since()).toBe(today);
    await call(client, 'set_goals', { goal_weight_kg: null });
    expect(await since()).toBeNull();
  });

  it('starts the weight goal from that day: weigh-ins before it do not count', async () => {
    for (let i = 20; i >= 0; i--) await call(client, 'log_body', { day: addDays(today, -i), weight_kg: 80 });
    await call(client, 'set_goals', { goal_weight_kg: 75 });
    expect((await streaks()).weightGoal).toMatchObject({ status: 'not_reached', direction: 'lose' });
  });
});

describe('export and delete', () => {
  it('exports the achievements and erases them with the account', async () => {
    await logFood(today);
    await streaks();
    const exported = (await call(client, 'export_my_data')).data as { achievements: { kind: string; threshold: number; achievedAt: string; celebratedAt: number | null }[] };
    expect(exported.achievements).toEqual([{ kind: 'logging_days', threshold: 1, achievedAt: today, celebratedAt: null }]);
    await deleteUser(env.DB, ana);
    expect(await rows()).toEqual([]);
  });
});
