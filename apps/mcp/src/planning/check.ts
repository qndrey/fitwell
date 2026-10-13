// Checks a week's plan against the person's goals and food rules, so Claude can fix problems before presenting it.
// Pure.
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
}

export interface PlanCheck {
  days: DayCheck[];
  /** Days of the week with nothing planned. */
  emptyDays: string[];
  warnings: Warning[];
  /** Plain-language problems to fix, most important first (allergies first). */
  problems: string[];
}

const r0 = (n: number) => Math.round(n);

/** Names an allergy or dislike could hide in: the item and every ingredient. */
function matchTerms(item: PlannedItem, terms: string[]): string[] {
  const names = [item.name, ...item.ingredients.map((i) => i.name)].map((n) => n.toLowerCase());
  return terms.filter((t) => names.some((n) => n.includes(t)));
}

/**
 * Per day: totals against the calorie goal (within 10 % is fine) and the protein goal (at least 90 %). Across items:
 * allergies and dislikes found in names. This is a text match on names, so it catches "peanut butter" for "peanut" but
 * not an allergen the name does not mention; Claude still has to think about the ingredients.
 */
export function checkPlan(weekDays: string[], items: PlannedItem[], goals: GoalsLike | null, allergies: string[] = [], dislikes: string[] = []): PlanCheck {
  const allergyTerms = allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const dislikeTerms = dislikes.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const days: DayCheck[] = [];
  const emptyDays: string[] = [];
  const problems: string[] = [];

  const warnings: Warning[] = [];
  for (const it of items) {
    const a = matchTerms(it, allergyTerms);
    if (a.length) warnings.push({ day: it.day, slot: it.slot, item: it.name, kind: 'allergy', matches: a });
    const d = matchTerms(it, dislikeTerms);
    if (d.length) warnings.push({ day: it.day, slot: it.slot, item: it.name, kind: 'dislike', matches: d });
  }
  warnings.sort((x, y) => (x.kind === y.kind ? (x.day < y.day ? -1 : 1) : x.kind === 'allergy' ? -1 : 1));
  for (const w of warnings) problems.push(`${w.kind === 'allergy' ? 'ALLERGY' : 'Disliked food'}: ${w.item} (${w.day} ${w.slot}) contains ${w.matches.join(', ')}.`);

  for (const day of weekDays) {
    const list = items.filter((i) => i.day === day);
    if (!list.length) {
      emptyDays.push(day);
      continue;
    }
    const totals = list.reduce((t, i) => ({ kcal: t.kcal + i.kcal, protein: t.protein + i.protein, carbs: t.carbs + i.carbs, fat: t.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    const check: DayCheck = { day, items: list.length, totals: { kcal: r0(totals.kcal), protein: r0(totals.protein), carbs: r0(totals.carbs), fat: r0(totals.fat) }, vsGoal: {}, status: {} };
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
  return { days, emptyDays, warnings, problems };
}
