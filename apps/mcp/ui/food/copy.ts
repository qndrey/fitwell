// Wording of the food summary. Pure (no DOM), so the tests can reach it.
export type ExtraKey = 'fiber' | 'sugar' | 'addedSugar' | 'satFat' | 'transFat' | 'salt';

export const EXTRA_NAMES: Record<ExtraKey, string> = { fiber: 'Fiber', sugar: 'Sugar', addedSugar: 'Added sugar', satFat: 'Sat. fat', transFat: 'Trans fat', salt: 'Salt' };
/** Reading order of the extras. */
export const EXTRA_ORDER: ExtraKey[] = ['satFat', 'transFat', 'sugar', 'addedSugar', 'fiber', 'salt'];

export const NO_LIMITS = 'No limits set. Ask Claude to set fibre or sugar goals.';

const num = (n: number, digits = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: digits });

/** "13 Oct · lunch · 2 foods": food names can contain commas, so they stay out of the line. */
export const subline = (day: string, slots: string[], foods: number) => [day, slots.join(', '), `${foods} ${foods === 1 ? 'food' : 'foods'}`].filter(Boolean).join(' · ');

/** A macro total: "240/150 g" against a goal, "240 g" without one. */
export const macroText = (value: number, goal: number | null) => ({ value: num(value), unit: goal !== null ? `/${num(goal)} g` : ' g' });

/** One compact line for the extras when none of them has a goal: "Sat. fat ≥4.1 g · Trans fat – · …". "≥" marks a minimum, "–" an unknown. */
export function extrasLine(extras: Partial<Record<ExtraKey, number>>, incomplete: ExtraKey[]) {
  return EXTRA_ORDER.map((k) => {
    const v = extras[k];
    return `${EXTRA_NAMES[k]} ${v === undefined ? '–' : `${incomplete.includes(k) ? '≥' : ''}${num(v, 1)} g`}`;
  }).join(' · ');
}
