import type { Extras } from '../domain/nutrition';
import type { Candidate } from '../schema';

interface RawProduct {
  code?: unknown;
  product_name?: unknown;
  brands?: unknown;
  nutriments?: Record<string, unknown>;
  serving_quantity?: unknown;
  allergens_tags?: unknown;
  traces_tags?: unknown;
}

/** ["en:milk", "en:nuts"] → ["milk", "nuts"]; undefined when the field is missing (unknown, not "none"). */
const tags = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').map((t) => t.replace(/^[a-z]{2}:/, '').toLowerCase()) : undefined);

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Turns an Open Food Facts product into a candidate, or null if it can't be trusted:
 * needs a name and energy, per-100 g values must be plausible.
 */
export function toCandidate(raw: unknown): Candidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as RawProduct;
  const code = typeof p.code === 'string' || typeof p.code === 'number' ? String(p.code) : '';
  const name = typeof p.product_name === 'string' ? p.product_name.trim() : '';
  const n = p.nutriments ?? {};
  if (!code || !name) return null;

  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null) {
    const kj = num(n['energy_100g']); // kJ when no explicit kcal
    kcal = kj === null ? null : kj / 4.184;
  }
  if (kcal === null || kcal > 900) return null;

  const protein = num(n['proteins_100g']) ?? 0;
  const carbs = num(n['carbohydrates_100g']) ?? 0;
  const fat = num(n['fat_100g']) ?? 0;
  if (protein > 100 || carbs > 100 || fat > 100 || protein + carbs + fat > 105) return null;

  const extraValues: Extras = {};
  for (const [key, field] of [['fiber', 'fiber_100g'], ['sugar', 'sugars_100g'], ['addedSugar', 'added-sugars_100g'], ['satFat', 'saturated-fat_100g'], ['transFat', 'trans-fat_100g'], ['salt', 'salt_100g']] as const) {
    const v = num(n[field]);
    if (v !== null && v <= 100) extraValues[key] = round1(v);
  }
  const serving = num(p.serving_quantity);
  const brand = typeof p.brands === 'string' ? p.brands.split(',')[0]!.trim() : '';
  return {
    source: 'off',
    sourceId: code,
    name,
    brand: brand || undefined,
    per100g: { kcal: Math.round(kcal), protein: round1(protein), carbs: round1(carbs), fat: round1(fat) },
    ...(Object.keys(extraValues).length ? { extras: extraValues } : {}),
    portions: serving && serving > 0 && serving <= 2000 ? [{ label: 'serving', grams: serving }] : [],
    ...(tags(p.allergens_tags) ? { allergens: tags(p.allergens_tags) } : {}),
    ...(tags(p.traces_tags) ? { traces: tags(p.traces_tags) } : {}),
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Drops unusable products and duplicates (same name + brand), keeping the API's relevance order. */
export function toCandidates(products: unknown[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const raw of products) {
    const c = toCandidate(raw);
    if (!c) continue;
    const key = `${c.name.toLowerCase()}|${(c.brand ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
