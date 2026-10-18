import { scale, scaleExtras } from '@fitwell/core/domain/nutrition';
import * as z from 'zod';
import type { RecipeItem } from '../data/planData';
import { resolveFood, type FoodDeps, type FoodHit } from '../tools/foods';

export const per100gSchema = z.object({ kcal: z.number().min(0).max(900), protein: z.number().min(0).max(100), carbs: z.number().min(0).max(100), fat: z.number().min(0).max(100) });

/** A food by id with grams, or (only when nothing fits) a named estimate with per-100 g values. */
export const ingredientSchema = z
  .object({
    food_id: z.string().optional().describe('From search_foods, lookup_barcode or save_custom_food, e.g. "frida:413"'),
    grams: z.number().positive().max(5000),
    name: z.string().min(1).max(100).optional().describe('Only for an estimate'),
    estimate_per100g: per100gSchema.optional().describe('Only when no food id fits'),
  })
  .refine((i) => i.food_id !== undefined || (i.name !== undefined && i.estimate_per100g !== undefined), 'Give food_id, or name with estimate_per100g');
export type IngredientSpec = z.infer<typeof ingredientSchema>;

/** Looks each food up once per call, however often it appears. */
export class FoodMemo {
  private readonly cache = new Map<string, FoodHit | null>();
  constructor(private readonly deps: FoodDeps) {}
  async get(id: string): Promise<FoodHit | null> {
    if (!this.cache.has(id)) this.cache.set(id, await resolveFood(id, this.deps));
    return this.cache.get(id) ?? null;
  }
}

/** The allergen tags a packaged product carries, to store with the ingredient. */
export const allergenFields = (f: { allergens?: string[]; traces?: string[] }) => ({ ...(f.allergens ? { allergens: f.allergens } : {}), ...(f.traces?.length ? { traces: f.traces } : {}) });

/** Values come from the food's source, never from the conversation. Returns a message when the id is unknown. */
export async function resolveIngredient(spec: IngredientSpec, foods: FoodMemo): Promise<RecipeItem | string> {
  if (spec.food_id) {
    const hit = await foods.get(spec.food_id);
    if (!hit) return `Unknown food id ${spec.food_id}. Search again with search_foods.`;
    return { foodId: hit.id, name: hit.name, ...(hit.group ? { group: hit.group } : {}), ...allergenFields(hit), grams: spec.grams, ...scale(hit.per100g, spec.grams), ...(hit.extras ? { extras: scaleExtras(hit.extras, spec.grams) } : {}) };
  }
  return { name: spec.name!, grams: spec.grams, ...scale(spec.estimate_per100g!, spec.grams) };
}
