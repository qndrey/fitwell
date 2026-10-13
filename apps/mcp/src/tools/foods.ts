import { loadBundledFoods } from '@fitwell/core/data/bundledFoods';
import type { FoodItem } from '@fitwell/core/domain/foods';
import type { Nutrients, Portion } from '@fitwell/core/domain/nutrition';
import { looksLikeBarcode, normalizeBarcode } from '@fitwell/core/ean';
import { OffError, type OffClient } from '@fitwell/core/off/client';
import type { Candidate } from '@fitwell/core/schema';
import type { CustomFood } from '../data/userData';
import { prepare, search, type Searchable } from '@fitwell/core/search/rank';
import { tokenize } from '@fitwell/core/search/text';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { UserData } from '../data/userData';
import { json, toolError } from './result';

/** One food as Claude sees it. `id` is what later tools (logging, recipes) will take. */
export interface FoodHit {
  id: string;
  name: string;
  brand?: string;
  group?: string;
  source: 'frida' | 'openfoodfacts' | 'custom';
  per100g: Nutrients;
  portions: Portion[];
  /** Packaged products: allergens and traces from Open Food Facts (absent = not known). */
  allergens?: string[];
  traces?: string[];
}

const ATTRIBUTION = {
  frida: 'Frida 5.5, DTU National Food Institute (CC BY 4.0)',
  openfoodfacts: 'Open Food Facts contributors (ODbL)',
};

let index: Promise<Searchable<FoodItem>[]> | null = null;
const fridaIndex = () => (index ??= loadBundledFoods().then((d) => prepare(d.foods, (f) => f.name)));
let byId: Promise<Map<string, FoodItem>> | null = null;
const fridaById = () => (byId ??= loadBundledFoods().then((d) => new Map(d.foods.map((f) => [f.ref.id, f]))));

const fromFrida = (f: FoodItem): FoodHit => ({ id: f.ref.id, name: f.name, group: f.group, source: 'frida', per100g: f.per100g, portions: f.portions });
const fromOff = (c: Candidate): FoodHit => ({ id: `off:${c.sourceId}`, name: c.name, brand: c.brand, source: 'openfoodfacts', per100g: c.per100g, portions: c.portions, ...(c.allergens ? { allergens: c.allergens } : {}), ...(c.traces ? { traces: c.traces } : {}) });

const fromCustom = (c: CustomFood): FoodHit => ({ id: `custom:${c.id}`, name: c.name, brand: c.brand ?? undefined, source: 'custom', per100g: c.per100g, portions: c.portions });

/**
 * Frida names foods "Item, descriptor" ("Egg, chicken, whole, raw"). The text search favours short names, so "egg" would
 * start with "Egg mayonnaise salad"; names whose first part is exactly the query go first, the rest keep their order.
 */
export function plainFoodsFirst<T extends { name: string }>(query: string, hits: T[]): T[] {
  const wanted = tokenize(query).join(' ');
  const plain = (h: T) => tokenize(h.name.split(',')[0]!).join(' ') === wanted;
  return [...hits.filter(plain), ...hits.filter((h) => !plain(h))];
}

export async function searchFrida(query: string, limit: number): Promise<FoodHit[]> {
  return plainFoodsFirst(query, search(await fridaIndex(), query, Math.max(limit * 6, 60)).map(fromFrida)).slice(0, limit);
}

export interface FoodDeps {
  off: OffClient;
  data: UserData;
}

/**
 * The food behind an id from search_foods / lookup_barcode / save_custom_food, with values from its source.
 * Logging resolves ids here so stored macros come from the database, not from the conversation.
 */
export async function resolveFood(id: string, deps: FoodDeps): Promise<FoodHit | null> {
  if (id.startsWith('frida:')) {
    const f = (await fridaById()).get(id);
    return f ? fromFrida(f) : null;
  }
  if (id.startsWith('custom:')) {
    const c = await deps.data.customFood(id.slice('custom:'.length));
    return c ? fromCustom(c) : null;
  }
  if (id.startsWith('off:')) {
    const code = normalizeBarcode(id.slice('off:'.length));
    const c = code ? await deps.off.product(code, 'interactive') : null;
    return c ? fromOff(c) : null;
  }
  return null;
}

export function registerFoodTools(server: McpServer, deps: FoodDeps) {
  server.registerTool(
    'search_foods',
    {
      title: 'Search foods',
      description:
        "Find foods and their macros per 100 g. Searches the person's own saved foods and the Frida 5.5 Danish food database (generic foods, in English). " +
        'Set include_packaged for branded or packaged products, which also searches Open Food Facts (slower, rate-limited, sometimes unavailable). ' +
        'For a product with a barcode use lookup_barcode instead. Values are per 100 g; Frida foods have no portion sizes, so estimate grams.',
      inputSchema: z.object({
        query: z.string().min(1).max(100).describe('Food name in English, e.g. "oats", "chicken breast", "greek yoghurt"'),
        include_packaged: z.boolean().default(false).describe('Also search Open Food Facts for branded products'),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, include_packaged, limit }) => {
      const own = search(prepare(await deps.data.customFoods(), (c) => c.name), query, limit).map(fromCustom);
      const foods = [...own, ...(await searchFrida(query, limit))];
      let packagedNote: string | undefined;
      if (include_packaged) {
        try {
          foods.push(...(await deps.off.search(query, 'interactive')).slice(0, limit).map(fromOff));
        } catch (e) {
          packagedNote = e instanceof OffError && e.kind === 'rate' ? 'Open Food Facts asked us to slow down; try again in a minute.' : 'Open Food Facts is unavailable right now.';
        }
      }
      return json({ foods, ...(packagedNote ? { note: packagedNote } : {}), sources: ATTRIBUTION });
    },
  );

  server.registerTool(
    'lookup_barcode',
    {
      title: 'Look up a barcode',
      description: 'Macros per 100 g (and serving size when known) for a packaged product by its EAN/UPC barcode, from Open Food Facts.',
      inputSchema: z.object({ barcode: z.string().describe('8 to 14 digits, spaces allowed') }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ barcode }) => {
      const code = looksLikeBarcode(barcode) ? normalizeBarcode(barcode) : null;
      if (!code) return toolError('That is not a valid EAN/UPC barcode (8 to 14 digits with a correct check digit).');
      try {
        const hit = await deps.off.product(code, 'interactive');
        if (!hit) return toolError(`Open Food Facts does not know barcode ${code}. Ask for the label values instead.`);
        return json({ food: fromOff(hit), sources: { openfoodfacts: ATTRIBUTION.openfoodfacts } });
      } catch {
        return toolError('Open Food Facts is unavailable right now; try again shortly or use the label values.');
      }
    },
  );
}
