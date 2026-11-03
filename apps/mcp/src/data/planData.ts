// A person's recipes and weekly meal plans. Like UserData, every query is bound to the signed-in user's id.
import { sumExtras, type Extras } from '@fitwell/core/domain/nutrition';
import type { PlannedItem } from '../planning/check';
import type { Ingredient } from '../planning/grocery';
import { scaleItem } from '../planning/scalePlan';
import { sharedItem } from './households';

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
/** Which planned item is which across a rebuild: the day, meal and food, not the amount (a portion change keeps what was eaten). Items that repeat are told apart by their order. */
const looseKey = (p: PlannedItem) => `${p.day}|${p.slot}|${p.kind}|${p.foodId ?? p.name}`;
const withoutMarks = (items: PlannedItem[]) => JSON.stringify(items.map(({ loggedAt: _l, ...rest }) => (void _l, rest)));

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
    // A plan that follows the household's stays linked while only what was eaten changes; any other change makes it this person's own.
    const before = await this.db.prepare('SELECT items, household_id FROM meal_plans WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).first<Row>();
    const unlink = !!before?.household_id && withoutMarks(parse<PlannedItem[]>(before.items, [])) !== withoutMarks(items);
    await this.db
      .prepare(
        // updated_at is the plan's version for the meal plan view's edits: every save moves it on, even two in the same millisecond.
        `INSERT INTO meal_plans (id, user_id, week_start, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, week_start) DO UPDATE SET items = excluded.items, updated_at = MAX(excluded.updated_at, meal_plans.updated_at + 1)`,
      )
      .bind(crypto.randomUUID(), this.userId, weekStart, JSON.stringify(items), now, now)
      .run();
    if (unlink) await this.db.prepare('UPDATE meal_plans SET household_id = NULL, household_synced_at = NULL, household_portion = NULL WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).run();
    return (await this.plan(weekStart))!;
  }

  /** The week's plan. A copy that follows the household's plan (B2) is rebuilt first when the household plan or this person's portion has changed. */
  async plan(weekStart: string): Promise<Plan | null> {
    const r = await this.db.prepare('SELECT * FROM meal_plans WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).first<Row>();
    if (!r) return null;
    return r.household_id ? ((await this.refreshLinked(r)) ?? toPlan(r)) : toPlan(r);
  }

  /** The household's plan of the week, scaled to this person's portion, with what they already ate carried over where the same meal is still planned. */
  private async fromHousehold(householdId: string, weekStart: string, own: PlannedItem[]): Promise<{ items: PlannedItem[]; syncedAt: number; portion: number } | null> {
    const me = await this.db.prepare('SELECT household_id, portion FROM household_members WHERE user_id = ?').bind(this.userId).first<Row>();
    if (!me || me.household_id !== householdId) return null;
    const hp = await this.db.prepare('SELECT items, updated_at FROM household_plans WHERE household_id = ? AND week_start = ?').bind(householdId, weekStart).first<Row>();
    if (!hp) return null;
    const portion = me.portion as number;
    const eaten = new Map<string, number[]>();
    for (const o of own) if (o.loggedAt) eaten.set(looseKey(o), [...(eaten.get(looseKey(o)) ?? []), o.loggedAt]);
    const items = parse<PlannedItem[]>(hp.items, []).map(sharedItem).map((i) => scaleItem(i, portion));
    for (const i of items) {
      const marks = eaten.get(looseKey(i));
      if (marks?.length) i.loggedAt = marks.shift();
    }
    return { items, syncedAt: hp.updated_at as number, portion };
  }

  private async refreshLinked(r: Row): Promise<Plan | null> {
    const plan = toPlan(r);
    const householdId = r.household_id as string;
    const me = await this.db.prepare('SELECT household_id, portion FROM household_members WHERE user_id = ?').bind(this.userId).first<Row>();
    if (!me || me.household_id !== householdId) {
      await this.db.prepare('UPDATE meal_plans SET household_id = NULL, household_synced_at = NULL, household_portion = NULL WHERE id = ?').bind(plan.id).run();
      return plan;
    }
    const hp = await this.db.prepare('SELECT updated_at FROM household_plans WHERE household_id = ? AND week_start = ?').bind(householdId, plan.weekStart).first<Row>();
    if (!hp || ((hp.updated_at as number) <= ((r.household_synced_at as number | null) ?? 0) && me.portion === r.household_portion)) return plan;
    const next = await this.fromHousehold(householdId, plan.weekStart, plan.items);
    if (!next) return plan;
    await this.db
      .prepare('UPDATE meal_plans SET items = ?, updated_at = MAX(?, updated_at + 1), household_synced_at = ?, household_portion = ? WHERE id = ?')
      .bind(JSON.stringify(next.items), this.now(), next.syncedAt, next.portion, plan.id)
      .run();
    return (await this.db.prepare('SELECT * FROM meal_plans WHERE id = ?').bind(plan.id).first<Row>().then((x) => (x ? toPlan(x) : null))) ?? plan;
  }

  /** Makes this person's plan of the week a copy of the household's, scaled to their portion, and keeps it following the household's plan from now on (replacing any plan of their own for that week). */
  async useHouseholdPlan(weekStart: string): Promise<'not_a_member' | 'no_household_plan' | Plan> {
    const me = await this.db.prepare('SELECT household_id FROM household_members WHERE user_id = ?').bind(this.userId).first<Row>();
    if (!me) return 'not_a_member';
    const householdId = me.household_id as string;
    const existing = await this.db.prepare('SELECT * FROM meal_plans WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).first<Row>();
    const next = await this.fromHousehold(householdId, weekStart, existing ? toPlan(existing).items : []);
    if (!next) return 'no_household_plan';
    const now = this.now();
    await this.db
      .prepare(
        `INSERT INTO meal_plans (id, user_id, week_start, items, created_at, updated_at, household_id, household_synced_at, household_portion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, week_start) DO UPDATE SET items = excluded.items, updated_at = MAX(excluded.updated_at, meal_plans.updated_at + 1),
           household_id = excluded.household_id, household_synced_at = excluded.household_synced_at, household_portion = excluded.household_portion`,
      )
      .bind(crypto.randomUUID(), this.userId, weekStart, JSON.stringify(next.items), now, now, householdId, next.syncedAt, next.portion)
      .run();
    return (await this.plan(weekStart))!;
  }

  /** Whether this person's plan of the week follows the household's. */
  async followsHousehold(weekStart: string): Promise<boolean> {
    const r = await this.db.prepare('SELECT household_id FROM meal_plans WHERE user_id = ? AND week_start = ?').bind(this.userId, weekStart).first<Row>();
    return !!r?.household_id;
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
