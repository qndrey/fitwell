import type { FoodItem } from '../domain/foods';

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
  foods: [number, string, number, number, number, number, number][];
}

let cache: Promise<{ info: DatasetInfo; foods: FoodItem[] }> | null = null;

/** Lazy-loaded (separate chunk, precached by the service worker). */
export function loadBundledFoods() {
  cache ??= import('./generated/foods.frida.json').then((m) => {
    const raw = m.default as unknown as Raw;
    const foods: FoodItem[] = raw.foods.map(([id, name, kcal, protein, carbs, fat, g]) => ({
      ref: { kind: 'bundled', id: `${raw.dataset.id}:${id}` },
      name,
      group: raw.groups[g],
      per100g: { kcal, protein, carbs, fat },
      portions: [],
    }));
    return { info: raw.dataset, foods };
  });
  // Don't remember a failed load (e.g. offline before the service worker cached the chunk).
  cache.catch(() => (cache = null));
  return cache;
}
