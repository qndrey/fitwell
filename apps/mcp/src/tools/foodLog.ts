import { addDays, isDay } from '@fitwell/core/domain/dates';
import { labelProblems, roundForDisplay, scale, sum, toPer100g, type Nutrients } from '@fitwell/core/domain/nutrition';
import { SLOTS, type Slot } from '@fitwell/core/schema';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { perServing, type PlanData } from '../data/planData';
import { slotAt, todayIn } from '../data/time';
import type { FoodEntry, Goals, NewFoodEntry } from '../data/userData';
import { checkAllergens } from '../safety/allergens';
import { resolveFood, type FoodDeps } from './foods';
import { json, toolError } from './result';

const day = z.string().refine(isDay, 'Use YYYY-MM-DD');
const slot = z.enum(SLOTS as [Slot, ...Slot[]]);
const per100g = z.object({ kcal: z.number().min(0).max(900), protein: z.number().min(0).max(100), carbs: z.number().min(0).max(100), fat: z.number().min(0).max(100) });

const round = (n: Nutrients) => roundForDisplay(n);
const view = (e: FoodEntry) => ({
  id: e.id,
  day: e.day,
  slot: e.slot,
  food: e.foodName,
  ...(e.brand ? { brand: e.brand } : {}),
  ...(e.foodRef ? { foodId: e.foodRef } : {}),
  grams: Math.round(e.grams * 10) / 10,
  ...round(e),
  ...(e.estimated ? { estimated: true } : {}),
});

/** What is left of each goal (negative = over). Only goals that are set. */
function remaining(total: Nutrients, goals: Goals | null) {
  if (!goals) return undefined;
  const left: Record<string, number> = {};
  if (goals.kcal != null) left.kcal = Math.round(goals.kcal - total.kcal);
  if (goals.proteinG != null) left.protein = Math.round(goals.proteinG - total.protein);
  if (goals.carbsG != null) left.carbs = Math.round(goals.carbsG - total.carbs);
  if (goals.fatG != null) left.fat = Math.round(goals.fatG - total.fat);
  return Object.keys(left).length ? left : undefined;
}

/** Allergy matches for one food: its name against the person's words, and a packaged product's allergen tags. */
function allergyNotes(name: string, terms: string[], food: { allergens?: string[]; traces?: string[] }): string[] {
  if (!terms.length) return [];
  const out: string[] = [];
  const byName = terms.filter((t) => name.toLowerCase().includes(t));
  const tags = checkAllergens(terms, food);
  const found = [...new Set([...byName, ...tags.contains])];
  if (found.length) out.push(`ALLERGY: ${name} contains ${found.join(', ')}.`);
  if (tags.traces.length) out.push(`ALLERGY (may contain traces): ${name} may contain traces of ${tags.traces.join(', ')}.`);
  return out;
}

export interface FoodLogDeps extends FoodDeps {
  plans: PlanData;
}

export function registerFoodLogTools(server: McpServer, deps: FoodLogDeps) {
  const { data, plans } = deps;
  const today = async () => todayIn((await data.profile()).timeZone);

  async function daySummary(d: string) {
    const entries = await data.foodEntries(d);
    const total = sum(entries);
    const goals = await data.goals();
    return { day: d, entries: entries.map(view), totals: round(total), remaining: remaining(total, goals) };
  }

  server.registerTool(
    'log_food',
    {
      title: 'Log food',
      description:
        'Record what the person ate, several items per call: a food id (search_foods, lookup_barcode, save_custom_food) with grams; a saved recipe with servings; ' +
        'or, only when nothing fits, a name with estimated per-100 g values (stored as an estimate; say so). copy_from repeats a meal or a whole day ("same breakfast as yesterday"). ' +
        "Convert portions to grams. day defaults to today, slot to the meal for the current time. Returns the day's totals and allergyWarnings (tell them plainly). " +
        'From a photo: find each item, estimate grams, set amount_estimated and say what you assumed.',
      inputSchema: z.object({
        day: day.optional(),
        slot: slot.optional().describe('With copy_from, default: each entry keeps its meal'),
        copy_from: z.object({ day, slot: slot.optional().describe('Default: the whole day') }).optional(),
        items: z
          .array(
            z
              .object({
                food_id: z.string().optional().describe('e.g. "frida:413", "off:5701234567892", "custom:<id>"'),
                recipe: z.string().min(1).max(80).optional().describe('Saved recipe id or name'),
                servings: z.number().positive().max(20).optional().describe('With recipe; default 1'),
                grams: z.number().positive().max(5000).optional(),
                name: z.string().min(1).max(100).optional().describe('Only for an estimate'),
                estimate_per100g: per100g.optional().describe('Only when no food id fits'),
                amount_estimated: z.boolean().optional().describe('The grams are a guess (photo): stored as an estimate'),
              })
              .refine((i) => i.recipe !== undefined || i.food_id !== undefined || (i.name !== undefined && i.estimate_per100g !== undefined), 'Give food_id, recipe, or name with estimate_per100g')
              .refine((i) => i.recipe !== undefined || i.grams !== undefined, 'grams is needed for a food or an estimate'),
          )
          .min(1)
          .max(20)
          .optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      if (!args.items && !args.copy_from) return toolError('Give items, copy_from, or both.');
      const profile = await data.profile();
      const d = args.day ?? todayIn(profile.timeZone);
      const s = args.slot ?? slotAt(profile.timeZone);
      const rows: NewFoodEntry[] = [];
      const missing: string[] = [];
      const allergyTerms = profile.diet.allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
      const allergyWarnings: string[] = [];
      if (args.copy_from) {
        const from = args.copy_from;
        const source = (await data.foodEntries(from.day)).filter((e) => !from.slot || e.slot === from.slot);
        if (!source.length) return toolError(`Nothing was logged: there is nothing logged on ${from.day}${from.slot ? ` for ${from.slot}` : ''} to copy.`);
        for (const e of source) {
          // Copies keep the stored snapshot (name and nutrition as logged then); the allergy check runs again in case allergies changed since.
          rows.push({ day: d, slot: args.slot ?? e.slot, foodRef: e.foodRef, foodName: e.foodName, brand: e.brand, grams: e.grams, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, estimated: e.estimated });
          allergyWarnings.push(...allergyNotes(e.foodName, allergyTerms, {}));
        }
      }
      for (const item of args.items ?? []) {
        if (item.recipe) {
          const key = item.recipe.replace(/^recipe:/, '');
          const recipe = (await plans.recipe(key)) ?? (await plans.recipeByName(item.recipe.trim()));
          if (!recipe) {
            missing.push(`recipe "${item.recipe}"`);
            continue;
          }
          const servings = item.servings ?? 1;
          const per = perServing(recipe);
          const grams = (recipe.items.reduce((n, i) => n + i.grams, 0) / recipe.servings) * servings;
          rows.push({ day: d, slot: s, foodRef: `recipe:${recipe.id}`, foodName: servings === 1 ? recipe.name : `${recipe.name} (${servings} servings)`, brand: null, grams, kcal: per.kcal * servings, protein: per.protein * servings, carbs: per.carbs * servings, fat: per.fat * servings, estimated: recipe.items.some((i) => !i.foodId) });
          for (const i of recipe.items) allergyWarnings.push(...allergyNotes(i.name, allergyTerms, i));
        } else if (item.food_id) {
          const food = await resolveFood(item.food_id, deps);
          if (!food) {
            missing.push(item.food_id);
            continue;
          }
          rows.push({ day: d, slot: s, foodRef: food.id, foodName: food.name, brand: food.brand ?? null, grams: item.grams!, ...scale(food.per100g, item.grams!), estimated: item.amount_estimated === true });
          allergyWarnings.push(...allergyNotes(food.name, allergyTerms, food));
        } else {
          rows.push({ day: d, slot: s, foodRef: null, foodName: item.name!, brand: null, grams: item.grams!, ...scale(item.estimate_per100g!, item.grams!), estimated: true });
          allergyWarnings.push(...allergyNotes(item.name!, allergyTerms, {}));
        }
      }
      if (missing.length) return toolError(`Nothing was logged: unknown ${missing.join(', ')}. Search again with search_foods, or list saved recipes with get_recipes.`);
      const added = await data.addFoodEntries(rows);
      return json({ logged: added.map(view), ...(allergyWarnings.length ? { allergyWarnings } : {}), ...(await daySummary(d)) });
    },
  );

  server.registerTool(
    'get_food_log',
    {
      title: 'Food log',
      description:
        "One day (default today): every entry with its id, the day's totals and what remains of the person's goals. " +
        'With days above 1: daily totals for that many days ending on day (default today), averages over the days that have food logged, and the goals.',
      inputSchema: z.object({ day: day.optional().describe('The day, or the last day of the period'), days: z.number().int().min(1).max(92).default(1) }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const to = args.day ?? (await today());
      if (args.days === 1) return json(await daySummary(to));
      const from = addDays(to, -(args.days - 1));
      const totals = await data.dayTotals(from, to);
      const avg = totals.length ? round(Object.fromEntries((['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => [k, totals.reduce((n, t) => n + t[k], 0) / totals.length])) as unknown as Nutrients) : null;
      return json({ from, to, daysLogged: totals.length, days: totals.map((t) => ({ day: t.day, entries: t.entries, ...round(t) })), averagePerLoggedDay: avg, goals: await data.goals() });
    },
  );

  server.registerTool(
    'edit_food_entry',
    {
      title: 'Edit a logged food',
      description: 'Change the grams (nutrition is rescaled), meal slot or day of an entry from get_food_log or log_food.',
      inputSchema: z.object({ id: z.uuid(), grams: z.number().positive().max(5000).optional(), slot: slot.optional(), day: day.optional() }),
      annotations: { idempotentHint: true },
    },
    async ({ id, ...patch }) => {
      const e = await data.updateFoodEntry(id, patch);
      return e ? json({ updated: view(e) }) : toolError('No such entry. Use get_food_log to see the entry ids.');
    },
  );

  server.registerTool(
    'save_custom_food',
    {
      title: 'Save your own food',
      description:
        "Save a food the databases don't have (a nutrition label, a home recipe) per 100 g or per serving, with optional portions. Use kcal, not kJ. " +
        'Values that do not match 4/4/9 kcal per g are refused with the reason: read the label again, then values_checked if it really says so. Returns "custom:<id>" for log_food.',
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        brand: z.string().max(60).optional(),
        per100g: per100g.optional(),
        per_serving: z
          .object({ grams: z.number().positive().max(2000), kcal: z.number().min(0).max(5000), protein: z.number().min(0).max(500), carbs: z.number().min(0).max(500), fat: z.number().min(0).max(500) })
          .optional()
          .describe('Instead of per100g'),
        portions: z.array(z.object({ label: z.string().min(1).max(40), grams: z.number().positive().max(5000) })).max(10).default([]),
        values_checked: z.boolean().default(false),
      }),
    },
    async ({ name, brand, per100g: given, per_serving, portions, values_checked }) => {
      if ((given === undefined) === (per_serving === undefined)) return toolError('Give the values either per100g or per_serving, not both.');
      const values = given ?? roundForDisplay(toPer100g(per_serving!, per_serving!.grams));
      const problems = labelProblems(values);
      if (problems.impossible.length) return toolError(`Nothing was saved. ${problems.impossible.join(' ')} Read the label again.`);
      if (problems.mismatch.length && !values_checked) return toolError(`Nothing was saved. ${problems.mismatch.join(' ')} Read the label again; if it really says this (alcohol, sweeteners), save again with values_checked: true.`);
      const withServing = per_serving && !portions.some((p) => p.grams === per_serving.grams) ? [...portions, { label: 'serving', grams: per_serving.grams }] : portions;
      const food = await data.addCustomFood({ name, brand: brand ?? null, per100g: values, portions: withServing });
      return json({ food: { id: `custom:${food.id}`, name: food.name, ...(food.brand ? { brand: food.brand } : {}), per100g: food.per100g, portions: food.portions } });
    },
  );
}
