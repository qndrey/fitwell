// Checks a week's plan against the person's goals and food rules, so Claude can fix problems before presenting it.
// Pure.
import { sumExtras, type Extras } from '@fitwell/core/domain/nutrition';
import { checkAllergens } from '../safety/allergens';
import type { Ingredient } from './grocery';

export const SLOT_NAMES = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export interface PlannedItem {
  day: string;
  slot: SlotName;
  kind: 'food' | 'recipe' | 'estimate';
  /** What to call it: the food or recipe name. */
  name: string;
  foodId?: string;
  recipeId?: string;
  /** Recipes only: how many servings of the recipe. */
  servings?: number;
  /** Total grams of the item as eaten. */
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Fibre, sugars... of the item as eaten, when known. */
  extras?: Extras;
  ingredients: Ingredient[];
  /** When it was logged to the food log from the plan, if it was. */
  loggedAt?: number;
}

export interface GoalsLike {
  kcal: number | null;
  proteinG: number | null;
}

export interface DayCheck {
  day: string;
  items: number;
  totals: { kcal: number; protein: number; carbs: number; fat: number };
  /** Fibre, sugars... over the planned items that know them; `extrasIncomplete` lists those some item lacks. */
  extras?: Extras;
  extrasIncomplete?: (keyof Extras)[];
  /** Totals minus goal, only where a goal is set. */
  vsGoal: { kcal?: number; protein?: number };
  status: { kcal?: 'ok' | 'low' | 'high'; protein?: 'ok' | 'short' };
}

export interface Warning {
  day: string;
  slot: SlotName;
  item: string;
  kind: 'allergy' | 'dislike';
  matches: string[];
  /** Allergy found only as a "may contain" trace on the label. */
  trace?: boolean;
}

export interface PlanCheck {
  days: DayCheck[];
  /** Days of the week with nothing planned. */
  emptyDays: string[];
  warnings: Warning[];
  /** Plain-language problems to fix, most important first (allergies first). */
  problems: string[];
  /** Things worth knowing that are not problems, e.g. packaged foods with no allergen data. */
  notes: string[];
}

const r0 = (n: number) => Math.round(n);

/** Names an allergy or dislike could hide in: the item and every ingredient. */
function matchTerms(item: PlannedItem, terms: string[]): string[] {
  const names = [item.name, ...item.ingredients.map((i) => i.name)].map((n) => n.toLowerCase());
  return terms.filter((t) => names.some((n) => n.includes(t)));
}

/**
 * Per day: totals against the calorie goal (within 10 % is fine) and the protein goal (at least 90 %). Across items:
 * allergies and dislikes found in names, and for packaged products the allergens and traces Open Food Facts lists.
 * Names are a text match ("peanut butter" for "peanut"), and foods without allergen data (Frida, own foods) can only be
 * matched by name, so Claude still has to think about the ingredients.
 */
export function checkPlan(weekDays: string[], items: PlannedItem[], goals: GoalsLike | null, allergies: string[] = [], dislikes: string[] = []): PlanCheck {
  const allergyTerms = allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const dislikeTerms = dislikes.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const days: DayCheck[] = [];
  const emptyDays: string[] = [];
  const problems: string[] = [];

  const warnings: Warning[] = [];
  const notes: string[] = [];
  const unchecked = new Set<string>();
  for (const it of items) {
    const a = matchTerms(it, allergyTerms);
    let traced: string[] = [];
    for (const ing of it.ingredients) {
      const c = checkAllergens(allergyTerms, ing);
      for (const t of c.contains) if (!a.includes(t)) a.push(t);
      traced = [...traced, ...c.traces.filter((t) => !traced.includes(t) && !a.includes(t))];
      if (allergyTerms.length && c.unknown && ing.foodId?.startsWith('off:')) unchecked.add(ing.name);
    }
    if (a.length) warnings.push({ day: it.day, slot: it.slot, item: it.name, kind: 'allergy', matches: a });
    if (traced.length) warnings.push({ day: it.day, slot: it.slot, item: it.name, kind: 'allergy', matches: traced, trace: true });
    const d = matchTerms(it, dislikeTerms);
    if (d.length) warnings.push({ day: it.day, slot: it.slot, item: it.name, kind: 'dislike', matches: d });
  }
  warnings.sort((x, y) => (x.kind === y.kind ? (x.day < y.day ? -1 : 1) : x.kind === 'allergy' ? -1 : 1));
  for (const w of warnings) problems.push(`${w.kind === 'allergy' ? (w.trace ? 'ALLERGY (may contain traces)' : 'ALLERGY') : 'Disliked food'}: ${w.item} (${w.day} ${w.slot}) ${w.trace ? 'may contain traces of' : 'contains'} ${w.matches.join(', ')}.`);
  if (unchecked.size) notes.push(`No allergen data for the packaged food ${[...unchecked].join('; ')}: read the label.`);

  for (const day of weekDays) {
    const list = items.filter((i) => i.day === day);
    if (!list.length) {
      emptyDays.push(day);
      continue;
    }
    const totals = list.reduce((t, i) => ({ kcal: t.kcal + i.kcal, protein: t.protein + i.protein, carbs: t.carbs + i.carbs, fat: t.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    const check: DayCheck = { day, items: list.length, totals: { kcal: r0(totals.kcal), protein: r0(totals.protein), carbs: r0(totals.carbs), fat: r0(totals.fat) }, vsGoal: {}, status: {} };
    const more = sumExtras(list.map((i) => i.extras));
    const rx = Object.fromEntries(Object.entries(more.totals).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    if (Object.keys(rx).length) check.extras = rx;
    if (more.incomplete.length) check.extrasIncomplete = more.incomplete;
    if (goals?.kcal) {
      check.vsGoal.kcal = r0(totals.kcal - goals.kcal);
      check.status.kcal = Math.abs(totals.kcal - goals.kcal) <= goals.kcal * 0.1 ? 'ok' : totals.kcal < goals.kcal ? 'low' : 'high';
      if (check.status.kcal !== 'ok') problems.push(`${day}: ${r0(totals.kcal)} kcal is ${Math.abs(check.vsGoal.kcal)} ${check.status.kcal === 'low' ? 'under' : 'over'} the ${goals.kcal} kcal goal.`);
    }
    if (goals?.proteinG) {
      check.vsGoal.protein = r0(totals.protein - goals.proteinG);
      check.status.protein = totals.protein >= goals.proteinG * 0.9 ? 'ok' : 'short';
      if (check.status.protein === 'short') problems.push(`${day}: protein ${r0(totals.protein)} g is ${Math.abs(check.vsGoal.protein)} g short of the ${goals.proteinG} g goal.`);
    }
    days.push(check);
  }
  if (emptyDays.length) problems.push(`Nothing planned on ${emptyDays.join(', ')}.`);
  return { days, emptyDays, warnings, problems, notes };
}
