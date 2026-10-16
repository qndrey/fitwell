import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../src/data/users';
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

const RYE = 'frida:413'; // 209 kcal and 5.8 g protein per 100 g
type Logged = { food: string; slot: string; grams: number; kcal: number; foodId?: string; estimated?: boolean }[];

describe('quicker logging', () => {
  it('copies one meal, or a whole day, from another day', async () => {
    await call(client, 'log_food', { day: '2026-10-12', slot: 'breakfast', items: [{ food_id: RYE, grams: 100 }, { name: 'Home jam', grams: 20, estimate_per100g: { kcal: 250, protein: 0, carbs: 60, fat: 0 } }] });
    await call(client, 'log_food', { day: '2026-10-12', slot: 'dinner', items: [{ food_id: RYE, grams: 200 }] });

    const breakfast = await call(client, 'log_food', { day: '2026-10-13', copy_from: { day: '2026-10-12', slot: 'breakfast' } });
    const logged = breakfast.data.logged as Logged;
    expect(logged.map((e) => [e.foodId ?? e.food, e.slot, e.grams])).toEqual([
      [RYE, 'breakfast', 100],
      ['Home jam', 'breakfast', 20],
    ]);
    expect(logged[1]!.estimated).toBe(true); // an estimate stays an estimate
    expect(breakfast.data.totals).toMatchObject({ kcal: 259 }); // 209 + 50

    const day = await call(client, 'log_food', { day: '2026-10-14', copy_from: { day: '2026-10-12' }, items: [{ food_id: RYE, grams: 50 }] });
    // Three copied entries keep their meals; the extra item goes to the meal for the current time.
    expect((day.data.logged as Logged).slice(0, 3).map((e) => e.slot)).toEqual(['breakfast', 'breakfast', 'dinner']);
    expect(day.data.logged as Logged).toHaveLength(4);
    expect(day.data.totals).toMatchObject({ kcal: 259 + 418 + 105 });

    const moved = await call(client, 'log_food', { day: '2026-10-15', slot: 'lunch', copy_from: { day: '2026-10-12', slot: 'dinner' } });
    expect((moved.data.logged as Logged)[0]!.slot).toBe('lunch');

    const nothing = await call(client, 'log_food', { day: '2026-10-15', copy_from: { day: '2026-10-01' } });
    expect(nothing.isError).toBe(true);
    expect(nothing.text).toContain('nothing logged on 2026-10-01');
    expect((await call(client, 'log_food', { day: '2026-10-15' })).isError).toBe(true);
  });

  it('logs servings of a saved recipe by name, and checks its ingredients for allergies', async () => {
    await call(client, 'save_recipe', { name: 'Usual breakfast', servings: 2, ingredients: [{ food_id: RYE, grams: 300 }] });
    const one = await call(client, 'log_food', { day: '2026-10-13', slot: 'breakfast', items: [{ recipe: 'usual breakfast' }] });
    expect((one.data.logged as Logged)[0]).toMatchObject({ food: 'Usual breakfast', grams: 150, kcal: 314 }); // 627 / 2
    expect((one.data.logged as Logged)[0]!.foodId).toMatch(/^recipe:/);
    const two = await call(client, 'log_food', { day: '2026-10-13', items: [{ recipe: (one.data.logged as Logged)[0]!.foodId!, servings: 2 }] });
    expect((two.data.logged as Logged)[0]).toMatchObject({ food: 'Usual breakfast (2 servings)', grams: 300 });

    await call(client, 'update_profile', { diet: { allergies: ['rye'] } });
    const warned = await call(client, 'log_food', { day: '2026-10-13', items: [{ recipe: 'Usual breakfast' }] });
    expect((warned.data.allergyWarnings as string[]).join(' ')).toContain('ALLERGY');
    const unknown = await call(client, 'log_food', { items: [{ recipe: 'Nope' }] });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('recipe "Nope"');
    expect((await call(client, 'log_food', { items: [{ food_id: RYE }] })).isError).toBe(true); // a food needs grams
  });
});

describe('foods from a label', () => {
  it('refuses values that cannot be right, and explains why', async () => {
    const kj = await call(client, 'save_custom_food', { name: 'Chicken slices', per100g: { kcal: 460, protein: 23, carbs: 0, fat: 1.5 } });
    expect(kj.isError).toBe(true);
    expect(kj.text).toContain('looks like kJ (110 kcal)');
    const heavy = await call(client, 'save_custom_food', { name: 'Bar', per100g: { kcal: 500, protein: 50, carbs: 40, fat: 20 }, values_checked: true });
    expect(heavy.isError).toBe(true); // impossible values are refused even when "checked"
    const wine = await call(client, 'save_custom_food', { name: 'Red wine', per100g: { kcal: 70, protein: 0, carbs: 0.6, fat: 0 } });
    expect(wine.isError).toBe(true);
    expect((await call(client, 'save_custom_food', { name: 'Red wine', per100g: { kcal: 70, protein: 0, carbs: 0.6, fat: 0 }, values_checked: true })).isError).toBe(false);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM custom_foods WHERE user_id = ?').bind(ana.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('converts per-serving values and keeps the serving as a portion', async () => {
    const { data } = await call(client, 'save_custom_food', { name: 'Granola bar', per_serving: { grams: 40, kcal: 150, protein: 6, carbs: 27, fat: 3 } });
    expect(data.food).toMatchObject({ per100g: { kcal: 375, protein: 15, carbs: 67.5, fat: 7.5 }, portions: [{ label: 'serving', grams: 40 }] });
    expect((await call(client, 'save_custom_food', { name: 'X', per100g: { kcal: 100, protein: 5, carbs: 15, fat: 2 }, per_serving: { grams: 40, kcal: 40, protein: 2, carbs: 6, fat: 1 } })).isError).toBe(true);
  });
});
