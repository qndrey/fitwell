// Logs planned meals to the food log as eaten: shared by log_planned_meal (Claude) and the Today view's one-tap button.
import { weekStart } from '@fitwell/core/domain/dates';
import type { PlanData } from '../data/planData';
import type { FoodEntry, NewFoodEntry, UserData } from '../data/userData';
import type { PlannedItem, SlotName } from './check';

export type LogPlanned = { ok: true; added: FoodEntry[] } | { ok: false; error: string };

/** The food log entry that eating a planned item adds, with the planned amounts. */
export const foodEntryFor = (i: PlannedItem): NewFoodEntry => ({
  day: i.day,
  slot: i.slot,
  foodRef: i.kind === 'food' ? (i.foodId ?? null) : i.kind === 'recipe' ? `recipe:${i.recipeId}` : null,
  foodName: i.kind === 'recipe' && i.servings !== 1 ? `${i.name} (${i.servings} servings)` : i.name,
  brand: null,
  grams: i.grams,
  kcal: i.kcal,
  protein: i.protein,
  carbs: i.carbs,
  fat: i.fat,
  ...(i.extras ? { extras: i.extras } : {}),
  estimated: i.kind === 'estimate',
});

/** The planned meals of a day (or one slot) that are not logged yet, added to the food log with their planned amounts and marked logged in the plan. */
export async function logPlannedMeals(data: UserData, plans: PlanData, day: string, slot: SlotName | undefined, again: boolean): Promise<LogPlanned> {
  const week = weekStart(day);
  const plan = await plans.plan(week);
  if (!plan) return { ok: false, error: `No meal plan for the week of ${week}.` };
  const picked = plan.items.filter((i) => i.day === day && (!slot || i.slot === slot) && (again || !i.loggedAt));
  if (!picked.length) {
    return { ok: false, error: plan.items.some((i) => i.day === day && (!slot || i.slot === slot)) ? 'Those meals are already logged. Use again: true to log them once more.' : `Nothing planned for ${day}${slot ? ` ${slot}` : ''}.` };
  }
  const entries = picked.map(foodEntryFor);
  const added = await data.addFoodEntries(entries);
  const now = Date.now();
  for (const i of picked) i.loggedAt = now;
  await plans.savePlan(week, plan.items);
  return { ok: true, added };
}
