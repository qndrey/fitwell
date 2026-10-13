// The grocery list: ingredients of a week's plan added up per food, rounded to amounts you can buy, grouped by
// shopping section. Pure.

/** One ingredient of a planned item, with the food group the shopping section comes from. */
export interface Ingredient {
  foodId?: string;
  name: string;
  /** Frida food group; absent for packaged or own foods and estimates. */
  group?: string;
  grams: number;
}

export const AISLES = ['Produce', 'Meat', 'Fish and seafood', 'Dairy and eggs', 'Bakery', 'Plant-based', 'Pantry', 'Frozen', 'Snacks and sweets', 'Drinks', 'Ready meals', 'Other'] as const;
export type Aisle = (typeof AISLES)[number];

/** First matching rule wins, so the specific cases ("frozen", "canned", "dried") come before the general ones. */
const RULES: [RegExp, Aisle][] = [
  [/^frozen|ice cream|sorbet|ice lolly/i, 'Frozen'],
  [/juice|smoothie|beverage|beer|wine|spirit|liqueur|cider|water|coffee|tea|cocoa/i, 'Drinks'],
  [/plant-based/i, 'Plant-based'],
  [/ready meal|pizza|sandwich|burger|hotdog|composite|dessert/i, 'Ready meals'],
  [/cake|biscuit|cookie|candy|chocolate|snack|chip|sweet/i, 'Snacks and sweets'],
  [/meat|cold cuts|cured|offal|organs/i, 'Meat'], // before Pantry: "dried meat" is still meat
  [/canned|dried|jelly|marmelade|honey|sugar|salt|spice|vinegar|vegetable fats|margarine|animal fats|bouillon|sauce|dressing|mayonnaise|remoulade|condiment|flour|bran|grain|pasta|starch|yeast|baking|nut|seed|pulses|soup|breakfast|prepared legumes|legume products|infant/i, 'Pantry'],
  [/bread/i, 'Bakery'],
  [/beef|pork|chicken|turkey|veal|lamb|sheep|duck|goose|game|offal|organs|meat|cold cuts|poultry/i, 'Meat'],
  [/fish|shellfish|mollusk|aquatic|marine/i, 'Fish and seafood'],
  [/milk|cheese|butter|dairy|yoghurt|yogurt|fermented|egg|cream|whey/i, 'Dairy and eggs'],
  [/vegetable|fruit|berr|herb|mushroom|legume|seaweed|leaf|root|tuber/i, 'Produce'],
];

export function aisleOf(group: string | undefined): Aisle {
  if (!group) return 'Other';
  return RULES.find(([re]) => re.test(group))?.[1] ?? 'Other';
}

/** Round up to an amount a shop sells: 10 g steps under 100 g, 50 g up to 1 kg, 100 g steps above. */
export function buyableGrams(grams: number): number {
  if (grams <= 0) return 0;
  const step = grams < 100 ? 10 : grams < 1000 ? 50 : 100;
  return Math.ceil(grams / step - 1e-9) * step;
}

export function formatGrams(g: number): string {
  return g >= 1000 ? `${Math.round(g / 100) / 10} kg` : `${g} g`;
}

export interface GroceryEntry {
  name: string;
  /** The food is listed as cooked: its weight is after cooking, so what you buy raw weighs less. */
  cooked?: true;
  /** Exact total over the week. */
  grams: number;
  /** Rounded up to what to buy, e.g. "600 g" or "1.2 kg". */
  buy: string;
  foodId?: string;
  /** Where it is used, e.g. "Mon dinner"; at most 5, then "+N more". */
  usedIn: string[];
}

export interface GrocerySection {
  aisle: Aisle;
  items: GroceryEntry[];
}

export interface GroceryList {
  sections: GrocerySection[];
  itemCount: number;
  leftOut: string[];
  /** Things to know about the list, e.g. amounts given as cooked weight. */
  notes: string[];
}

const COOKED = /\b(boiled|cooked|fried|baked|roasted|grilled|steamed|stewed|braised)\b/i;

export interface Usage {
  /** Short label of where the ingredient is used, e.g. "Mon dinner". */
  label: string;
  ingredients: Ingredient[];
}

/**
 * Adds ingredients up per food (by food id, or by name for foods without one), scaled by `multiplier` (cooking for
 * two = 2), leaves out anything the person already has (`have`, matched on names, case-insensitive), rounds up to
 * buyable amounts and groups by shopping section, biggest amounts first.
 */
export function buildGroceryList(usages: Usage[], multiplier = 1, have: string[] = []): GroceryList {
  const haveTerms = have.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const byKey = new Map<string, { name: string; foodId?: string; group?: string; grams: number; labels: string[] }>();
  const leftOut = new Set<string>();
  for (const u of usages) {
    for (const ing of u.ingredients) {
      if (haveTerms.some((t) => ing.name.toLowerCase().includes(t))) {
        leftOut.add(ing.name);
        continue;
      }
      const key = ing.foodId ?? `name:${ing.name.toLowerCase()}`;
      const cur = byKey.get(key) ?? { name: ing.name, foodId: ing.foodId, group: ing.group, grams: 0, labels: [] };
      cur.grams += ing.grams * multiplier;
      if (!cur.labels.includes(u.label)) cur.labels.push(u.label);
      byKey.set(key, cur);
    }
  }
  const sections = new Map<Aisle, GroceryEntry[]>();
  for (const e of byKey.values()) {
    const buy = buyableGrams(e.grams);
    const entry: GroceryEntry = {
      name: e.name,
      grams: Math.round(e.grams),
      buy: formatGrams(buy),
      ...(COOKED.test(e.name) ? { cooked: true as const } : {}),
      ...(e.foodId ? { foodId: e.foodId } : {}),
      usedIn: e.labels.length > 5 ? [...e.labels.slice(0, 5), `+${e.labels.length - 5} more`] : e.labels,
    };
    const aisle = aisleOf(e.group);
    sections.set(aisle, [...(sections.get(aisle) ?? []), entry]);
  }
  const ordered: GrocerySection[] = AISLES.filter((a) => sections.has(a)).map((aisle) => ({ aisle, items: sections.get(aisle)!.sort((a, b) => b.grams - a.grams || a.name.localeCompare(b.name)) }));
  const cooked = ordered.flatMap((s) => s.items.filter((i) => i.cooked).map((i) => i.name));
  const notes = cooked.length
    ? [`Listed as cooked food (weight after cooking): ${cooked.join('; ')}. What you buy raw weighs less (rice and pasta roughly a third, meat roughly three quarters). Plan with the raw food, e.g. "Rice, polished, raw", to get exact amounts.`]
    : [];
  return { sections: ordered, itemCount: byKey.size, leftOut: [...leftOut].sort(), notes };
}
