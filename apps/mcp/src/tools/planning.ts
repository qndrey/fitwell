import { addDays, isDay, weekStart as mondayOf } from '@fitwell/core/domain/dates';
import { roundForDisplay, scale, sum } from '@fitwell/core/domain/nutrition';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { perServing, type PlanData, type Recipe } from '../data/planData';
import { todayIn } from '../data/time';
import type { NewFoodEntry } from '../data/userData';
import { checkPlan, SLOT_NAMES, type PlannedItem, type SlotName } from '../planning/check';
import { buildGroceryList, type Ingredient } from '../planning/grocery';
import { FoodMemo, per100gSchema } from '../planning/resolve';
import type { FoodDeps } from './foods';
import { json, toolError } from './result';

const day = z.string().refine(isDay, 'Use YYYY-MM-DD');
const slot = z.enum(SLOT_NAMES);
const r0 = (n: number) => Math.round(n);
const weekday = (d: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const label = (it: Pick<PlannedItem, 'day' | 'slot'>) => `${weekday(it.day)} ${it.slot}`;
const weekDaysOf = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
const isMonday = (d: string) => mondayOf(d) === d;
/** Today if it is a Monday, else the coming Monday. */
const nextMonday = (today: string) => (isMonday(today) ? today : addDays(mondayOf(today), 7));

const SLOT_SHARE: Record<SlotName, number> = { breakfast: 0.25, lunch: 0.3, dinner: 0.3, snacks: 0.15 };
const bySlot = (a: PlannedItem, b: PlannedItem) => (a.day === b.day ? SLOT_NAMES.indexOf(a.slot) - SLOT_NAMES.indexOf(b.slot) : a.day < b.day ? -1 : 1);

const planItem = z
  .object({
    day,
    slot,
    food_id: z.string().optional().describe('A food from search_foods etc. Needs grams.'),
    grams: z.number().positive().max(5000).optional(),
    recipe_id: z.uuid().optional(),
    recipe_name: z.string().optional().describe('A saved recipe by name (instead of recipe_id)'),
    servings: z.number().positive().max(20).default(1).describe('Servings of the recipe'),
    name: z.string().min(1).max(100).optional().describe('Only for an estimate'),
    estimate_per100g: per100gSchema.optional(),
  })
  .refine((i) => (i.food_id && i.grams) || i.recipe_id || i.recipe_name || (i.name && i.estimate_per100g && i.grams), 'Each item needs food_id with grams, a recipe, or name with estimate_per100g and grams');

const viewItem = (i: PlannedItem) => ({
  slot: i.slot,
  name: i.name,
  ...(i.kind === 'recipe' ? { recipeId: i.recipeId, servings: i.servings } : {}),
  ...(i.foodId ? { foodId: i.foodId } : {}),
  grams: r0(i.grams),
  kcal: r0(i.kcal),
  protein: r0(i.protein),
  ...(i.kind === 'estimate' ? { estimated: true } : {}),
  ...(i.loggedAt ? { logged: true } : {}),
});

/** The same item as save_meal_plan takes it, so a plan can be fetched, changed and saved again. */
const editable = (i: PlannedItem) =>
  i.kind === 'recipe' ? { day: i.day, slot: i.slot, recipe_id: i.recipeId, servings: i.servings } : i.kind === 'food' ? { day: i.day, slot: i.slot, food_id: i.foodId, grams: r0(i.grams) } : { day: i.day, slot: i.slot, name: i.name, grams: r0(i.grams), estimate_per100g: { kcal: (i.kcal / i.grams) * 100, protein: (i.protein / i.grams) * 100, carbs: (i.carbs / i.grams) * 100, fat: (i.fat / i.grams) * 100 } };

/** Recipes that come up more than once: cook them together once. */
function batchCooking(items: PlannedItem[]) {
  const by = new Map<string, { name: string; servings: number; meals: string[]; ingredients: Map<string, number> }>();
  for (const it of items.filter((i) => i.kind === 'recipe' && i.recipeId)) {
    const b = by.get(it.recipeId!) ?? { name: it.name, servings: 0, meals: [], ingredients: new Map<string, number>() };
    b.servings += it.servings ?? 1;
    b.meals.push(label(it));
    for (const ing of it.ingredients) b.ingredients.set(ing.name, (b.ingredients.get(ing.name) ?? 0) + ing.grams);
    by.set(it.recipeId!, b);
  }
  return [...by.values()]
    .filter((b) => b.meals.length >= 2)
    .map((b) => ({ recipe: b.name, cookServings: b.servings, meals: b.meals, ingredients: [...b.ingredients].map(([name, g]) => ({ name, grams: r0(g) })).sort((x, y) => y.grams - x.grams) }));
}

export function registerPlanningTools(server: McpServer, deps: FoodDeps & { plans: PlanData }) {
  const { data, plans } = deps;
  const today = async () => todayIn((await data.profile()).timeZone);

  async function resolveWeek(given: string | undefined): Promise<string | { error: string }> {
    const start = given ?? nextMonday(await today());
    return isMonday(start) ? start : { error: `week_start must be a Monday (for example ${nextMonday(start)}); ${start} is not.` };
  }

  server.registerTool(
    'get_planning_context',
    {
      title: 'Context for planning meals',
      description:
        "Everything needed to plan a week of meals in one call: daily calorie and macro goals with a split per meal, diet preferences, allergies and dislikes, the foods the person actually eats most (with typical amounts), their saved recipes, and which weeks already have a plan. " +
        'Call it before proposing a plan; build the plan from foods and recipes with ids, then save it with save_meal_plan.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const profile = await data.profile();
      const goals = await data.goals();
      const t = todayIn(profile.timeZone);
      const recipes = await plans.recipes();
      return json({
        today: t,
        nextWeekStart: nextMonday(t),
        goals,
        perMealTargets: goals?.kcal ? Object.fromEntries(SLOT_NAMES.map((s) => [s, { kcal: r0(goals.kcal! * SLOT_SHARE[s]), ...(goals.proteinG ? { protein: r0(goals.proteinG * SLOT_SHARE[s]) } : {}) }])) : null,
        diet: profile.diet,
        frequentFoods: await data.frequentFoods(addDays(t, -60), t, 15),
        recipes: recipes.map((r) => ({ id: r.id, name: r.name, servings: r.servings, perServing: roundForDisplay(perServing(r)) })),
        plannedWeeks: await plans.planWeeks(),
        note: goals?.kcal ? undefined : 'No calorie goal is set: suggest_targets can estimate one from the profile.',
      });
    },
  );

  server.registerTool(
    'save_meal_plan',
    {
      title: 'Save a weekly meal plan',
      description:
        'Save the plan for a week (week_start is a Monday; default the coming Monday). Each item is a food (food_id + grams), a saved recipe (recipe_id or recipe_name + servings), or, only if nothing fits, a named estimate. ' +
        'Values come from the foods\' own data. Use foods in the form they are bought and weighed (rice, pasta and meat raw), so the grocery list is right. Saving a week again replaces its plan. The reply checks every day against the calorie and protein goals and every item against allergies and dislikes, ' +
        'with plain-language problems: fix them and save again BEFORE presenting the plan, and never present a plan with an ALLERGY warning.',
      inputSchema: z.object({ week_start: day.optional(), items: z.array(planItem).min(1).max(120) }),
      annotations: { idempotentHint: true },
    },
    async ({ week_start, items }) => {
      const week = await resolveWeek(week_start);
      if (typeof week !== 'string') return toolError(week.error);
      const days = weekDaysOf(week);
      const outside = items.filter((i) => !days.includes(i.day)).map((i) => i.day);
      if (outside.length) return toolError(`These days are outside the week ${week} to ${days[6]}: ${[...new Set(outside)].join(', ')}.`);

      const foods = new FoodMemo(deps);
      const recipes = new Map<string, Recipe>();
      const planned: PlannedItem[] = [];
      for (const i of items) {
        if (i.food_id && i.grams) {
          const hit = await foods.get(i.food_id);
          if (!hit) return toolError(`Nothing was saved. Unknown food id ${i.food_id}. Search again with search_foods.`);
          planned.push({ day: i.day, slot: i.slot, kind: 'food', name: hit.name, foodId: hit.id, grams: i.grams, ...scale(hit.per100g, i.grams), ingredients: [{ foodId: hit.id, name: hit.name, ...(hit.group ? { group: hit.group } : {}), grams: i.grams }] });
        } else if (i.recipe_id || i.recipe_name) {
          const key = i.recipe_id ?? `name:${i.recipe_name!.toLowerCase()}`;
          if (!recipes.has(key)) {
            const r = i.recipe_id ? await plans.recipe(i.recipe_id) : await plans.recipeByName(i.recipe_name!);
            if (!r) return toolError(`Nothing was saved. No saved recipe ${i.recipe_id ?? `"${i.recipe_name}"`}. Use list_recipes or save_recipe first.`);
            recipes.set(key, r);
          }
          const r = recipes.get(key)!;
          const f = i.servings / r.servings;
          const ingredients: Ingredient[] = r.items.map((x) => ({ ...(x.foodId ? { foodId: x.foodId } : {}), name: x.name, ...(x.group ? { group: x.group } : {}), grams: x.grams * f }));
          const total = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => r.items.reduce((n, x) => n + x[k], 0) * f;
          planned.push({ day: i.day, slot: i.slot, kind: 'recipe', name: r.name, recipeId: r.id, servings: i.servings, grams: ingredients.reduce((n, x) => n + x.grams, 0), kcal: total('kcal'), protein: total('protein'), carbs: total('carbs'), fat: total('fat'), ingredients });
        } else {
          planned.push({ day: i.day, slot: i.slot, kind: 'estimate', name: i.name!, grams: i.grams!, ...scale(i.estimate_per100g!, i.grams!), ingredients: [{ name: i.name!, grams: i.grams! }] });
        }
      }
      planned.sort(bySlot);

      // A revised plan keeps the "already logged" mark of meals that did not change, so nothing is logged twice.
      const keyOf = (p: PlannedItem) => `${p.day}|${p.slot}|${p.kind}|${p.foodId ?? p.recipeId ?? p.name}|${p.servings ?? Math.round(p.grams)}`;
      const logged = new Map<string, number[]>();
      for (const o of (await plans.plan(week))?.items ?? []) if (o.loggedAt) logged.set(keyOf(o), [...(logged.get(keyOf(o)) ?? []), o.loggedAt]);
      for (const p of planned) {
        const marks = logged.get(keyOf(p));
        if (marks?.length) p.loggedAt = marks.shift();
      }

      await plans.savePlan(week, planned);
      const profile = await data.profile();
      const check = checkPlan(days, planned, await data.goals(), profile.diet.allergies, profile.diet.dislikes);
      return json({ saved: { weekStart: week, items: planned.length }, ok: check.problems.length === 0, problems: check.problems, warnings: check.warnings, days: check.days, ...(check.problems.length ? { next: 'Fix the problems and call save_meal_plan again with the whole week.' } : {}) });
    },
  );

  server.registerTool(
    'get_meal_plan',
    {
      title: 'Show a weekly meal plan',
      description:
        'The plan for a week (default the coming Monday): meals per day with nutrition, day totals against the goals, remaining problems, and recipes that appear more than once with the total to cook (meal prep). ' +
        'editable: true also returns the items in the shape save_meal_plan takes, to change the plan and save it again.',
      inputSchema: z.object({ week_start: day.optional(), editable: z.boolean().default(false) }),
      annotations: { readOnlyHint: true },
    },
    async ({ week_start, editable: wantEditable }) => {
      const week = await resolveWeek(week_start);
      if (typeof week !== 'string') return toolError(week.error);
      const plan = await plans.plan(week);
      if (!plan) return toolError(`No meal plan for the week of ${week}. Plan one with save_meal_plan.`);
      const days = weekDaysOf(week);
      const profile = await data.profile();
      const check = checkPlan(days, plan.items, await data.goals(), profile.diet.allergies, profile.diet.dislikes);
      return json({
        weekStart: week,
        days: days.map((d) => {
          const c = check.days.find((x) => x.day === d);
          return { day: d, weekday: weekday(d), meals: plan.items.filter((i) => i.day === d).map(viewItem), ...(c ? { totals: c.totals, vsGoal: c.vsGoal } : {}) };
        }),
        problems: check.problems,
        batchCooking: batchCooking(plan.items),
        ...(wantEditable ? { editable: plan.items.map(editable) } : {}),
      });
    },
  );

  server.registerTool(
    'get_grocery_list',
    {
      title: 'Grocery list for a meal plan',
      description:
        "The shopping list for a week's plan: every ingredient added up, rounded up to what a shop sells, grouped by section in shopping order, with where each is used. " +
        'people multiplies the quantities (cooking for two = 2); already_have leaves out foods by name (e.g. ["olive oil","salt"]); meals already logged as eaten are skipped unless include_eaten. ' +
        'Also returns the list as a markdown checklist to show or copy. Amounts are the weights of the foods as planned: plan with foods in the form they are bought (rice, pasta and meat raw, not boiled), otherwise the amounts are cooked weights and the notes say so.',
      inputSchema: z.object({
        week_start: day.optional(),
        people: z.number().min(0.5).max(10).default(1),
        already_have: z.array(z.string().max(60)).max(60).default([]),
        include_eaten: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ week_start, people, already_have, include_eaten }) => {
      const week = await resolveWeek(week_start);
      if (typeof week !== 'string') return toolError(week.error);
      const plan = await plans.plan(week);
      if (!plan) return toolError(`No meal plan for the week of ${week}. Plan one with save_meal_plan.`);
      const items = plan.items.filter((i) => include_eaten || !i.loggedAt);
      const list = buildGroceryList(items.map((i) => ({ label: label(i), ingredients: i.ingredients })), people, already_have);
      const markdown = list.sections.map((s) => `## ${s.aisle}\n${s.items.map((e) => `- [ ] ${e.name}: ${e.buy}${e.cooked ? ' (cooked weight)' : ''}`).join('\n')}`).join('\n\n');
      return json({ weekStart: week, people, meals: items.length, ...(plan.items.length - items.length ? { skippedAsEaten: plan.items.length - items.length } : {}), ...list, markdown });
    },
  );

  server.registerTool(
    'log_planned_meal',
    {
      title: 'Log a planned meal as eaten',
      description:
        'Adds the planned meal(s) of a day to the food log (all meals of the day, or one slot), with the planned amounts. Use it when the person says they ate as planned; change grams afterwards with edit_food_entry if they differed. ' +
        'Meals already logged from the plan are skipped unless again is true. Returns the day\'s totals.',
      inputSchema: z.object({ day, slot: slot.optional(), again: z.boolean().default(false) }),
    },
    async ({ day: d, slot: s, again }) => {
      const week = mondayOf(d);
      const plan = await plans.plan(week);
      if (!plan) return toolError(`No meal plan for the week of ${week}.`);
      const picked = plan.items.filter((i) => i.day === d && (!s || i.slot === s) && (again || !i.loggedAt));
      if (!picked.length) return toolError(plan.items.some((i) => i.day === d && (!s || i.slot === s)) ? 'Those meals are already logged. Use again: true to log them once more.' : `Nothing planned for ${d}${s ? ` ${s}` : ''}.`);
      const entries: NewFoodEntry[] = picked.map((i) => ({
        day: d,
        slot: i.slot,
        foodRef: i.kind === 'food' ? (i.foodId ?? null) : i.kind === 'recipe' ? `recipe:${i.recipeId}` : null,
        foodName: i.kind === 'recipe' && i.servings !== 1 ? `${i.name} (${i.servings} servings)` : i.name,
        brand: null,
        grams: i.grams,
        kcal: i.kcal,
        protein: i.protein,
        carbs: i.carbs,
        fat: i.fat,
        estimated: i.kind === 'estimate',
      }));
      const added = await data.addFoodEntries(entries);
      const now = Date.now();
      for (const i of picked) i.loggedAt = now;
      await plans.savePlan(week, plan.items);
      const total = sum(await data.foodEntries(d));
      const goals = await data.goals();
      return json({ logged: added.map((e) => ({ id: e.id, slot: e.slot, food: e.foodName, grams: r0(e.grams), kcal: r0(e.kcal) })), dayTotals: roundForDisplay(total), ...(goals?.kcal ? { kcalRemaining: r0(goals.kcal - total.kcal) } : {}) });
    },
  );

  server.registerTool(
    'delete_meal_plan',
    { title: 'Delete a meal plan', description: 'Remove the plan of a week. Food already logged from it stays.', inputSchema: z.object({ week_start: day }), annotations: { destructiveHint: true, idempotentHint: true } },
    async ({ week_start }) => ((await plans.deletePlan(week_start)) ? json({ deleted: week_start }) : toolError('No plan for that week.')),
  );
}
