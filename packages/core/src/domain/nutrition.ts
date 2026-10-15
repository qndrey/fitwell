export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Portion {
  label: string;
  grams: number;
}

/** What the user typed: an amount in grams, or a count of a named portion. */
export interface Quantity {
  amount: number;
  unit: 'g' | 'portion';
  portionLabel?: string;
}

export const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** Nutrients for `grams` of a food given per-100 g values. Unrounded. */
export function scale(per100g: Nutrients, grams: number): Nutrients {
  const k = grams / 100;
  return { kcal: per100g.kcal * k, protein: per100g.protein * k, carbs: per100g.carbs * k, fat: per100g.fat * k };
}

export function add(a: Nutrients, b: Nutrients): Nutrients {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
}

export function sum(list: Nutrients[]): Nutrients {
  return list.reduce(add, ZERO);
}

/** Grams for a quantity. A portion that no longer exists on the food counts as 0 (caller should validate). */
export function quantityGrams(q: Quantity, portions: Portion[]): number {
  if (q.unit === 'g') return q.amount;
  const p = portions.find((x) => x.label === q.portionLabel);
  return p ? q.amount * p.grams : 0;
}

/** Display rounding: kcal whole, macros to 0.1 g. Applied only when showing or snapshotting. */
export function roundForDisplay(n: Nutrients): Nutrients {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { kcal: Math.round(n.kcal), protein: r1(n.protein), carbs: r1(n.carbs), fat: r1(n.fat) };
}

/** Parses user-typed numbers; accepts a decimal comma. Returns null if not a finite number >= 0. */
export function parseAmount(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (s === '' || !/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Problems with label values per 100 g, in plain language. `impossible`: values no food can have (macros heavier
 * than the food, more energy than pure fat). `mismatch`: energy far from 4 kcal per g of protein and carbohydrate and
 * 9 per g of fat. Labels also count fibre (2 kcal/g), alcohol (7) and polyols, so energy may run a little above the
 * macros; a big gap usually means a misread label, often kJ typed as kcal, but a drink or a sweetener can be real.
 */
export function labelProblems(per100g: Nutrients): { impossible: string[]; mismatch: string[] } {
  const impossible: string[] = [];
  const mismatch: string[] = [];
  const grams = per100g.protein + per100g.carbs + per100g.fat;
  if (grams > 101) impossible.push(`Protein, carbohydrate and fat add up to ${Math.round(grams)} g in 100 g of food, which is not possible.`);
  if (per100g.kcal > 902) impossible.push(`${Math.round(per100g.kcal)} kcal in 100 g is not possible; pure fat has 900.`);
  const fromMacros = per100g.protein * 4 + per100g.carbs * 4 + per100g.fat * 9;
  const low = fromMacros * 0.85 - 10;
  const high = fromMacros * 1.15 + 25;
  if (per100g.kcal < low || per100g.kcal > high) {
    const asKcal = per100g.kcal / 4.184;
    const kj = Math.abs(asKcal - fromMacros) <= Math.max(fromMacros * 0.15, 10) ? ` ${per100g.kcal} looks like kJ (${Math.round(asKcal)} kcal).` : '';
    mismatch.push(`${Math.round(per100g.kcal)} kcal does not match the macros, which give about ${Math.round(fromMacros)} kcal.${kj}`);
  }
  return { impossible, mismatch };
}

/** Values given for a serving of `grams`, as values per 100 g. */
export function toPer100g(values: Nutrients, grams: number): Nutrients {
  return scale(values, 10000 / grams);
}
