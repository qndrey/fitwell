// The meal plan view (D6): the week as days and meals against the goals, and the edits it makes (swap, copy, repeat a day, eaten), each checked like save_meal_plan.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MealPlanView } from '../src/analytics/mealPlanTypes';
import { todayIn } from '../src/data/time';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';

const today = todayIn('Europe/Copenhagen'); // the default time zone of a new profile
const week = weekStart(today);
const RYE = 'frida:413'; // 209 kcal per 100 g
const OATS = 'frida:59';

let env: Env;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const plan = () => (r: Awaited<ReturnType<typeof call>>) => (r.data as unknown as { mealPlan: MealPlanView }).mealPlan;
const view = async () => plan()(await call(client, 'show_meal_plan', { week_start: week }));
const save = (items: Record<string, unknown>[]) => call(client, 'save_meal_plan', { week_start: week, items });
const porridge = async () => ((await call(client, 'save_recipe', { name: 'Porridge', servings: 2, ingredients: [{ food_id: OATS, grams: 100 }] })).data as { id?: string; recipe?: { id: string } });
const ryeRecipe = () => call(client, 'save_recipe', { name: 'Rye toast', servings: 1, ingredients: [{ food_id: RYE, grams: 100 }] });
const recipeId = async (name: string) => (await view()).recipes.find((r) => r.name === name)!.id;
const edit = (name: string, args: Record<string, unknown>, v: MealPlanView) => call(client, name, { week_start: week, version: v.version, ...args });

describe('show_meal_plan', () => {
  it('refuses when there is no plan, and is read-only with app-only edit tools', async () => {
    expect((await call(client, 'show_meal_plan')).isError).toBe(true);
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === 'show_meal_plan')?.annotations).toMatchObject({ readOnlyHint: true });
    for (const name of ['get_meal_plan_data', 'plan_swap_recipe', 'plan_copy_meal', 'plan_repeat_day', 'plan_eat_meal']) {
      expect((tools.find((t) => t.name === name)?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility, name).toEqual(['app']);
    }
  });

  it('shows the seven days with their meals, totals and the goals, and picks the current week by itself', async () => {
    await call(client, 'set_goals', { kcal: 2000, protein_g: 120 });
    await save([{ day: week, slot: 'breakfast', food_id: OATS, grams: 80 }, { day: week, slot: 'lunch', food_id: RYE, grams: 120 }]);
    const v = plan()(await call(client, 'show_meal_plan'));
    expect(v).toMatchObject({ weekStart: week, goals: { kcal: 2000, proteinG: 120 }, today });
    expect(v.days.map((d) => d.day)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(week, i)));
    expect(v.days[0]!.meals).toMatchObject([{ slot: 'breakfast', logged: false }, { slot: 'lunch', kcal: 251, logged: false }]);
    expect(v.days[0]!.totals).not.toBeNull();
    expect(v.days[1]!.totals).toBeNull();
    expect(v.version).toBeGreaterThan(0);
  });

  it('says an allergy match in plain words', async () => {
    await save([{ day: week, slot: 'lunch', food_id: RYE, grams: 120 }]);
    await call(client, 'update_profile', { diet: { allergies: ['rye'] } });
    expect((await view()).warnings.join(' ')).toMatch(/ALLERGY/);
  });

  it('shows only the person\'s own plan', async () => {
    await save([{ day: week, slot: 'lunch', food_id: RYE, grams: 100 }]);
    const bo = connectAs(env, await signedInUser(env, 'bo@example.com'));
    expect((await call(await bo, 'show_meal_plan', { week_start: week })).isError).toBe(true);
  });
});

describe('swapping a meal', () => {
  it('swaps a meal for a saved recipe with the recipe\'s numbers and a new version', async () => {
    await porridge();
    await save([{ day: week, slot: 'breakfast', food_id: RYE, grams: 100 }]);
    const before = await view();
    const after = plan()(await edit('plan_swap_recipe', { index: 0, recipe_id: await recipeId('Porridge'), servings: 2 }, before));
    expect(after.days[0]!.meals).toMatchObject([{ slot: 'breakfast', name: 'Porridge', kind: 'recipe', servings: 2 }]);
    expect(after.version).toBeGreaterThan(before.version);
    expect((await call(client, 'get_meal_plan', { week_start: week })).text).toContain('Porridge');
  });

  it('copies another meal of the plan into the place of one', async () => {
    await save([{ day: week, slot: 'breakfast', food_id: OATS, grams: 80 }, { day: addDays(week, 1), slot: 'lunch', food_id: RYE, grams: 100 }]);
    const before = await view();
    const after = plan()(await edit('plan_copy_meal', { index: 1, copy_from: 0 }, before));
    expect(after.days[1]!.meals[0]).toMatchObject({ slot: 'lunch', kcal: before.days[0]!.meals[0]!.kcal });
  });

  it('refuses a stale view, an unknown meal or recipe, and a meal already eaten, and changes nothing', async () => {
    await porridge();
    await save([{ day: week, slot: 'breakfast', food_id: RYE, grams: 100 }]);
    const v0 = await view();
    const id = await recipeId('Porridge');
    await edit('plan_swap_recipe', { index: 0, recipe_id: id }, v0); // the plan moves on
    expect((await edit('plan_swap_recipe', { index: 0, recipe_id: id }, v0)).text).toContain('changed since');
    const v1 = await view();
    expect((await edit('plan_swap_recipe', { index: 9, recipe_id: id }, v1)).isError).toBe(true);
    expect((await edit('plan_swap_recipe', { index: 0, recipe_id: crypto.randomUUID() }, v1)).text).toContain('not saved');
    await call(client, 'log_planned_meal', { day: week });
    const v2 = await view();
    expect(v2.days[0]!.meals[0]!.logged).toBe(true);
    expect((await edit('plan_swap_recipe', { index: 0, recipe_id: id }, v2)).text).toContain('already logged');
    expect((await view()).days[0]!.meals[0]!.name).toBe('Porridge');
  });

  it('never brings an allergy into the plan: a recipe that matches one is refused', async () => {
    await porridge();
    await ryeRecipe();
    await save([{ day: week, slot: 'breakfast', food_id: OATS, grams: 80 }]);
    await call(client, 'update_profile', { diet: { allergies: ['rye'] } });
    const v = await view();
    const refused = await edit('plan_swap_recipe', { index: 0, recipe_id: await recipeId('Rye toast') }, v);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('allergy');
    expect((await view()).days[0]!.meals[0]!.name).toMatch(/oats/i); // as it was
  });

  it('an allergy the plan already has does not block other edits', async () => {
    await porridge();
    await save([{ day: week, slot: 'lunch', food_id: RYE, grams: 100 }, { day: week, slot: 'breakfast', food_id: OATS, grams: 80 }]);
    await call(client, 'update_profile', { diet: { allergies: ['rye'] } });
    const v = await view();
    const oats = v.days[0]!.meals.find((m) => m.slot === 'breakfast')!;
    expect((await edit('plan_swap_recipe', { index: oats.index, recipe_id: await recipeId('Porridge') }, v)).isError).toBe(false);
  });
});

describe('repeating a day', () => {
  it('makes a day a copy of another, replacing what was there, and drops the eaten mark of the copies', async () => {
    await save([{ day: week, slot: 'breakfast', food_id: OATS, grams: 80 }, { day: addDays(week, 1), slot: 'dinner', food_id: RYE, grams: 100 }]);
    const after = plan()(await edit('plan_repeat_day', { from_day: week, to_day: addDays(week, 1) }, await view()));
    expect(after.days[1]!.meals).toMatchObject([{ slot: 'breakfast', logged: false }]);
  });

  it('refuses a day outside the week, the same day, an empty day, and a target with an eaten meal', async () => {
    await save([{ day: week, slot: 'breakfast', food_id: OATS, grams: 80 }, { day: addDays(week, 1), slot: 'dinner', food_id: RYE, grams: 100 }]);
    const v = await view();
    for (const args of [{ from_day: week, to_day: addDays(week, 9) }, { from_day: week, to_day: week }, { from_day: addDays(week, 3), to_day: week }]) {
      expect((await edit('plan_repeat_day', args, v)).isError, JSON.stringify(args)).toBe(true);
    }
    await call(client, 'log_planned_meal', { day: addDays(week, 1) });
    expect((await edit('plan_repeat_day', { from_day: week, to_day: addDays(week, 1) }, await view())).text).toContain('already logged');
  });
});

describe('eaten', () => {
  it('logs one planned meal with its planned amounts, once, and only for today or before', async () => {
    const future = addDays(today, 1);
    const inWeek = weekStart(future) === week;
    await save([{ day: today, slot: 'lunch', food_id: RYE, grams: 120 }, { day: today, slot: 'dinner', food_id: RYE, grams: 100 }, ...(inWeek ? [{ day: future, slot: 'lunch', food_id: RYE, grams: 100 }] : [])]);
    const v = await view();
    const lunch = v.days.find((d) => d.day === today)!.meals.find((m) => m.slot === 'lunch')!;
    const after = plan()(await edit('plan_eat_meal', { index: lunch.index }, v));
    expect(after.days.find((d) => d.day === today)!.meals.map((m) => m.logged)).toEqual([true, false]); // lunch, not the dinner
    const log = (await call(client, 'get_food_log', { day: today })).data as { entries: { slot: string; grams: number }[] };
    expect(log.entries).toMatchObject([{ slot: 'lunch', grams: 120 }]);
    expect((await edit('plan_eat_meal', { index: lunch.index }, after)).text).toContain('already logged');
    if (inWeek) {
      const ahead = after.days.find((d) => d.day === future)!.meals[0]!;
      expect((await edit('plan_eat_meal', { index: ahead.index }, after)).text).toContain('still ahead');
    }
  });
});
