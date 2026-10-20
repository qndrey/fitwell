import type { FoodItem } from '../domain/foods';
import { friendlyFoodName } from '../domain/foodNames';
import { EXTRA_KEYS, type Extras } from '../domain/nutrition';

export interface DatasetInfo {
  id: string;
  name: string;
  version: string;
  doi: string;
  license: string;
  attribution: string;
}

interface Raw {
  dataset: DatasetInfo;
  groups: string[];
  foods: [number, string, number, number, number, number, number, (number | null)[]?][];
}

const extrasOf = (x: (number | null)[]): Extras => {
  const out: Extras = {};
  EXTRA_KEYS.forEach((k, i) => {
    const v = x[i];
    if (v !== null && v !== undefined) out[k] = v;
  });
  return out;
};

let cache: Promise<{ info: DatasetInfo; foods: FoodItem[] }> | null = null;

/** Lazy-loaded (separate chunk, precached by the service worker). */
export function loadBundledFoods() {
  cache ??= import('./generated/foods.frida.json').then((m) => {
    const raw = m.default as unknown as Raw;
    const foods: FoodItem[] = raw.foods.map(([id, name, kcal, protein, carbs, fat, g, x]) => ({
      ref: { kind: 'bundled', id: `${raw.dataset.id}:${id}` },
      name: friendlyFoodName(name),
      group: raw.groups[g],
      per100g: { kcal, protein, carbs, fat },
      ...(x ? { extras: extrasOf(x) } : {}),
      portions: [],
    }));
    return { info: raw.dataset, foods };
  });
  // Don't remember a failed load (e.g. offline before the service worker cached the chunk).
  cache.catch(() => (cache = null));
  return cache;
}
