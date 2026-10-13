// Writes converted backup records for one person. Everything is INSERT OR IGNORE on ids derived from the backup's
// ids, so importing the same file twice (or a retry after a dropped connection) adds nothing twice, and nothing the
// person already has is overwritten.
import * as convert from './convert';
import type { ImportedGoals, ImportedSettings, Kind } from './convert';

export interface KindReport {
  received: number;
  imported: number;
  /** Valid records that were already there (same id, same day, same name). */
  alreadyThere: number;
  skipped: Record<string, number>;
}
export type Report = Partial<Record<Kind, KindReport>>;

/** D1 allows 100 bound values per statement; a batch is one call to the database. */
const PARAMS_PER_STATEMENT = 90;
const STATEMENTS_PER_BATCH = 50;

async function insertAll(db: D1Database, table: string, columns: string[], values: unknown[][], verb = 'INSERT OR IGNORE', suffix = ''): Promise<number> {
  if (values.length === 0) return 0;
  const perStatement = Math.max(1, Math.floor(PARAMS_PER_STATEMENT / columns.length));
  const tuple = `(${columns.map(() => '?').join(',')})`;
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < values.length; i += perStatement) {
    const part = values.slice(i, i + perStatement);
    // Table and column names are constants in this file, never input.
    statements.push(db.prepare(`${verb} INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES ${part.map(() => tuple).join(',')}${suffix}`).bind(...part.flat()));
  }
  let changes = 0;
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    for (const r of await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH))) changes += r.meta.changes ?? 0;
  }
  return changes;
}

const done = (c: { received: number; skipped: Record<string, number> }, imported: number, valid: number): KindReport => ({ received: c.received, imported, alreadyThere: Math.max(0, valid - imported), skipped: c.skipped });

async function ensureProfile(db: D1Database, userId: string) {
  await db.prepare('INSERT OR IGNORE INTO profiles (user_id, updated_at) VALUES (?, ?)').bind(userId, Date.now()).run();
}

/** Converts and writes one chunk of records of one kind. */
export async function importChunk(db: D1Database, userId: string, kind: Kind, records: unknown[]): Promise<KindReport> {
  switch (kind) {
    case 'customFoods': {
      const c = convert.customFoods(userId, records);
      const n = await insertAll(db, 'custom_foods', ['id', 'user_id', 'name', 'brand', 'kcal', 'protein', 'carbs', 'fat', 'portions', 'created_at', 'updated_at'], c.rows.map((r) => [r.id, userId, r.name, r.brand, r.kcal, r.protein, r.carbs, r.fat, r.portions, r.created_at, r.updated_at]));
      return done(c, n, c.rows.length);
    }
    case 'weightEntries': {
      const c = convert.weightEntries(userId, records);
      const n = await insertAll(db, 'weights', ['user_id', 'day', 'kg', 'created_at', 'updated_at'], c.rows.map((r) => [userId, r.day, r.kg, r.created_at, r.updated_at]));
      return done(c, n, c.rows.length);
    }
    case 'measurementEntries': {
      const c = convert.measurementEntries(userId, records);
      // A day that already has measurements keeps its own values; the file only fills in the missing types.
      const n = await insertAll(
        db,
        'measurements',
        ['user_id', 'day', 'values', 'updated_at'],
        c.rows.map((r) => [userId, r.day, r.values, r.updated_at]),
        'INSERT',
        ' ON CONFLICT (user_id, day) DO UPDATE SET "values" = json_patch(excluded."values", measurements."values") WHERE json_patch(excluded."values", measurements."values") <> measurements."values"',
      );
      return done(c, n, c.rows.length);
    }
    case 'workouts': {
      const c = convert.workouts(userId, records);
      const n = await insertAll(db, 'workouts', ['id', 'user_id', 'day', 'type', 'name', 'started_at', 'finished_at', 'exercises', 'cardio', 'created_at', 'updated_at'], c.rows.map((r) => [r.id, userId, r.day, r.type, r.name, r.started_at, r.finished_at, r.exercises, r.cardio, r.created_at, r.updated_at]));
      return done(c, n, c.rows.length);
    }
    case 'workoutTemplates': {
      const c = convert.workoutTemplates(userId, records);
      const n = await insertAll(db, 'workout_templates', ['id', 'user_id', 'name', 'exercises', 'created_at', 'updated_at'], c.rows.map((r) => [r.id, userId, r.name, r.exercises, r.created_at, r.updated_at]));
      return done(c, n, c.rows.length);
    }
    case 'foodEntries': {
      const c = convert.foodEntries(userId, records);
      const n = await insertAll(db, 'food_entries', ['id', 'user_id', 'day', 'slot', 'food_ref', 'food_name', 'brand', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'estimated', 'created_at', 'updated_at'], c.rows.map((r) => [r.id, userId, r.day, r.slot, r.food_ref, r.food_name, r.brand, r.grams, r.kcal, r.protein, r.carbs, r.fat, 0, r.created_at, r.updated_at]));
      return done(c, n, c.rows.length);
    }
    case 'goals': {
      const g: ImportedGoals | null = convert.goalsDoc(records[0]);
      if (!g) return { received: records.length, imported: 0, alreadyThere: 0, skipped: records.length ? { invalid: 1 } : {} };
      // Only fill goals that are not set yet.
      const r = await db
        .prepare(
          `INSERT INTO goals (user_id, kcal, protein_g, carbs_g, fat_g, workouts_per_week, goal_weight_kg, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET kcal = COALESCE(goals.kcal, excluded.kcal), protein_g = COALESCE(goals.protein_g, excluded.protein_g), carbs_g = COALESCE(goals.carbs_g, excluded.carbs_g),
             fat_g = COALESCE(goals.fat_g, excluded.fat_g), workouts_per_week = COALESCE(goals.workouts_per_week, excluded.workouts_per_week), goal_weight_kg = COALESCE(goals.goal_weight_kg, excluded.goal_weight_kg), updated_at = excluded.updated_at`,
        )
        .bind(userId, g.kcal ?? null, g.proteinG ?? null, g.carbsG ?? null, g.fatG ?? null, g.workoutsPerWeek ?? null, g.goalWeightKg ?? null, Date.now())
        .run();
      return { received: 1, imported: r.meta.changes > 0 ? 1 : 0, alreadyThere: 0, skipped: {} };
    }
    case 'settings': {
      const s: ImportedSettings | null = convert.settingsDoc(records[0]);
      if (!s) return { received: records.length, imported: 0, alreadyThere: 0, skipped: records.length ? { invalid: 1 } : {} };
      await ensureProfile(db, userId);
      // Imperial is an explicit choice worth keeping; metric is the default and changes nothing.
      await db.prepare("UPDATE profiles SET units = CASE WHEN ? = 'imperial' THEN 'imperial' ELSE units END, updated_at = ? WHERE user_id = ?").bind(s.units ?? null, Date.now(), userId).run();
      return { received: 1, imported: 1, alreadyThere: 0, skipped: {} };
    }
  }
}

/** Adds a chunk's numbers to the running report. */
export function addToReport(report: Report, kind: Kind, k: KindReport): Report {
  const cur = report[kind] ?? { received: 0, imported: 0, alreadyThere: 0, skipped: {} };
  const skipped = { ...cur.skipped };
  for (const [reason, n] of Object.entries(k.skipped)) skipped[reason] = (skipped[reason] ?? 0) + n;
  return { ...report, [kind]: { received: cur.received + k.received, imported: cur.imported + k.imported, alreadyThere: cur.alreadyThere + k.alreadyThere, skipped } };
}

/** After the last chunk: if the person has no current weight yet, take the newest imported weigh-in. */
export async function finishImport(db: D1Database, userId: string): Promise<void> {
  await ensureProfile(db, userId);
  await db
    .prepare('UPDATE profiles SET weight_kg = (SELECT kg FROM weights WHERE user_id = ? ORDER BY day DESC LIMIT 1), updated_at = ? WHERE user_id = ? AND weight_kg IS NULL')
    .bind(userId, Date.now(), userId)
    .run();
}

const LABELS: Record<Kind, string> = {
  settings: 'settings',
  goals: 'goals',
  customFoods: 'own foods',
  weightEntries: 'weigh-ins',
  measurementEntries: 'measurement sets',
  workouts: 'workouts',
  workoutTemplates: 'workout templates',
  foodEntries: 'food entries',
};
const REASONS: Record<string, string> = {
  deleted: 'deleted in the app',
  not_resolved: 'still waiting for a lookup',
  no_weight: 'no weight could be worked out',
  own_measurement_type: 'your own measurement types',
  own_exercise_or_timed: 'with your own or timed exercises',
  cardio_template: 'cardio templates',
  invalid: 'not readable',
};

/** Plain-language lines for the page and for Claude. */
export function describeReport(report: Report): string[] {
  const lines: string[] = [];
  for (const kind of ['foodEntries', 'workouts', 'weightEntries', 'measurementEntries', 'customFoods', 'workoutTemplates', 'goals', 'settings'] as Kind[]) {
    const k = report[kind];
    if (!k || k.received === 0) continue;
    const skipped = Object.entries(k.skipped).map(([r, n]) => `${n} ${REASONS[r] ?? r}`);
    const parts = [`${k.imported} added`, ...(k.alreadyThere ? [`${k.alreadyThere} already there`] : []), ...skipped];
    lines.push(`${LABELS[kind]}: ${parts.join(', ')}`);
  }
  return lines;
}
