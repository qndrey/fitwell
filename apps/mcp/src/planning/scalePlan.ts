// Scales a planned item by a portion (a household member eats 0.8 of the plan, or 1.5): amounts, nutrition, ingredients and recipe servings move together. Pure.
import type { Extras } from '@fitwell/core/domain/nutrition';
import type { PlannedItem } from './check';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function scaleItem(i: PlannedItem, f: number): PlannedItem {
  if (f === 1) return i;
  const extras = i.extras ? (Object.fromEntries(Object.entries(i.extras).map(([k, v]) => [k, typeof v === 'number' ? r3(v * f) : v])) as Extras) : undefined;
  return {
    ...i,
    grams: r1(i.grams * f),
    kcal: r1(i.kcal * f),
    protein: r1(i.protein * f),
    carbs: r1(i.carbs * f),
    fat: r1(i.fat * f),
    ...(i.servings !== undefined ? { servings: r3(i.servings * f) } : {}),
    ...(extras ? { extras } : {}),
    ingredients: i.ingredients.map((g) => ({ ...g, grams: r1(g.grams * f) })),
  };
}
