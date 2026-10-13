// "What can I cook with what I have?": saved recipes ranked by how much of them is already in the kitchen. Pure.
import type { Recipe } from '../data/planData';

/** Things nobody lists as missing: they are always at home or add nothing to a decision. */
const STAPLES = /\b(salt|pepper|water|oil|sugar|vinegar|spice|spices|herbs?|stock|bouillon|flour|baking)\b/i;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const head = (name: string) => norm(name.split(',')[0]!);
/** "eggs" → "egg" so plurals match; leaves short words alone. */
const singular = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Does a thing the person has (free text, "chicken breast") cover an ingredient ("Chicken, breast, raw")? */
export function covers(have: string[], ingredientName: string): boolean {
  const full = norm(ingredientName).replace(/,/g, '');
  const first = singular(head(ingredientName));
  return have.map((h) => singular(norm(h))).some((h) => h.length > 1 && (full.includes(h) || (first.length > 2 && (h.includes(first) || first.includes(h)))));
}

export interface CookableRecipe {
  id: string;
  name: string;
  perServing: { kcal: number; protein: number };
  have: number;
  of: number;
  /** Ingredients not covered, without staples such as salt and oil. */
  missing: string[];
  /** One serving fits within the calories left today (10 % margin); null when no calorie goal is set. */
  fitsToday: boolean | null;
}

export function rankCookable(recipes: Pick<Recipe, 'id' | 'name' | 'servings' | 'items'>[], have: string[], kcalLeft: number | null, limit = 8): CookableRecipe[] {
  const rows = recipes.map((r) => {
    const counted = r.items.filter((i) => !STAPLES.test(i.name));
    const covered = counted.filter((i) => covers(have, i.name));
    const per = (k: 'kcal' | 'protein') => r.items.reduce((n, i) => n + i[k], 0) / r.servings;
    const row: CookableRecipe = {
      id: r.id,
      name: r.name,
      perServing: { kcal: Math.round(per('kcal')), protein: Math.round(per('protein')) },
      have: covered.length,
      of: counted.length,
      missing: counted.filter((i) => !covers(have, i.name)).map((i) => i.name),
      fitsToday: kcalLeft === null ? null : per('kcal') <= kcalLeft * 1.1,
    };
    return row;
  });
  const share = (r: CookableRecipe) => (r.of ? r.have / r.of : 1);
  return rows
    .filter((r) => r.have > 0)
    .sort((a, b) => share(b) - share(a) || (a.fitsToday === b.fitsToday ? 0 : a.fitsToday ? -1 : 1) || a.missing.length - b.missing.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}
