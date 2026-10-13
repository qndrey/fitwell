import { addDays, isDay } from '@fitwell/core/domain/dates';
import { roundForDisplay, scale, sum, type Nutrients } from '@fitwell/core/domain/nutrition';
import { SLOTS, type Slot } from '@fitwell/core/schema';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { slotAt, todayIn } from '../data/time';
import type { FoodEntry, Goals, NewFoodEntry } from '../data/userData';
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

export function registerFoodLogTools(server: McpServer, deps: FoodDeps) {
  const { data } = deps;
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
        'Record what the person ate. Several items in one call. Each item is either a food id from search_foods, lookup_barcode or save_custom_food ' +
        '(macros come from that source) with grams, or, only when nothing suitable exists, a name with estimated per-100 g values (stored as an estimate; say so). ' +
        "Convert portions to grams first. day defaults to today in the person's time zone, slot to the meal for the current time. Returns the day's totals.",
      inputSchema: z.object({
        day: day.optional(),
        slot: slot.optional(),
        items: z
          .array(
            z
              .object({
                food_id: z.string().optional().describe('e.g. "frida:413", "off:5701234567892", "custom:<id>"'),
                grams: z.number().positive().max(5000),
                name: z.string().min(1).max(100).optional().describe('Only for an estimate'),
                estimate_per100g: per100g.optional().describe('Only when no food id fits'),
              })
              .refine((i) => i.food_id !== undefined || (i.name !== undefined && i.estimate_per100g !== undefined), 'Give food_id, or name with estimate_per100g'),
          )
          .min(1)
          .max(20),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const profile = await data.profile();
      const d = args.day ?? todayIn(profile.timeZone);
      const s = args.slot ?? slotAt(profile.timeZone);
      const rows: NewFoodEntry[] = [];
      const missing: string[] = [];
      for (const item of args.items) {
        if (item.food_id) {
          const food = await resolveFood(item.food_id, deps);
          if (!food) {
            missing.push(item.food_id);
            continue;
          }
          rows.push({ day: d, slot: s, foodRef: food.id, foodName: food.name, brand: food.brand ?? null, grams: item.grams, ...scale(food.per100g, item.grams), estimated: false });
        } else {
          rows.push({ day: d, slot: s, foodRef: null, foodName: item.name!, brand: null, grams: item.grams, ...scale(item.estimate_per100g!, item.grams), estimated: true });
        }
      }
      if (missing.length) return toolError(`Nothing was logged: unknown food ids ${missing.join(', ')}. Search again with search_foods.`);
      const added = await data.addFoodEntries(rows);
      return json({ logged: added.map(view), ...(await daySummary(d)) });
    },
  );

  server.registerTool(
    'get_day',
    {
      title: 'Food for a day',
      description: "Everything logged on a day (default today), the day's totals and what remains of the person's goals.",
      inputSchema: z.object({ day: day.optional() }),
      annotations: { readOnlyHint: true },
    },
    async (args) => json(await daySummary(args.day ?? (await today()))),
  );

  server.registerTool(
    'get_nutrition_summary',
    {
      title: 'Nutrition over several days',
      description: 'Daily totals for a period (default the last 7 days including today), averages over the days that have food logged, and the goals.',
      inputSchema: z.object({ to: day.optional(), days: z.number().int().min(1).max(92).default(7) }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const to = args.to ?? (await today());
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
      description: 'Change the grams (nutrition is rescaled), meal slot or day of an entry from get_day or log_food.',
      inputSchema: z.object({ id: z.uuid(), grams: z.number().positive().max(5000).optional(), slot: slot.optional(), day: day.optional() }),
      annotations: { idempotentHint: true },
    },
    async ({ id, ...patch }) => {
      const e = await data.updateFoodEntry(id, patch);
      return e ? json({ updated: view(e) }) : toolError('No such entry. Use get_day to see the entry ids.');
    },
  );

  server.registerTool(
    'delete_food_entry',
    {
      title: 'Delete a logged food',
      description: 'Remove one entry from the food log.',
      inputSchema: z.object({ id: z.uuid() }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => ((await data.deleteFoodEntry(id)) ? json({ deleted: id }) : toolError('No such entry. Use get_day to see the entry ids.')),
  );

  server.registerTool(
    'save_custom_food',
    {
      title: 'Save your own food',
      description:
        "Save a food the databases don't have (e.g. from a nutrition label or a home recipe), with values per 100 g and optional portion sizes. " +
        'Returns an id ("custom:<id>") for log_food; search_foods finds it by name later.',
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        brand: z.string().max(60).optional(),
        per100g,
        portions: z.array(z.object({ label: z.string().min(1).max(40), grams: z.number().positive().max(5000) })).max(10).default([]),
      }),
    },
    async ({ name, brand, per100g: values, portions }) => {
      const food = await data.addCustomFood({ name, brand: brand ?? null, per100g: values, portions });
      return json({ food: { id: `custom:${food.id}`, name: food.name, ...(food.brand ? { brand: food.brand } : {}), per100g: food.per100g, portions: food.portions } });
    },
  );
}
