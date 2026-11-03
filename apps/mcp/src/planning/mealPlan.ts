// The meal plan view's data and its edits (D6). Every edit goes through the same checks as save_meal_plan: the plan is checked against the goals,
// allergies and dislikes afterwards, and an edit that would bring an allergy match into the plan is refused (an allergy is never presented).
import { addDays } from '@fitwell/core/domain/dates';
import type { MealPlanView, PlanDay } from '../analytics/mealPlanTypes';
import type { HouseholdData } from '../data/households';
import type { PlanData } from '../data/planData';
import { todayIn } from '../data/time';
import type { UserData } from '../data/userData';
import { foodEntryFor } from './logPlanned';
import { checkPlan, SLOT_NAMES, type PlannedItem, type Warning } from './check';
import { plannedRecipe, servingKcal } from './recipeItem';

export interface MealPlanDeps {
  data: UserData;
  plans: PlanData;
  /** For the household's side-by-side portions (B2). */
  households?: HouseholdData;
}

/** A copy of a planned item for another place: not eaten there. */
function unlogged(i: PlannedItem, day: string): PlannedItem {
  const copy = { ...i, day };
  delete copy.loggedAt;
  return copy;
}

const r0 = (n: number) => Math.round(n);
const weekdayOf = (d: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
export const weekDaysOf = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
const bySlot = (a: PlannedItem, b: PlannedItem) => (a.day === b.day ? SLOT_NAMES.indexOf(a.slot) - SLOT_NAMES.indexOf(b.slot) : a.day < b.day ? -1 : 1);

async function checked(deps: MealPlanDeps, week: string, items: PlannedItem[]) {
  const profile = await deps.data.profile();
  return checkPlan(weekDaysOf(week), items, await deps.data.goals(), profile.diet.allergies, profile.diet.dislikes);
}

const warningText = (w: Warning) => `${w.kind === 'allergy' ? (w.trace ? 'ALLERGY (may contain traces)' : 'ALLERGY') : 'Disliked food'}: ${w.item} (${weekdayOf(w.day)} ${w.slot}) ${w.trace ? 'may contain traces of' : 'contains'} ${w.matches.join(', ')}.`;

/** The week as the view draws it; null when there is no plan for it. */
export async function buildMealPlan(deps: MealPlanDeps, week: string, now: Date = new Date()): Promise<MealPlanView | null> {
  const plan = await deps.plans.plan(week);
  if (!plan) return null;
  const profile = await deps.data.profile();
  const today = todayIn(profile.timeZone, now);
  const goals = await deps.data.goals();
  const check = await checked(deps, week, plan.items);
  const days: PlanDay[] = weekDaysOf(week).map((day) => {
    const c = check.days.find((x) => x.day === day);
    return {
      day,
      weekday: weekdayOf(day),
      past: day < today,
      meals: plan.items.flatMap((i, index) => (i.day === day ? [{ index, slot: i.slot, name: i.name, kind: i.kind, servings: i.kind === 'recipe' ? (i.servings ?? 1) : null, kcal: r0(i.kcal), protein: r0(i.protein), logged: i.loggedAt !== undefined }] : [])),
      totals: c ? { kcal: c.totals.kcal, protein: c.totals.protein } : null,
      status: { kcal: c?.status.kcal ?? null, protein: c?.status.protein ?? null },
      vsGoal: { kcal: c?.vsGoal.kcal ?? null, protein: c?.vsGoal.protein ?? null },
    };
  });
  // A week that follows the household's plan shows what each member's portion comes to, so cooking for different portions is clear at a glance.
  const info = deps.households && (await deps.plans.followsHousehold(week)) ? await deps.households.info() : null;
  const mine = info?.members.find((m) => m.you)?.portion ?? 1;
  if (info) for (const d of days) for (const m of d.meals) m.memberKcal = info.members.map((x) => r0((m.kcal / mine) * x.portion));
  const recipes = (await deps.plans.recipes()).slice(0, 40).map((r) => ({ id: r.id, name: r.name, kcalPerServing: servingKcal(r) }));
  return {
    weekStart: week,
    today,
    version: plan.updatedAt,
    goals: { kcal: goals?.kcal ?? null, proteinG: goals?.proteinG ?? null },
    days,
    ...(info ? { household: { members: info.members.map((m) => ({ label: m.nickname ?? m.email ?? 'member', portion: m.portion, you: m.you })) } } : {}),
    warnings: check.warnings.map(warningText),
    problems: check.problems.filter((p) => !/^(ALLERGY|Disliked food)/.test(p)),
    recipes,
  };
}

export type EditResult = { ok: true } | { ok: false; error: string };

const allergyKeys = (ws: Warning[]) => new Set(ws.filter((w) => w.kind === 'allergy').map((w) => `${w.day}|${w.slot}|${w.item}|${w.trace ? 't' : 'c'}|${w.matches.join(',')}`));

/** Saves an edited plan unless it would bring in an allergy match the plan did not have. */
async function saveEdited(deps: MealPlanDeps, week: string, before: PlannedItem[], after: PlannedItem[]): Promise<EditResult> {
  after.sort(bySlot);
  const had = allergyKeys((await checked(deps, week, before)).warnings);
  const added = [...allergyKeys((await checked(deps, week, after)).warnings)].filter((k) => !had.has(k));
  if (added.length) {
    const names = [...new Set(added.map((k) => k.split('|')[2]))];
    return { ok: false, error: `Not changed: ${names.join(', ')} matches an allergy on the profile.` };
  }
  await deps.plans.savePlan(week, after);
  return { ok: true };
}

async function load(deps: MealPlanDeps, week: string, version: number): Promise<{ ok: true; items: PlannedItem[] } | { ok: false; error: string }> {
  const plan = await deps.plans.plan(week);
  if (!plan) return { ok: false, error: `No meal plan for the week of ${week}.` };
  if (plan.updatedAt !== version) return { ok: false, error: 'The plan changed since this view was opened. Open it again.' };
  return { ok: true, items: plan.items };
}

/** Replaces one meal with a saved recipe, or with a copy of another meal of the plan (in the place of the first). A meal already logged stays as it is. */
export async function replaceMeal(deps: MealPlanDeps, week: string, version: number, index: number, source: { recipeId: string; servings?: number } | { copyFrom: number }): Promise<EditResult> {
  const got = await load(deps, week, version);
  if (!got.ok) return got;
  const items = got.items;
  const target = items[index];
  if (!target) return { ok: false, error: 'There is no such meal in the plan.' };
  if (target.loggedAt !== undefined) return { ok: false, error: `${target.name} is already logged as eaten, so it is not changed.` };
  let next: PlannedItem;
  if ('recipeId' in source) {
    const recipe = await deps.plans.recipe(source.recipeId);
    if (!recipe) return { ok: false, error: 'That recipe is not saved any more.' };
    next = plannedRecipe(recipe, target.day, target.slot, source.servings ?? 1);
  } else {
    const from = items[source.copyFrom];
    if (!from || source.copyFrom === index) return { ok: false, error: 'There is no such meal to copy.' };
    next = { ...unlogged(from, target.day), slot: target.slot };
  }
  return saveEdited(deps, week, items, items.map((i, k) => (k === index ? next : i)));
}

/** Makes one day's meals a copy of another day's. Refused when the day being replaced already has a meal logged as eaten. */
export async function repeatDay(deps: MealPlanDeps, week: string, version: number, fromDay: string, toDay: string): Promise<EditResult> {
  const days = weekDaysOf(week);
  if (!days.includes(fromDay) || !days.includes(toDay) || fromDay === toDay) return { ok: false, error: 'Pick two different days of this week.' };
  const got = await load(deps, week, version);
  if (!got.ok) return got;
  const items = got.items;
  const source = items.filter((i) => i.day === fromDay);
  if (!source.length) return { ok: false, error: 'There is nothing planned on that day to repeat.' };
  if (items.some((i) => i.day === toDay && i.loggedAt !== undefined)) return { ok: false, error: 'That day has a meal already logged as eaten, so it is not replaced.' };
  const copies = source.map((i) => unlogged(i, toDay));
  return saveEdited(deps, week, items, [...items.filter((i) => i.day !== toDay), ...copies]);
}

/** Logs one planned meal as eaten, with the planned amounts. Only a meal of today or an earlier day, and only once. */
export async function eatMeal(deps: MealPlanDeps, week: string, version: number, index: number, now: Date = new Date()): Promise<EditResult> {
  const got = await load(deps, week, version);
  if (!got.ok) return got;
  const item = got.items[index];
  if (!item) return { ok: false, error: 'There is no such meal in the plan.' };
  if (item.loggedAt !== undefined) return { ok: false, error: `${item.name} is already logged as eaten.` };
  if (item.day > todayIn((await deps.data.profile()).timeZone, now)) return { ok: false, error: 'That meal is still ahead, so it cannot be logged as eaten yet.' };
  await deps.data.addFoodEntries([foodEntryFor(item)]);
  item.loggedAt = now.getTime();
  await deps.plans.savePlan(week, got.items);
  return { ok: true };
}
