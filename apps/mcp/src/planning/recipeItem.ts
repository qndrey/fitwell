// A saved recipe as an item of a meal plan: shared by save_meal_plan and the meal plan view's swaps.
import { perServing, recipeExtras, type Recipe } from '../data/planData';
import type { PlannedItem, SlotName } from './check';
import type { Ingredient } from './grocery';
import { allergenFields } from './resolve';

export function plannedRecipe(r: Recipe, day: string, slot: SlotName, servings: number): PlannedItem {
  const f = servings / r.servings;
  const ingredients: Ingredient[] = r.items.map((x) => ({ ...(x.foodId ? { foodId: x.foodId } : {}), name: x.name, ...(x.group ? { group: x.group } : {}), ...allergenFields(x), grams: x.grams * f }));
  const total = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => r.items.reduce((n, x) => n + x[k], 0) * f;
  const extras = recipeExtras(r.items, f);
  return { day, slot, kind: 'recipe', name: r.name, recipeId: r.id, servings, grams: ingredients.reduce((n, x) => n + x.grams, 0), kcal: total('kcal'), protein: total('protein'), carbs: total('carbs'), fat: total('fat'), ...(extras ? { extras } : {}), ingredients };
}

/** What one serving of a recipe is worth, for the picker. */
export const servingKcal = (r: Recipe) => Math.round(perServing(r).kcal);
