// A person's recipes and weekly meal plans. Like UserData, every query is bound to the signed-in user's id.
import { sumExtras, type Extras } from '@fitwell/core/domain/nutrition';
import type { PlannedItem } from '../planning/check';
import type { Ingredient } from '../planning/grocery';

/** An ingredient with its nutrition as it was when the recipe was saved. */
export interface RecipeItem extends Ingredient {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Fibre, sugars... for this amount, when the food source has them. */
  extras?: Extras;
}

export interface Recipe {
  id: string;
  name: string;
  servings: number;
  items: RecipeItem[];
  notes: string | null;
  /** Where the recipe came from, when it was imported from a web page. */
  sourceUrl: string | null;
  /** The method, one step per entry. */
  steps: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Plan {
  id: string;
  weekStart: string;
  items: PlannedItem[];
  createdAt: number;
  updatedAt: number;
}

type Row = Record<string, unknown>;
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const toRecipe = (r: Row): Recipe => ({ id: r.id as string, name: r.name as string, servings: r.servings as number, items: parse<RecipeItem[]>(r.items, []), notes: (r.notes as string | null) ?? null, sourceUrl: (r.source_url as string | null) ?? null, steps: parse<string[]>(r.steps, []), createdAt: r.created_at as number, updatedAt: r.updated_at as number });
const toPlan = (r: Row): Plan => ({ id: r.id as string, weekStart: r.week_start as string, items: parse<PlannedItem[]>(r.items, []), createdAt: r.created_at as number, updatedAt: r.updated_at as number });

/** Nutrition of one serving of a recipe. */
export function perServing(r: Pick<Recipe, 'items' | 'servings'>) {
  const sum = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => r.items.reduce((n, i) => n + i[k], 0) / r.servings;
  return { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') };
}

/** Extras of a whole recipe (all servings), scaled by `factor`; undefined when no ingredient knows any. */
export function recipeExtras(items: Pick<RecipeItem, 'extras'>[], factor = 1): Extras | undefined {
  const { totals } = sumExtras(items.map((i) => i.extras));
  const out = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v * factor]));
  return Object.keys(out).length ? (out as Extras) : undefined;
}

export class PlanData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------- recipes ----------
  /** Saves under the name; an existing recipe of that name is replaced. */
  async saveRecipe(name: string, servings: number, items: RecipeItem[], extra: { notes: string | null; sourceUrl: string | null; steps: string[] }): Promise<Recipe> {
    const now = this.now();
    await this.db
      .prepare(
        `INSERT INTO recipes (id, user_id, name, servings, items, notes, source_url, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, name) DO UPDATE SET servings = excluded.servings, items = excluded.items, notes = excluded.notes, source_url = excluded.source_url, steps = excluded.steps, updated_at = excluded.updated_at`,
      )
      .bind(crypto.randomUUID(), this.userId, name, servings, JSON.stringify(items), extra.notes, extra.sourceUrl, extra.steps.length ? JSON.stringify(extra.steps) : null, now, now)
      .run();
    return (await this.recipeByName(name))!;
  }

  async recipeByName(name: string): Promise<Recipe | null> {
    const r = await this.db.prepare('SELECT * FROM recipes WHERE user_id = ? AND name = ? COLLATE NOCASE').bind(this.userId, name).first<Row>();
    return r ? toRecipe(r) : null;
  }

  async recipe(id: string): Promise<Recipe | null> {
    const r = await this.db.prepare('SELECT * FROM recipes WHERE user_id = ? AND id = ?').bind(this.userId, id).first<Row>();
    return r ? toRecipe(r) : null;
  }

  async recipes(): Promise<Recipe[]> {
    const { results } = await this.db.prepare('SELECT * FROM recipes WHERE user_id = ? ORDER BY name COLLATE NOCASE').bind(this.userId).all<Row>();
    return results.map(toRecipe);
  }

  async deleteRecipe(id: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM recipes WHERE user_id = ? AND id = ?').bind(this.userId, id).run()).meta.changes > 0;
  }

  // ---------- plans ----------
  /** One plan per week: saving a week again replaces it. */
  async savePlan(weekStart: string, items: PlannedItem[]): Promise<Plan> {
    const now = this.now();
    await this.db
      .prepare(
        `INSERT INTO meal_plans (id, user_id, week_start, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, week_start) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`,
      )
      .bind(crypto.randomUUID(), this.userId, weekStart, JSON.stringify(items), now, now)
      .run();
    return (await this.plan(weekStart))!;
  }

  async plan(weekStart: string): Promise<Plan | null> {
    const r = await this.db.prepare('SELECT * FROM meal_plans WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).first<Row>();
    return r ? toPlan(r) : null;
  }

  /** Weeks that have a plan, newest first. */
  async planWeeks(limit = 8): Promise<{ weekStart: string; items: number }[]> {
    const { results } = await this.db.prepare('SELECT week_start, items FROM meal_plans WHERE user_id = ? ORDER BY week_start DESC LIMIT ?').bind(this.userId, limit).all<Row>();
    return results.map((r) => ({ weekStart: r.week_start as string, items: parse<unknown[]>(r.items, []).length }));
  }

  async deletePlan(weekStart: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM meal_plans WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).run()).meta.changes > 0;
  }

  // ---------- shopping ticks ----------
  async ticks(weekStart: string): Promise<Set<string>> {
    const { results } = await this.db.prepare('SELECT item_key FROM grocery_ticks WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).all<Row>();
    return new Set(results.map((r) => r.item_key as string));
  }

  async setTick(weekStart: string, key: string, checked: boolean): Promise<void> {
    if (checked) {
      await this.db.prepare('INSERT OR IGNORE INTO grocery_ticks (user_id, week_start, item_key, checked_at) VALUES (?, ?, ?, ?)').bind(this.userId, weekStart, key, this.now()).run();
    } else {
      await this.db.prepare('DELETE FROM grocery_ticks WHERE user_id = ? AND week_start = ? AND item_key = ?').bind(this.userId, weekStart, key).run();
    }
  }

  async clearTicks(weekStart: string): Promise<void> {
    await this.db.prepare('DELETE FROM grocery_ticks WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).run();
  }

  async exportAll() {
    const { results } = await this.db.prepare('SELECT * FROM meal_plans WHERE user_id = ? ORDER BY week_start').bind(this.userId).all<Row>();
    return { recipes: await this.recipes(), mealPlans: results.map(toPlan) };
  }
}
