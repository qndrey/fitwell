import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findUser, type User } from '../src/data/users';
import { slotAt, todayIn } from '../src/data/time';
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

type Entry = { id: string; food: string; grams: number; kcal: number; protein: number; estimated?: boolean; foodId?: string; slot: string; day: string };

describe('food log', () => {
  it('logs Frida foods with macros from the database and returns the day totals', async () => {
    const { data, isError } = await call(client, 'log_food', {
      day: '2026-10-13',
      slot: 'breakfast',
      items: [
        { food_id: 'frida:413', grams: 150 }, // rye bread, light: 209 kcal, 5.8 g protein per 100 g
        { food_id: 'frida:413', grams: 50 },
      ],
    });
    expect(isError).toBe(false);
    const logged = data.logged as Entry[];
    expect(logged[0]).toMatchObject({ food: 'Rye bread, light', grams: 150, kcal: 314, protein: 8.7, foodId: 'frida:413', slot: 'breakfast' });
    expect(data.totals).toMatchObject({ kcal: 418, protein: 11.6 });
    expect(data.remaining).toBeUndefined(); // no goals yet
  });

  it('logs nothing when one id is unknown', async () => {
    const { isError, text } = await call(client, 'log_food', { items: [{ food_id: 'frida:413', grams: 100 }, { food_id: 'frida:999999', grams: 10 }] });
    expect(isError).toBe(true);
    expect(text).toContain('frida:999999');
    expect(((await call(client, 'get_food_log', {})).data.entries as Entry[]).length).toBe(0);
  });

  it('stores an estimate only when marked as one, and needs a name and values for it', async () => {
    const bad = await call(client, 'log_food', { items: [{ grams: 100 }] });
    expect(bad.isError).toBe(true);
    const { data } = await call(client, 'log_food', { day: '2026-10-13', items: [{ name: "Grandma's stew", grams: 300, estimate_per100g: { kcal: 120, protein: 8, carbs: 10, fat: 5 } }] });
    expect((data.logged as Entry[])[0]).toMatchObject({ food: "Grandma's stew", kcal: 360, estimated: true });
  });

  it('defaults to today and the meal of the hour in the person’s time zone', async () => {
    const { data } = await call(client, 'log_food', { items: [{ food_id: 'frida:413', grams: 100 }] });
    const e = (data.logged as Entry[])[0]!;
    expect(e.day).toBe(todayIn('Europe/Copenhagen'));
    expect(['breakfast', 'lunch', 'dinner', 'snacks']).toContain(e.slot);
  });

  it('edits grams (rescaling nutrition), moves and deletes entries', async () => {
    const { data } = await call(client, 'log_food', { day: '2026-10-13', slot: 'lunch', items: [{ food_id: 'frida:413', grams: 100 }] });
    const id = (data.logged as Entry[])[0]!.id;
    const edited = await call(client, 'edit_food_entry', { id, grams: 200, slot: 'dinner' });
    expect(edited.data.updated).toMatchObject({ grams: 200, kcal: 418, slot: 'dinner' });
    expect((await call(client, 'delete_item', { kind: 'food_entry', id })).data.deleted).toEqual({ kind: 'food_entry', id });
    expect((await call(client, 'delete_item', { kind: 'food_entry', id })).isError).toBe(true);
  });

  it('saves own foods, finds them first in search and logs them', async () => {
    const saved = await call(client, 'save_custom_food', { name: 'Protein oats', brand: 'Home', per100g: { kcal: 380, protein: 25, carbs: 50, fat: 7 }, portions: [{ label: 'bowl', grams: 80 }] });
    const id = (saved.data.food as { id: string }).id;
    expect(id).toMatch(/^custom:/);
    const found = await call(client, 'search_foods', { query: 'oats' });
    expect((found.data.foods as { id: string }[])[0]!.id).toBe(id);
    const logged = await call(client, 'log_food', { day: '2026-10-13', items: [{ food_id: id, grams: 80 }] });
    expect((logged.data.logged as Entry[])[0]).toMatchObject({ food: 'Protein oats', kcal: 304, protein: 20 });
  });

  it('summarises several days with averages over logged days', async () => {
    await call(client, 'log_food', { day: '2026-10-11', items: [{ food_id: 'frida:413', grams: 100 }] });
    await call(client, 'log_food', { day: '2026-10-13', items: [{ food_id: 'frida:413', grams: 300 }] });
    const { data } = await call(client, 'get_food_log', { day: '2026-10-13', days: 7 });
    expect(data.from).toBe('2026-10-07');
    expect(data.daysLogged).toBe(2);
    expect(data.averagePerLoggedDay).toMatchObject({ kcal: 418 });
  });
});

describe('profile and goals', () => {
  it('needs body data before suggesting targets, then suggests without saving', async () => {
    const missing = await call(client, 'suggest_targets', { goal: 'lose' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('birth_year');
    await call(client, 'update_profile', { sex: 'male', birth_year: 1990, height_cm: 180, weight_kg: 80, activity_level: 'moderate', diet: { allergies: ['peanuts'] } });
    const { data } = await call(client, 'suggest_targets', { goal: 'maintain' });
    expect((data.targets as { kcal: number }).kcal).toBeGreaterThan(2000);
    expect((await call(client, 'get_profile', {})).data.goals).toBeNull();
  });

  it('keeps unrelated profile fields and diet lists when updating others', async () => {
    await call(client, 'update_profile', { diet: { allergies: ['peanuts'], preferences: ['high protein'] }, equipment: ['barbell'] });
    await call(client, 'update_profile', { diet: { dislikes: ['olives'] }, time_zone: 'Europe/Berlin' });
    const p = (await call(client, 'get_profile', {})).data.profile as { timeZone: string; equipment: string[]; diet: Record<string, string[]> };
    expect(p).toMatchObject({ timeZone: 'Europe/Berlin', equipment: ['barbell'], diet: { allergies: ['peanuts'], preferences: ['high protein'], dislikes: ['olives'] } });
    expect((await call(client, 'update_profile', { time_zone: 'Mars/Olympus' })).isError).toBe(true);
  });

  it('saves goals, flags macros that do not add up, and shows what remains for the day', async () => {
    const { data } = await call(client, 'set_goals', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 67 });
    expect(data.note).toBeUndefined(); // 600 + 800 + 603 ≈ 2000
    const off = await call(client, 'set_goals', { fat_g: 120 });
    expect(off.data.note).toContain('add up');
    await call(client, 'log_food', { day: '2026-10-13', items: [{ food_id: 'frida:413', grams: 100 }] });
    const day = await call(client, 'get_food_log', { day: '2026-10-13' });
    expect(day.data.remaining).toMatchObject({ kcal: 1791, protein: 144 });
  });
});

describe('privacy', () => {
  it('never shows one person another person’s data', async () => {
    const bo = await signedInUser(env, 'bo@example.com');
    const boClient = await connectAs(env, bo);
    const { data } = await call(client, 'log_food', { day: '2026-10-13', items: [{ food_id: 'frida:413', grams: 100 }] });
    const anaEntry = (data.logged as Entry[])[0]!.id;
    await call(client, 'save_custom_food', { name: 'Ana secret recipe', per100g: { kcal: 120, protein: 3, carbs: 20, fat: 3 } });
    await call(client, 'set_goals', { kcal: 1800 });

    expect(((await call(boClient, 'get_food_log', { day: '2026-10-13' })).data.entries as Entry[]).length).toBe(0);
    expect((await call(boClient, 'edit_food_entry', { id: anaEntry, grams: 1 })).isError).toBe(true);
    expect((await call(boClient, 'delete_item', { kind: 'food_entry', id: anaEntry })).isError).toBe(true);
    expect(JSON.stringify((await call(boClient, 'search_foods', { query: 'secret recipe' })).data)).not.toContain('Ana secret');
    const exported = (await call(boClient, 'export_my_data', {})).data;
    expect(exported.foodEntries).toEqual([]);
    expect(exported.goals).toBeNull();
    // Ana's entry is untouched.
    expect(((await call(client, 'get_food_log', { day: '2026-10-13' })).data.entries as Entry[])[0]!.grams).toBe(100);
  });

  it('exports everything and deletes the account only with the exact confirmation', async () => {
    await call(client, 'log_food', { day: '2026-10-13', items: [{ food_id: 'frida:413', grams: 100 }] });
    const exported = (await call(client, 'export_my_data', {})).data;
    expect(exported).toMatchObject({ email: 'ana@example.com' });
    expect((exported.foodEntries as Entry[]).length).toBe(1);

    expect((await call(client, 'delete_my_account', { confirm: 'yes' })).isError).toBe(true);
    expect(await findUser(env.DB, ana.id)).not.toBeNull();
    expect((await call(client, 'delete_my_account', { confirm: 'delete my account' })).data.deleted).toBe(true);
    expect(await findUser(env.DB, ana.id)).toBeNull();
    const left = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM food_entries) + (SELECT COUNT(*) FROM profiles) + (SELECT COUNT(*) FROM login_requests) AS n').first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});

describe('time', () => {
  it('works out the local day and meal', () => {
    const t = new Date('2026-10-13T22:30:00Z'); // 00:30 next day in Copenhagen (CEST, UTC+2)
    expect(todayIn('Europe/Copenhagen', t)).toBe('2026-10-14');
    expect(slotAt('Europe/Copenhagen', new Date('2026-10-13T06:00:00Z'))).toBe('breakfast');
    expect(slotAt('Europe/Copenhagen', new Date('2026-10-13T11:00:00Z'))).toBe('lunch');
    expect(slotAt('Europe/Copenhagen', new Date('2026-10-13T17:00:00Z'))).toBe('dinner');
    expect(slotAt('Europe/Copenhagen', new Date('2026-10-13T20:00:00Z'))).toBe('snacks');
  });
});

vi.setConfig({ testTimeout: 20_000 });
