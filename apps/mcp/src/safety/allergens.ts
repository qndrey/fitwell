// Allergy checks that go beyond a text match on names. Open Food Facts lists the allergens of a packaged product as
// tags ("milk", "gluten"); the person's allergies are free text ("lactose", "tree nuts", "wheat"), so they are mapped to
// the 14 EU allergen groups first. Pure.

/** Open Food Facts tag (language prefix removed) → words in a person's own wording that mean it. */
const GROUPS: Record<string, string[]> = {
  milk: ['milk', 'dairy', 'lactose', 'casein', 'whey', 'cheese', 'butter', 'cream', 'yoghurt', 'yogurt'],
  gluten: ['gluten', 'wheat', 'barley', 'rye', 'oat', 'spelt', 'coeliac', 'celiac', 'seitan'],
  eggs: ['egg', 'eggs'],
  peanuts: ['peanut', 'peanuts', 'groundnut'],
  nuts: ['nut', 'nuts', 'tree nut', 'tree nuts', 'almond', 'hazelnut', 'walnut', 'cashew', 'pistachio', 'pecan', 'brazil nut', 'macadamia'],
  soybeans: ['soy', 'soya', 'soybean', 'soybeans', 'tofu'],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'anchovy', 'anchovies'],
  crustaceans: ['crustacean', 'crustaceans', 'shellfish', 'shrimp', 'prawn', 'prawns', 'crab', 'lobster'],
  molluscs: ['mollusc', 'molluscs', 'mollusk', 'shellfish', 'mussel', 'mussels', 'oyster', 'squid', 'clam'],
  celery: ['celery', 'celeriac'],
  mustard: ['mustard'],
  'sesame-seeds': ['sesame', 'tahini'],
  'sulphur-dioxide-and-sulphites': ['sulphite', 'sulphites', 'sulfite', 'sulfites', 'sulphur dioxide'],
  lupin: ['lupin', 'lupine'],
};

/** The allergen tags a piece of the person's allergy text stands for (none when it is not one of the 14 groups). */
export function allergenTags(allergy: string): string[] {
  const a = allergy.trim().toLowerCase();
  if (!a) return [];
  return Object.entries(GROUPS)
    .filter(([tag, words]) => tag === a || words.includes(a) || a.split(/[\s,/-]+/).some((w) => words.includes(w) && w.length > 2))
    .map(([tag]) => tag);
}

export interface AllergenData {
  /** Absent = the source gave no allergen information (unknown, not "none"). */
  allergens?: string[];
  traces?: string[];
}

export interface AllergenCheck {
  /** Tags of the person's allergies found in the product. */
  contains: string[];
  /** Found only as "may contain" traces. */
  traces: string[];
  /** The product has no allergen information at all, so nothing could be checked. */
  unknown: boolean;
}

/** Packaged food: compare the product's tags with the person's allergies. Foods from Frida have no tags (unknown). */
export function checkAllergens(allergies: string[], food: AllergenData): AllergenCheck {
  const wanted = new Set(allergies.flatMap(allergenTags));
  return {
    contains: (food.allergens ?? []).filter((t) => wanted.has(t)),
    traces: (food.traces ?? []).filter((t) => wanted.has(t) && !(food.allergens ?? []).includes(t)),
    unknown: food.allergens === undefined,
  };
}
