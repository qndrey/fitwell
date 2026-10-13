import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { todayIn } from '../src/data/time';
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

const WEEK = '2026-10-19'; // a Monday
const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';
const RYE = 'frida:413'; // 209 kcal and 5.8 g protein per 100 g

type Food = { id: string; name: string; group?: string };
const pick = async (query: string): Promise<Food> => ((await call(client, 'search_foods', { query, limit: 1 })).data.foods as Food[])[0]!;

/** Chicken, rice and broccoli: a recipe for 4 servings. */
async function chickenRecipe(name = 'Chicken and rice') {
  const [chicken, rice, broccoli] = [await pick('chicken breast'), await pick('rice'), await pick('broccoli')];
  const saved = await call(client, 'save_recipe', { name, servings: 4, ingredients: [{ food_id: chicken.id, grams: 600 }, { food_id: rice.id, grams: 280 }, { food_id: broccoli.id, grams: 600 }], notes: 'Bake the chicken, boil the rice.' });
  expect(saved.isError, saved.text).toBe(false);
  return { chicken, rice, broccoli, recipe: saved.data.recipe as { id: string; name: string; perServing: { kcal: number; protein: number }; totalGrams: number } };
}

const week = (items: Record<string, unknown>[], week_start = WEEK) => call(client, 'save_meal_plan', { week_start, items });
/** One simple meal on each day of the week: enough for the plan to have no gaps. */
const fullWeek = () => Array.from({ length: 7 }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10), slot: 'lunch', food_id: RYE, grams: 100 }));

describe('recipes', () => {
  it('works out nutrition per serving from the foods\' own values, and replaces a recipe saved under the same name', async () => {
    const { recipe } = await chickenRecipe();
    expect(recipe.totalGrams).toBe(1480);
    const list = (await call(client, 'list_recipes', {})).data.recipes as { id: string; name: string; servings: number; perServing: { kcal: number }; ingredients: number }[];
    expect(list).toEqual([expect.objectContaining({ id: recipe.id, name: 'Chicken and rice', servings: 4, ingredients: 3 })]);
    // The recipe for 4 as a whole is worth 4 servings' calories.
    const again = await call(client, 'save_recipe', { name: 'chicken AND rice', servings: 2, ingredients: [{ food_id: RYE, grams: 200 }] }); // same name, any case
    expect((again.data.recipe as { id: string }).id).toBe(recipe.id);
    expect((again.data.recipe as { perServing: { kcal: number } }).perServing.kcal).toBe(209);
    expect(((await call(client, 'list_recipes', {})).data.recipes as unknown[]).length).toBe(1);
  });

  it('saves nothing when one ingredient is unknown, and accepts a marked estimate', async () => {
    const bad = await call(client, 'save_recipe', { name: 'Broken', ingredients: [{ food_id: RYE, grams: 100 }, { food_id: 'frida:999999', grams: 10 }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('frida:999999');
    const est = await call(client, 'save_recipe', { name: "Grandma's stew", servings: 2, ingredients: [{ name: 'Stew', grams: 600, estimate_per100g: { kcal: 120, protein: 8, carbs: 10, fat: 5 } }] });
    expect((est.data.recipe as { perServing: { kcal: number }; ingredients: { estimated?: boolean }[] }).perServing.kcal).toBe(360);
    expect((est.data.recipe as { ingredients: { estimated?: boolean }[] }).ingredients[0]!.estimated).toBe(true);
    expect(((await call(client, 'list_recipes', {})).data.recipes as unknown[]).length).toBe(1);
  });

  it('shows and deletes a recipe', async () => {
    const { recipe } = await chickenRecipe();
    const byName = (await call(client, 'get_recipe', { name: 'chicken and rice' })).data.recipe as { ingredients: unknown[]; notes: string };
    expect(byName.ingredients.length).toBe(3);
    expect(byName.notes).toContain('Bake the chicken');
    expect((await call(client, 'delete_recipe', { id: recipe.id })).data.deleted).toBe(recipe.id);
    expect((await call(client, 'get_recipe', { id: recipe.id })).isError).toBe(true);
  });
});

describe('planning context', () => {
  it('gathers goals, per-meal targets, diet, favourite foods and recipes', async () => {
    await call(client, 'set_goals', { kcal: 2000, protein_g: 120 });
    await call(client, 'update_profile', { diet: { allergies: ['peanut'], dislikes: ['liver'] } });
    const day = todayIn('Europe/Copenhagen');
    for (let i = 0; i < 3; i++) await call(client, 'log_food', { day, items: [{ food_id: RYE, grams: 100 + i * 10 }] });
    await chickenRecipe();
    const c = (await call(client, 'get_planning_context', {})).data as {
      today: string; nextWeekStart: string; perMealTargets: Record<string, { kcal: number; protein: number }>; diet: { allergies: string[] }; frequentFoods: { foodId: string; times: number; typicalGrams: number }[]; recipes: { name: string }[];
    };
    expect(new Date(`${c.nextWeekStart}T00:00:00Z`).getUTCDay()).toBe(1); // a Monday
    expect(c.nextWeekStart >= c.today).toBe(true);
    expect(c.perMealTargets).toEqual({ breakfast: { kcal: 500, protein: 30 }, lunch: { kcal: 600, protein: 36 }, dinner: { kcal: 600, protein: 36 }, snacks: { kcal: 300, protein: 18 } });
    expect(c.diet.allergies).toEqual(['peanut']);
    expect(c.frequentFoods[0]).toMatchObject({ foodId: RYE, times: 3, typicalGrams: 110 });
    expect(c.recipes.map((r) => r.name)).toEqual(['Chicken and rice']);
  });
});

describe('saving a plan', () => {
  it('resolves foods and recipes and checks every day against the goals', async () => {
    const { recipe } = await chickenRecipe();
    await call(client, 'set_goals', { kcal: 2000, protein_g: 120 });
    const res = await week([
      { day: MON, slot: 'breakfast', food_id: RYE, grams: 100 },
      { day: MON, slot: 'dinner', recipe_id: recipe.id, servings: 1 },
      { day: TUE, slot: 'dinner', recipe_name: 'chicken and rice', servings: 2 },
    ]);
    expect(res.isError).toBe(false);
    expect(res.data.saved).toEqual({ weekStart: WEEK, items: 3 });
    expect(res.data.ok).toBe(false);
    const days = res.data.days as { day: string; items: number; totals: { kcal: number }; vsGoal: { kcal: number }; status: { kcal: string } }[];
    expect(days.map((d) => d.day)).toEqual([MON, TUE]);
    expect(days[0]!.totals.kcal).toBe(Math.round(209 + recipe.perServing.kcal));
    expect(days[0]!.status.kcal).toBe('low');
    const problems = res.data.problems as string[];
    expect(problems.some((p) => p.startsWith(`${MON}:`) && p.includes('under the 2000 kcal goal'))).toBe(true);
    expect(problems).toContain(`Nothing planned on ${[WED, '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].join(', ')}.`);
    expect(res.data.next).toContain('save_meal_plan again');
  });

  it('is clean when the plan has no gaps and no goals to miss', async () => {
    const res = await week(fullWeek());
    expect(res.data).toMatchObject({ ok: true, problems: [], warnings: [] });
  });

  it('stops on an allergy, by name, in a recipe ingredient too', async () => {
    await call(client, 'update_profile', { diet: { allergies: ['Peanut'], dislikes: ['rye'] } });
    const pb = (await call(client, 'save_custom_food', { name: 'Peanut butter', per100g: { kcal: 600, protein: 25, carbs: 20, fat: 50 } })).data.food as { id: string };
    await call(client, 'save_recipe', { name: 'Satay', servings: 2, ingredients: [{ food_id: pb.id, grams: 60 }, { food_id: RYE, grams: 100 }] });
    const res = await week([...fullWeek().slice(0, 6), { day: '2026-10-25', slot: 'dinner', recipe_name: 'Satay', servings: 1 }]);
    expect(res.data.ok).toBe(false);
    const problems = res.data.problems as string[];
    expect(problems[0]).toBe('ALLERGY: Satay (2026-10-25 dinner) contains peanut.');
    expect(problems.some((p) => p.startsWith('Disliked food: Rye bread, light (2026-10-19 lunch)'))).toBe(true);
    expect((res.data.warnings as { kind: string }[])[0]!.kind).toBe('allergy');
  });

  it('refuses a week that does not start on a Monday, days outside the week, unknown foods and recipes', async () => {
    expect((await week(fullWeek(), '2026-10-20')).text).toContain('must be a Monday');
    expect((await week([{ day: '2026-10-26', slot: 'lunch', food_id: RYE, grams: 100 }])).text).toContain('outside the week');
    const unknownFood = await week([{ day: MON, slot: 'lunch', food_id: 'frida:999999', grams: 100 }]);
    expect(unknownFood.isError).toBe(true);
    expect((await week([{ day: MON, slot: 'lunch', recipe_name: 'Nothing like it', servings: 1 }])).text).toContain('No saved recipe');
    expect((await call(client, 'get_meal_plan', { week_start: WEEK })).isError).toBe(true); // none of those saved anything
  });

  it('replaces the plan of a week when saved again', async () => {
    await week([{ day: MON, slot: 'lunch', food_id: RYE, grams: 100 }, { day: TUE, slot: 'lunch', food_id: RYE, grams: 100 }]);
    await week([{ day: WED, slot: 'dinner', food_id: RYE, grams: 250 }]);
    const plan = (await call(client, 'get_meal_plan', { week_start: WEEK })).data as { days: { day: string; meals: { grams: number }[] }[] };
    expect(plan.days.filter((d) => d.meals.length).map((d) => [d.day, d.meals[0]!.grams])).toEqual([[WED, 250]]);
  });
});

describe('showing a plan', () => {
  it('lists meals per day with totals, and points out recipes to cook once for several meals', async () => {
    const { recipe, chicken } = await chickenRecipe();
    await week([
      { day: MON, slot: 'dinner', recipe_id: recipe.id, servings: 2 },
      { day: WED, slot: 'lunch', recipe_id: recipe.id, servings: 1 },
      { day: WED, slot: 'dinner', food_id: RYE, grams: 100 },
    ]);
    const plan = (await call(client, 'get_meal_plan', { week_start: WEEK })).data as {
      days: { day: string; weekday: string; meals: { slot: string; name: string; servings?: number }[]; totals?: { kcal: number } }[];
      batchCooking: { recipe: string; cookServings: number; meals: string[]; ingredients: { name: string; grams: number }[] }[];
    };
    expect(plan.days[0]).toMatchObject({ day: MON, weekday: 'Mon', meals: [{ slot: 'dinner', name: 'Chicken and rice', servings: 2 }] });
    expect(plan.days[2]!.meals.map((m) => m.slot)).toEqual(['lunch', 'dinner']);
    expect(plan.days[1]).toMatchObject({ day: TUE, meals: [] });
    expect(plan.batchCooking).toHaveLength(1);
    expect(plan.batchCooking[0]).toMatchObject({ recipe: 'Chicken and rice', cookServings: 3, meals: ['Mon dinner', 'Wed lunch'] });
    expect(plan.batchCooking[0]!.ingredients.find((i) => i.name === chicken.name)!.grams).toBe(450); // 3 of 4 servings of 600 g
  });

  it('returns items in the shape save_meal_plan takes, so a plan can be changed and saved again', async () => {
    const { recipe } = await chickenRecipe();
    await week([{ day: MON, slot: 'dinner', recipe_id: recipe.id, servings: 2 }, { day: TUE, slot: 'lunch', food_id: RYE, grams: 120 }, { day: WED, slot: 'snacks', name: 'Protein bar', grams: 60, estimate_per100g: { kcal: 380, protein: 30, carbs: 35, fat: 12 } }]);
    const before = (await call(client, 'get_meal_plan', { week_start: WEEK, editable: true })).data as { editable: Record<string, unknown>[]; days: unknown };
    expect(before.editable).toHaveLength(3);
    await week(before.editable);
    const after = (await call(client, 'get_meal_plan', { week_start: WEEK, editable: true })).data as typeof before;
    expect(after.days).toEqual(before.days);
  });

  it('says so when there is no plan, and deletes one', async () => {
    expect((await call(client, 'get_meal_plan', { week_start: WEEK })).text).toContain('No meal plan');
    await week(fullWeek());
    expect((await call(client, 'delete_meal_plan', { week_start: WEEK })).data.deleted).toBe(WEEK);
    expect((await call(client, 'delete_meal_plan', { week_start: WEEK })).isError).toBe(true);
  });
});

describe('grocery list', () => {
  type Section = { aisle: string; items: { name: string; grams: number; buy: string; usedIn: string[] }[] };
  const list = async (args: Record<string, unknown> = {}) => (await call(client, 'get_grocery_list', { week_start: WEEK, ...args })).data as { sections: Section[]; leftOut: string[]; markdown: string; meals: number; skippedAsEaten?: number };
  const find = (l: { sections: Section[] }, name: string) => l.sections.flatMap((s) => s.items.map((i) => ({ ...i, aisle: s.aisle }))).find((i) => i.name === name)!;

  async function plan() {
    const r = await chickenRecipe();
    await week([
      { day: MON, slot: 'breakfast', food_id: RYE, grams: 100 },
      { day: MON, slot: 'dinner', recipe_id: r.recipe.id, servings: 2 },
      { day: TUE, slot: 'breakfast', food_id: RYE, grams: 100 },
      { day: WED, slot: 'dinner', recipe_id: r.recipe.id, servings: 2 },
    ]);
    return r;
  }

  it('adds ingredients up across meals, rounds up to what a shop sells and groups by section', async () => {
    const { chicken, rice } = await plan();
    const l = await list();
    expect(find(l, chicken.name)).toMatchObject({ aisle: 'Meat', grams: 600, buy: '600 g', usedIn: ['Mon dinner', 'Wed dinner'] });
    expect(find(l, rice.name)).toMatchObject({ grams: 280, buy: '300 g' });
    expect(find(l, 'Rye bread, light')).toMatchObject({ aisle: 'Bakery', grams: 200, buy: '200 g', usedIn: ['Mon breakfast', 'Tue breakfast'] });
    const order = ['Produce', 'Meat', 'Fish and seafood', 'Dairy and eggs', 'Bakery', 'Plant-based', 'Pantry', 'Frozen', 'Snacks and sweets', 'Drinks', 'Ready meals', 'Other'];
    expect(l.sections.map((s) => order.indexOf(s.aisle))).toEqual([...l.sections.map((s) => order.indexOf(s.aisle))].sort((a, b) => a - b));
    expect(l.markdown).toContain(`- [ ] ${chicken.name}: 600 g`);
    expect(l.markdown).toMatch(/^## Produce/m);
  });

  it('scales for more people and leaves out what is already at home', async () => {
    const { chicken, rice } = await plan();
    const two = await list({ people: 2 });
    expect(find(two, chicken.name)).toMatchObject({ grams: 1200, buy: '1.2 kg' });
    const home = await list({ already_have: [rice.name.slice(0, 6), 'RYE'] });
    expect(home.leftOut.sort()).toEqual(['Rye bread, light', rice.name].sort());
    expect(home.sections.flatMap((s) => s.items.map((i) => i.name))).not.toContain(rice.name);
  });

  it('skips meals already eaten unless asked', async () => {
    const { chicken } = await plan();
    await call(client, 'log_planned_meal', { day: MON });
    const later = await list();
    expect(later.skippedAsEaten).toBe(2);
    expect(find(later, chicken.name)).toMatchObject({ grams: 300, usedIn: ['Wed dinner'] });
    expect(find(await list({ include_eaten: true }), chicken.name).grams).toBe(600);
  });

  it('says when the list is made of cooked foods, in the data and in the checklist', async () => {
    await week([{ day: MON, slot: 'dinner', food_id: (await pick('rice boiled')).id, grams: 200 }]);
    const l = (await call(client, 'get_grocery_list', { week_start: WEEK })).data as { notes: string[]; markdown: string };
    expect(l.notes[0]).toContain('Rice, boiled');
    expect(l.markdown).toContain('- [ ] Rice, boiled: 200 g (cooked weight)');
  });

  it('needs a plan, and a Monday', async () => {
    expect((await call(client, 'get_grocery_list', { week_start: '2026-10-21' })).isError).toBe(true);
    expect((await call(client, 'get_grocery_list', { week_start: WEEK })).text).toContain('No meal plan');
  });
});

describe('logging a planned meal', () => {
  it('adds the planned meals of a day to the food log once, with a recipe as one entry', async () => {
    const { recipe } = await chickenRecipe();
    await call(client, 'set_goals', { kcal: 2000 });
    await week([{ day: MON, slot: 'breakfast', food_id: RYE, grams: 150 }, { day: MON, slot: 'dinner', recipe_id: recipe.id, servings: 2 }, { day: TUE, slot: 'lunch', food_id: RYE, grams: 100 }]);

    const res = await call(client, 'log_planned_meal', { day: MON });
    expect(res.isError, res.text).toBe(false);
    const logged = res.data.logged as { slot: string; food: string; grams: number; kcal: number }[];
    expect(logged.map((e) => [e.slot, e.food])).toEqual([['breakfast', 'Rye bread, light'], ['dinner', 'Chicken and rice (2 servings)']]);
    expect(logged[0]).toMatchObject({ grams: 150, kcal: 314 });
    const day = (await call(client, 'get_day', { day: MON })).data as { entries: { slot: string; foodId?: string }[]; totals: { kcal: number } };
    expect(day.entries.length).toBe(2);
    expect(day.entries.find((e) => e.slot === 'breakfast')!.foodId).toBe(RYE);
    expect(res.data.kcalRemaining).toBe(2000 - day.totals.kcal);

    // Logged once: asking again logs nothing, unless told to.
    const again = await call(client, 'log_planned_meal', { day: MON });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('already logged');
    expect(((await call(client, 'get_day', { day: MON })).data.entries as unknown[]).length).toBe(2);
    expect(((await call(client, 'log_planned_meal', { day: MON, slot: 'breakfast', again: true })).data.logged as unknown[]).length).toBe(1);
    expect(((await call(client, 'get_day', { day: MON })).data.entries as unknown[]).length).toBe(3);
  });

  it('logs one slot, and says when nothing is planned', async () => {
    await week([{ day: MON, slot: 'breakfast', food_id: RYE, grams: 100 }, { day: MON, slot: 'lunch', food_id: RYE, grams: 100 }]);
    expect(((await call(client, 'log_planned_meal', { day: MON, slot: 'lunch' })).data.logged as unknown[]).length).toBe(1);
    expect((await call(client, 'log_planned_meal', { day: TUE })).text).toContain('Nothing planned');
    expect((await call(client, 'log_planned_meal', { day: '2026-11-02' })).text).toContain('No meal plan');
  });

  it('keeps the "eaten" mark of meals that did not change when the plan is saved again', async () => {
    const items = [{ day: MON, slot: 'breakfast', food_id: RYE, grams: 100 }, { day: MON, slot: 'dinner', food_id: RYE, grams: 200 }];
    await week(items);
    await call(client, 'log_planned_meal', { day: MON, slot: 'breakfast' });
    await week([...items, { day: TUE, slot: 'lunch', food_id: RYE, grams: 100 }]); // a revised plan
    const plan = (await call(client, 'get_meal_plan', { week_start: WEEK })).data as { days: { meals: { slot: string; logged?: boolean }[] }[] };
    expect(plan.days[0]!.meals.map((m) => [m.slot, m.logged ?? false])).toEqual([['breakfast', true], ['dinner', false]]);
    expect((await call(client, 'log_planned_meal', { day: MON })).data.logged).toHaveLength(1); // only the dinner
  });
});

describe('privacy', () => {
  it('keeps recipes and plans per person, and exports and erases them', async () => {
    const { recipe } = await chickenRecipe();
    await week([{ day: MON, slot: 'dinner', recipe_id: recipe.id, servings: 1 }]);
    const bo = await connectAs(env, await signedInUser(env, 'bo@example.com'));

    expect((await call(bo, 'list_recipes', {})).data.recipes).toEqual([]);
    expect((await call(bo, 'get_recipe', { id: recipe.id })).isError).toBe(true);
    expect((await call(bo, 'delete_recipe', { id: recipe.id })).isError).toBe(true);
    expect((await call(bo, 'get_meal_plan', { week_start: WEEK })).isError).toBe(true);
    expect((await call(bo, 'get_grocery_list', { week_start: WEEK })).isError).toBe(true);
    expect((await call(bo, 'log_planned_meal', { day: MON })).isError).toBe(true);
    // Bo cannot plan with Ana's recipe by id or by name.
    expect((await call(bo, 'save_meal_plan', { week_start: WEEK, items: [{ day: MON, slot: 'dinner', recipe_id: recipe.id }] })).isError).toBe(true);
    expect((await call(bo, 'save_meal_plan', { week_start: WEEK, items: [{ day: MON, slot: 'dinner', recipe_name: 'Chicken and rice' }] })).isError).toBe(true);
    expect((await call(bo, 'get_planning_context', {})).data.recipes).toEqual([]);

    const exported = (await call(client, 'export_my_data', {})).data as { recipes: unknown[]; mealPlans: unknown[] };
    expect([exported.recipes.length, exported.mealPlans.length]).toEqual([1, 1]);
    await call(client, 'delete_my_account', { confirm: 'delete my account' });
    const left = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM recipes) + (SELECT COUNT(*) FROM meal_plans) AS n').first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
