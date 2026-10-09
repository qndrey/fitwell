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
