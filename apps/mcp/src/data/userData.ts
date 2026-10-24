// The only way tools touch a person's data: every query is bound to the signed-in user's id,
// which comes from the verified OAuth token, never from a tool argument.
import type { ActivityLevel, Sex } from '@fitwell/core/domain/energy';
import { STANDARD_GYM, type Gym } from '@fitwell/core/domain/plates';
import { EXTRA_KEYS, scaleExtras, type Extras, type Nutrients, type Portion } from '@fitwell/core/domain/nutrition';
import type { Slot } from '@fitwell/core/schema';

export interface Diet {
  preferences: string[];
  allergies: string[];
  dislikes: string[];
}

export interface Profile {
  timeZone: string;
  units: 'metric' | 'imperial';
  sex: Sex | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel | null;
  equipment: string[];
  diet: Diet;
  /** Bar and plates for the plate calculator and warm-up ramps. */
  gym: Gym;
}

export interface Goals {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  workoutsPerWeek: number | null;
  goalWeightKg: number | null;
  /** A daily minimum. */
  fiberG: number | null;
  /** Daily maximums. */
  satFatG: number | null;
  addedSugarG: number | null;
  /** Hours of sleep to aim for a night. */
  sleepH: number | null;
}

export interface FoodEntry extends Nutrients {
  id: string;
  day: string;
  slot: Slot;
  foodRef: string | null;
  foodName: string;
  brand: string | null;
  grams: number;
  /** Fibre, sugars, saturated fat, salt for this amount, when the food source has them. */
  extras?: Extras;
  estimated: boolean;
  createdAt: number;
  updatedAt: number;
}
export type NewFoodEntry = Omit<FoodEntry, 'id' | 'createdAt' | 'updatedAt'>;

export interface CustomFood {
  id: string;
  name: string;
  brand: string | null;
  per100g: Nutrients;
  extras?: Extras;
  portions: Portion[];
}

export interface DayTotal extends Nutrients {
  day: string;
  entries: number;
  /** Fibre, sugars... summed over the entries that know them. */
  extras?: Extras;
  /** Extras some entry of the day lacks, so the day's number is a minimum. */
  extrasIncomplete?: (keyof Extras)[];
}

const DEFAULT_PROFILE: Profile = {
  timeZone: 'Europe/Copenhagen',
  units: 'metric',
  sex: null,
  birthYear: null,
  heightCm: null,
  weightKg: null,
  activityLevel: null,
  equipment: [],
  diet: { preferences: [], allergies: [], dislikes: [] },
  gym: STANDARD_GYM,
};

const SLOT_ORDER = "CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END";

type Row = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const extrasOf = (v: unknown): { extras?: Extras } => {
  const e = json<Extras | null>(v, null);
  return e && Object.keys(e).length ? { extras: e } : {};
};
const toEntry = (r: Row): FoodEntry => ({
  id: r.id as string,
  day: r.day as string,
  slot: r.slot as Slot,
  foodRef: (r.food_ref as string | null) ?? null,
  foodName: r.food_name as string,
  brand: (r.brand as string | null) ?? null,
  grams: r.grams as number,
  kcal: r.kcal as number,
  protein: r.protein as number,
  carbs: r.carbs as number,
  fat: r.fat as number,
  ...extrasOf(r.extras),
  estimated: r.estimated === 1,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});
const toCustom = (r: Row): CustomFood => ({
  id: r.id as string,
  name: r.name as string,
  brand: (r.brand as string | null) ?? null,
  per100g: { kcal: r.kcal as number, protein: r.protein as number, carbs: r.carbs as number, fat: r.fat as number },
  ...extrasOf(r.extras),
  portions: json<Portion[]>(r.portions, []),
});

export class UserData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------- profile and goals ----------
  async profile(): Promise<Profile> {
    const r = await this.db.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(this.userId).first<Row>();
    if (!r) return { ...DEFAULT_PROFILE };
    return {
      timeZone: r.time_zone as string,
      units: r.units as Profile['units'],
      sex: (r.sex as Sex | null) ?? null,
      birthYear: (r.birth_year as number | null) ?? null,
      heightCm: (r.height_cm as number | null) ?? null,
      weightKg: (r.weight_kg as number | null) ?? null,
      activityLevel: (r.activity_level as ActivityLevel | null) ?? null,
      equipment: json<string[]>(r.equipment, []),
      diet: { ...DEFAULT_PROFILE.diet, ...json<Partial<Diet>>(r.diet, {}) },
      gym: { ...STANDARD_GYM, ...json<Partial<Gym>>(r.gym, {}) },
    };
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const current = await this.profile();
    const p = { ...current, ...patch, diet: { ...current.diet, ...patch.diet } };
    await this.db
      .prepare(
        `INSERT INTO profiles (user_id, time_zone, units, sex, birth_year, height_cm, weight_kg, activity_level, equipment, diet, gym, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone, units = excluded.units, sex = excluded.sex,
           birth_year = excluded.birth_year, height_cm = excluded.height_cm, weight_kg = excluded.weight_kg,
           activity_level = excluded.activity_level, equipment = excluded.equipment, diet = excluded.diet, gym = excluded.gym, updated_at = excluded.updated_at`,
      )
      .bind(this.userId, p.timeZone, p.units, p.sex, p.birthYear, p.heightCm, p.weightKg, p.activityLevel, JSON.stringify(p.equipment), JSON.stringify(p.diet), JSON.stringify(p.gym), this.now())
      .run();
    return p;
  }

  /**
   * True once for a new account: nothing saved yet (no goals, logs, workouts, templates, body data, own foods, recipes
   * or plans, and nothing about them in the profile) and the setup not offered before. Marks it offered in the same statement.
   */
  async offerSetup(): Promise<boolean> {
    const none = (table: string) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE user_id = ?1)`;
    const tables = ['goals', 'food_entries', 'workouts', 'workout_templates', 'weights', 'measurements', 'daily_metrics', 'custom_foods', 'recipes', 'meal_plans'];
    const res = await this.db
      .prepare(
        `UPDATE users SET setup_offered_at = ?2 WHERE id = ?1 AND setup_offered_at IS NULL AND ${tables.map(none).join(' AND ')}
           AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = ?1
             AND (sex IS NOT NULL OR birth_year IS NOT NULL OR height_cm IS NOT NULL OR weight_kg IS NOT NULL OR activity_level IS NOT NULL OR equipment != '[]'))`,
      )
      .bind(this.userId, this.now())
      .run();
    return res.meta.changes === 1;
  }

  async goals(): Promise<Goals | null> {
    const r = await this.db.prepare('SELECT * FROM goals WHERE user_id = ?').bind(this.userId).first<Row>();
    if (!r) return null;
    return {
      kcal: (r.kcal as number | null) ?? null,
      proteinG: (r.protein_g as number | null) ?? null,
      carbsG: (r.carbs_g as number | null) ?? null,
      fatG: (r.fat_g as number | null) ?? null,
      workoutsPerWeek: (r.workouts_per_week as number | null) ?? null,
      goalWeightKg: (r.goal_weight_kg as number | null) ?? null,
      fiberG: (r.fiber_g as number | null) ?? null,
      satFatG: (r.sat_fat_g as number | null) ?? null,
      addedSugarG: (r.added_sugar_g as number | null) ?? null,
      sleepH: (r.sleep_h as number | null) ?? null,
    };
  }

  async setGoals(patch: Partial<Goals>): Promise<Goals> {
    const empty: Goals = { kcal: null, proteinG: null, carbsG: null, fatG: null, workoutsPerWeek: null, goalWeightKg: null, fiberG: null, satFatG: null, addedSugarG: null, sleepH: null };
    const g = { ...empty, ...(await this.goals()), ...patch };
    await this.db
      .prepare(
        `INSERT INTO goals (user_id, kcal, protein_g, carbs_g, fat_g, workouts_per_week, goal_weight_kg, fiber_g, sat_fat_g, added_sugar_g, sleep_h, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
           fat_g = excluded.fat_g, workouts_per_week = excluded.workouts_per_week, goal_weight_kg = excluded.goal_weight_kg,
           fiber_g = excluded.fiber_g, sat_fat_g = excluded.sat_fat_g, added_sugar_g = excluded.added_sugar_g, sleep_h = excluded.sleep_h, updated_at = excluded.updated_at`,
      )
      .bind(this.userId, g.kcal, g.proteinG, g.carbsG, g.fatG, g.workoutsPerWeek, g.goalWeightKg, g.fiberG, g.satFatG, g.addedSugarG, g.sleepH, this.now())
      .run();
    return g;
  }

  // ---------- food log ----------
  async addFoodEntries(entries: NewFoodEntry[]): Promise<FoodEntry[]> {
    const now = this.now();
    const rows = entries.map((e): FoodEntry => ({ ...e, id: crypto.randomUUID(), createdAt: now, updatedAt: now }));
    await this.db.batch(
      rows.map((e) =>
        this.db
          .prepare(
            `INSERT INTO food_entries (id, user_id, day, slot, food_ref, food_name, brand, grams, kcal, protein, carbs, fat, estimated, extras, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(e.id, this.userId, e.day, e.slot, e.foodRef, e.foodName, e.brand, e.grams, e.kcal, e.protein, e.carbs, e.fat, e.estimated ? 1 : 0, e.extras ? JSON.stringify(e.extras) : null, now, now),
      ),
    );
    return rows;
  }

  async foodEntries(day: string): Promise<FoodEntry[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM food_entries WHERE user_id = ? AND day = ? ORDER BY ${SLOT_ORDER}, created_at`)
      .bind(this.userId, day)
      .all<Row>();
    return results.map(toEntry);
  }

  async foodEntry(id: string): Promise<FoodEntry | null> {
    const r = await this.db.prepare('SELECT * FROM food_entries WHERE user_id = ? AND id = ?').bind(this.userId, id).first<Row>();
    return r ? toEntry(r) : null;
  }

  /** Changing grams rescales the entry's nutrition (its snapshot is per gram). */
  async updateFoodEntry(id: string, patch: { grams?: number; slot?: Slot; day?: string }): Promise<FoodEntry | null> {
    const e = await this.foodEntry(id);
    if (!e) return null;
    const k = patch.grams !== undefined ? patch.grams / e.grams : 1;
    const extras = e.extras ? scaleExtras(e.extras, k * 100) : undefined;
    const next: FoodEntry = {
      ...e,
      day: patch.day ?? e.day,
      slot: patch.slot ?? e.slot,
      grams: patch.grams ?? e.grams,
      kcal: e.kcal * k,
      protein: e.protein * k,
      carbs: e.carbs * k,
      fat: e.fat * k,
      ...(extras ? { extras } : {}),
      updatedAt: this.now(),
    };
    await this.db
      .prepare('UPDATE food_entries SET day = ?, slot = ?, grams = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, extras = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .bind(next.day, next.slot, next.grams, next.kcal, next.protein, next.carbs, next.fat, next.extras ? JSON.stringify(next.extras) : null, next.updatedAt, this.userId, id)
      .run();
    return next;
  }

  async deleteFoodEntry(id: string): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM food_entries WHERE user_id = ? AND id = ?').bind(this.userId, id).run();
    return r.meta.changes > 0;
  }

  /** Totals per day for an inclusive range (days with no entries are left out). */
  async dayTotals(from: string, to: string): Promise<DayTotal[]> {
    const more = EXTRA_KEYS.map((k) => `SUM(json_extract(extras, '$.${k}')) AS x_${k}, COUNT(json_extract(extras, '$.${k}')) AS n_${k}`).join(', ');
    const { results } = await this.db
      .prepare(
        `SELECT day, COUNT(*) AS entries, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(carbs) AS carbs, SUM(fat) AS fat, ${more}
         FROM food_entries WHERE user_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
      )
      .bind(this.userId, from, to)
      .all<Row>();
    return results.map((r) => {
      const extras: Extras = {};
      const incomplete: (keyof Extras)[] = [];
      for (const k of EXTRA_KEYS) {
        const n = r[`n_${k}`] as number;
        if (n > 0) extras[k] = r[`x_${k}`] as number;
        if (n > 0 && n < (r.entries as number)) incomplete.push(k);
      }
      return { day: r.day as string, entries: r.entries as number, kcal: r.kcal as number, protein: r.protein as number, carbs: r.carbs as number, fat: r.fat as number, ...(Object.keys(extras).length ? { extras } : {}), ...(incomplete.length ? { extrasIncomplete: incomplete } : {}) };
    });
  }

  /** The foods eaten most often in a period, with typical amounts: realistic starting points for planning meals. */
  async frequentFoods(from: string, to: string, limit = 15): Promise<{ foodId: string; name: string; times: number; typicalGrams: number; kcal: number; protein: number }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT food_ref, MIN(food_name) AS name, COUNT(*) AS times, AVG(grams) AS grams, AVG(kcal) AS kcal, AVG(protein) AS protein
         FROM food_entries WHERE user_id = ? AND day BETWEEN ? AND ? AND food_ref IS NOT NULL AND food_ref NOT LIKE 'recipe:%'
         GROUP BY food_ref ORDER BY times DESC, name LIMIT ?`,
      )
      .bind(this.userId, from, to, limit)
      .all<Row>();
    return results.map((r) => ({ foodId: r.food_ref as string, name: r.name as string, times: r.times as number, typicalGrams: Math.round(r.grams as number), kcal: Math.round(r.kcal as number), protein: Math.round((r.protein as number) * 10) / 10 }));
  }

  // ---------- custom foods ----------
  async addCustomFood(food: Omit<CustomFood, 'id'>): Promise<CustomFood> {
    const id = crypto.randomUUID();
    const now = this.now();
    await this.db
      .prepare('INSERT INTO custom_foods (id, user_id, name, brand, kcal, protein, carbs, fat, portions, extras, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, this.userId, food.name, food.brand, food.per100g.kcal, food.per100g.protein, food.per100g.carbs, food.per100g.fat, JSON.stringify(food.portions), food.extras ? JSON.stringify(food.extras) : null, now, now)
      .run();
    return { ...food, id };
  }

  async customFoods(): Promise<CustomFood[]> {
    const { results } = await this.db.prepare('SELECT * FROM custom_foods WHERE user_id = ? ORDER BY name').bind(this.userId).all<Row>();
    return results.map(toCustom);
  }

  async customFood(id: string): Promise<CustomFood | null> {
    const r = await this.db.prepare('SELECT * FROM custom_foods WHERE user_id = ? AND id = ?').bind(this.userId, id).first<Row>();
    return r ? toCustom(r) : null;
  }

  async deleteCustomFood(id: string): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM custom_foods WHERE user_id = ? AND id = ?').bind(this.userId, id).run();
    return r.meta.changes > 0;
  }

  // ---------- everything, for export ----------
  async exportAll() {
    const { results } = await this.db.prepare('SELECT * FROM food_entries WHERE user_id = ? ORDER BY day, created_at').bind(this.userId).all<Row>();
    return { profile: await this.profile(), goals: await this.goals(), foodEntries: results.map(toEntry), customFoods: await this.customFoods() };
  }
}
