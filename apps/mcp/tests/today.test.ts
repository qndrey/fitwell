// The Today view (D3): the day so far against goals, today's planned meals, foods to log again, water and steps, today's training, and the one-tap actions.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TodayView } from '../src/analytics/todayTypes';
import { todayIn } from '../src/data/time';
import type { User } from '../src/data/users';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const today = todayIn('Europe/Copenhagen'); // the default time zone of a new profile
const RYE = 'frida:413'; // 209 kcal and 5.8 g protein per 100 g
const OATS = 'frida:59';

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
});

const view = async (c: Client = client) => ((await call(c, 'show_today')).data as unknown as { today: TodayView }).today;
const fresh = (r: Awaited<ReturnType<typeof call>>) => (r.data as unknown as { today: TodayView }).today;
const food = (day: string, food_id = RYE, grams = 100) => call(client, 'log_food', { day, items: [{ food_id, grams }] });

describe('show_today', () => {
  it('works for an account with nothing: no goals, no plan, nothing to log again, no suggestion', async () => {
    const t = await view();
    expect(t).toMatchObject({ day: today, goals: { kcal: null, proteinG: null }, eaten: { kcal: 0 }, remaining: { kcal: null, protein: null }, planned: [], quickAdd: [], waterMl: 0, steps: null, training: { doneToday: [], suggested: null } });
    expect((await call(client, 'show_today')).text).toContain('Today is open.');
  });

  it('shows what is left against the goals, and negative when over', async () => {
    await call(client, 'set_goals', { kcal: 2000, protein_g: 120 });
    await food(today, RYE, 500); // 1045 kcal, 29 g protein
    expect(await view()).toMatchObject({ goals: { kcal: 2000, proteinG: 120 }, eaten: { kcal: 1045 }, remaining: { kcal: 955, protein: 91 } });
    expect((await call(client, 'show_today')).text).toContain('955 kcal left');
    await food(today, RYE, 800);
    const over = await view();
    expect(over.remaining.kcal).toBe(-717);
    expect((await call(client, 'show_today')).text).toContain('717 kcal over');
  });

  it('is read-only, and the one-tap tools are for the view, not for Claude', async () => {
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === 'show_today')?.annotations).toMatchObject({ readOnlyHint: true });
    for (const name of ['get_today_data', 'today_eat_planned', 'today_quick_add', 'today_add_water']) {
      expect((tools.find((t) => t.name === name)?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility, name).toEqual(['app']);
    }
  });

  it('shows only the person\'s own day', async () => {
    const bo = await signedInUser(env, 'bo@example.com');
    const boC = await connectAs(env, bo);
    await call(boC, 'log_food', { day: today, items: [{ food_id: RYE, grams: 300 }] });
    expect((await view()).eaten.kcal).toBe(0);
    expect((await view(boC)).eaten.kcal).toBe(627);
  });
});

describe('planned meals', () => {
  const plan = (items: Record<string, unknown>[]) => call(client, 'save_meal_plan', { week_start: weekStart(today), items });

  it('lists today\'s planned meals by meal, logs one on a tap with the planned amounts, and says so', async () => {
    await plan([
      { day: today, slot: 'breakfast', food_id: OATS, grams: 80 },
      { day: today, slot: 'lunch', food_id: RYE, grams: 120 },
      { day: addDays(today, 1), slot: 'lunch', food_id: RYE, grams: 100 }, // another day: not shown
    ]);
    let t = await view();
    expect(t.planned.map((m) => m.slot)).toEqual(['breakfast', 'lunch']);
    expect(t.planned[1]).toMatchObject({ kcal: 251, allLogged: false, items: [{ logged: false }] });
    t = fresh(await call(client, 'today_eat_planned', { slot: 'lunch' }));
    expect(t.eaten.kcal).toBe(251);
    expect(t.planned.find((m) => m.slot === 'lunch')).toMatchObject({ allLogged: true });
    expect(t.planned.find((m) => m.slot === 'breakfast')).toMatchObject({ allLogged: false });
    const log = (await call(client, 'get_food_log', { day: today })).data as { entries: { slot: string; grams: number }[] };
    expect(log.entries).toMatchObject([{ slot: 'lunch', grams: 120 }]);
  });

  it('a meal is logged once: a second tap, or a meal that is not planned, is refused and nothing is added', async () => {
    await plan([{ day: today, slot: 'lunch', food_id: RYE, grams: 100 }]);
    await call(client, 'today_eat_planned', { slot: 'lunch' });
    expect((await call(client, 'today_eat_planned', { slot: 'lunch' })).isError).toBe(true);
    expect((await call(client, 'today_eat_planned', { slot: 'dinner' })).isError).toBe(true);
    expect((await view()).eaten.kcal).toBe(209);
  });

  it('refuses without a plan for the week', async () => {
    const r = await call(client, 'today_eat_planned', { slot: 'lunch' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No meal plan');
  });
});

describe('log again', () => {
  it('suggests foods eaten at least twice lately, each as its latest entry, and copies one into today in one tap', async () => {
    await food(addDays(today, -3), OATS, 80);
    await food(addDays(today, -2), OATS, 90);
    await food(addDays(today, -2), RYE, 100); // once: not suggested
    const t = await view();
    expect(t.quickAdd).toHaveLength(1);
    expect(t.quickAdd[0]).toMatchObject({ name: expect.stringMatching(/oats/i), grams: 90 });
    const after = fresh(await call(client, 'today_quick_add', { entry_id: t.quickAdd[0]!.entryId }));
    expect(after.eaten.kcal).toBeGreaterThan(0);
    const log = (await call(client, 'get_food_log', { day: today })).data as { entries: { slot: string; grams: number; food: string }[] };
    expect(log.entries).toMatchObject([{ slot: after.slot, grams: 90 }]);
    expect(log.entries[0]!.food).toMatch(/oats/i);
  });

  it('keeps the range of a meal out when it is logged again in one tap, and shows it', async () => {
    const meal = { name: 'Pasta at Luigi', grams: 450, estimate_range: { kcal_low: 600, kcal_high: 900, protein_g: 30, carbs_g: 85, fat_g: 35 } };
    await call(client, 'log_food', { day: addDays(today, -3), items: [meal] });
    await call(client, 'log_food', { day: addDays(today, -2), items: [meal] });
    const t = await view();
    expect(t.quickAdd[0]).toMatchObject({ name: 'Pasta at Luigi', kcal: 750, estimated: true, kcalRange: { low: 600, high: 900 } });
    await call(client, 'today_quick_add', { entry_id: t.quickAdd[0]!.entryId });
    const log = (await call(client, 'get_food_log', { day: today })).data as { entries: { kcal: number; estimated?: boolean; kcalRange?: { low: number; high: number } }[] };
    expect(log.entries).toMatchObject([{ kcal: 750, estimated: true, kcalRange: { low: 600, high: 900 } }]);
  });

  it('never suggests or logs something that matches an allergy word, and cannot copy another person\'s entry', async () => {
    await food(addDays(today, -3), OATS, 80);
    await food(addDays(today, -2), OATS, 90);
    const entryId = (await view()).quickAdd[0]!.entryId;
    await call(client, 'update_profile', { diet: { allergies: ['oats'] } });
    expect((await view()).quickAdd).toEqual([]);
    const refused = await call(client, 'today_quick_add', { entry_id: entryId });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('allergy');
    const bo = await signedInUser(env, 'bo@example.com');
    const boC = await connectAs(env, bo);
    expect((await call(boC, 'today_quick_add', { entry_id: entryId })).isError).toBe(true); // Ana's entry, not Bo's
    expect((await view(boC)).eaten.kcal).toBe(0);
    expect((await call(client, 'today_quick_add', { entry_id: 'nope' })).isError).toBe(true);
  });
});

describe('water, steps and training', () => {
  it('adds water a glass at a time, shows steps, and refuses a silly amount', async () => {
    await call(client, 'log_body', { day: today, steps: 8200 });
    expect(fresh(await call(client, 'today_add_water', { ml: 250 }))).toMatchObject({ waterMl: 250, steps: 8200 });
    expect(fresh(await call(client, 'today_add_water', { ml: 500 })).waterMl).toBe(750);
    expect((await call(client, 'today_add_water', { ml: 100000 })).isError).toBe(true);
    expect((await view()).waterMl).toBe(750);
  });

  it('shows the water goal, clears it with null, and refuses a silly one', async () => {
    expect((await view()).waterGoalMl).toBeNull();
    await call(client, 'set_goals', { water_ml: 2500 });
    await call(client, 'today_add_water', { ml: 500 });
    expect(await view()).toMatchObject({ waterMl: 500, waterGoalMl: 2500 });
    expect((await call(client, 'set_goals', { water_ml: 50 })).isError).toBe(true);
    expect((await call(client, 'set_goals', { kcal: 2000 })).data).toMatchObject({ goals: { waterMl: 2500 } }); // other goals leave it alone
    await call(client, 'set_goals', { water_ml: null });
    expect((await view()).waterGoalMl).toBeNull();
  });

  it('get_progress counts the days the water goal was met', async () => {
    await call(client, 'set_goals', { water_ml: 2000 });
    await call(client, 'log_body', { day: today, water_ml: 2200 });
    await call(client, 'log_body', { day: addDays(today, -1), water_ml: 1200 });
    const p = (await call(client, 'get_progress', { days: 7 })).data as unknown as { dailyMetrics?: { waterGoalMl: number; waterDaysMet: number } };
    expect(p.dailyMetrics).toMatchObject({ waterGoalMl: 2000, waterDaysMet: 1 });
  });

  it('shows what was trained today, and suggests the saved workout that has waited longest, not a schedule', async () => {
    await call(client, 'update_profile', { weight_kg: 80 });
    await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day: today });
    const ex = { id: 'ex:Barbell_Squat', sets: 3, reps: 5 };
    await call(client, 'save_workout_template', { name: 'Push day', exercises: [ex] });
    await call(client, 'save_workout_template', { name: 'Leg day', exercises: [ex] });
    await env.DB.prepare("UPDATE workout_templates SET last_used_at = ? WHERE user_id = ? AND name = 'Push day'").bind(Date.now() - 2 * 86_400_000, ana.id).run();
    await env.DB.prepare("UPDATE workout_templates SET last_used_at = ? WHERE user_id = ? AND name = 'Leg day'").bind(Date.now() - 9 * 86_400_000, ana.id).run();
    const t = await view();
    expect(t.training.doneToday).toMatchObject([{ type: 'cardio', minutes: 30 }]);
    expect(t.training.suggested).toEqual({ name: 'Leg day', daysSince: 9 });
    await env.DB.prepare("UPDATE workout_templates SET last_used_at = NULL WHERE user_id = ? AND name = 'Push day'").bind(ana.id).run();
    expect((await view()).training.suggested).toEqual({ name: 'Push day', daysSince: null }); // never done comes first
  });

  it('leaves an unfinished strength workout out of what was done', async () => {
    await env.DB.prepare("INSERT INTO workouts (id, user_id, day, type, name, started_at, finished_at, exercises, created_at, updated_at) VALUES ('w1', ?, ?, 'strength', 'Half done', 1, NULL, '[]', 1, 1)").bind(ana.id, today).run();
    expect((await view()).training.doneToday).toEqual([]);
  });
});
