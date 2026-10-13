// A person's weigh-ins and body measurements. Like UserData, every query is bound to the signed-in user's id.

export interface WeightPoint {
  day: string;
  kg: number;
}

export interface MeasurementSet {
  day: string;
  values: Record<string, number>;
}

/** Sleep, steps and water for one day; a field is absent when it was not logged. */
export interface DailyMetrics {
  day: string;
  sleepH?: number;
  steps?: number;
  waterMl?: number;
}

type Row = Record<string, unknown>;
const toMetrics = (r: Row): DailyMetrics => ({
  day: r.day as string,
  ...(r.sleep_h != null ? { sleepH: r.sleep_h as number } : {}),
  ...(r.steps != null ? { steps: r.steps as number } : {}),
  ...(r.water_ml != null ? { waterMl: r.water_ml as number } : {}),
});

export class BodyData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** One weigh-in per day; logging again the same day replaces it. */
  async setWeight(day: string, kg: number): Promise<void> {
    const now = this.now();
    await this.db
      .prepare('INSERT INTO weights (user_id, day, kg, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at')
      .bind(this.userId, day, kg, now, now)
      .run();
  }

  async weights(from: string, to: string): Promise<WeightPoint[]> {
    const { results } = await this.db.prepare('SELECT day, kg FROM weights WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day').bind(this.userId, from, to).all<WeightPoint>();
    return results;
  }

  async latestWeight(): Promise<WeightPoint | null> {
    return this.db.prepare('SELECT day, kg FROM weights WHERE user_id = ? ORDER BY day DESC LIMIT 1').bind(this.userId).first<WeightPoint>();
  }

  async deleteWeight(day: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM weights WHERE user_id = ? AND day = ?').bind(this.userId, day).run()).meta.changes > 0;
  }

  /** Adds the given values to the day's set (values for other types that day are kept). */
  async setMeasurements(day: string, values: Record<string, number>): Promise<MeasurementSet> {
    const current = await this.db.prepare('SELECT "values" FROM measurements WHERE user_id = ? AND day = ?').bind(this.userId, day).first<Row>();
    let merged = { ...values };
    try {
      if (typeof current?.values === 'string') merged = { ...(JSON.parse(current.values) as Record<string, number>), ...values };
    } catch {
      /* unreadable old value: replace it */
    }
    await this.db
      .prepare('INSERT INTO measurements (user_id, day, "values", updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET "values" = excluded."values", updated_at = excluded.updated_at')
      .bind(this.userId, day, JSON.stringify(merged), this.now())
      .run();
    return { day, values: merged };
  }

  async measurements(from: string, to: string): Promise<MeasurementSet[]> {
    const { results } = await this.db.prepare('SELECT day, "values" FROM measurements WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day').bind(this.userId, from, to).all<Row>();
    return results.map((r) => ({ day: r.day as string, values: JSON.parse(r.values as string) as Record<string, number> }));
  }

  async deleteMeasurements(day: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM measurements WHERE user_id = ? AND day = ?').bind(this.userId, day).run()).meta.changes > 0;
  }

  /**
   * Sets the given fields of a day and keeps the others. `addWaterMl` adds to what is already logged (a glass at a time),
   * `waterMl` replaces it.
   */
  async setMetrics(day: string, v: { sleepH?: number; steps?: number; waterMl?: number; addWaterMl?: number }): Promise<DailyMetrics> {
    const now = this.now();
    await this.db
      .prepare(
        `INSERT INTO daily_metrics (user_id, day, sleep_h, steps, water_ml, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET
           sleep_h = COALESCE(excluded.sleep_h, sleep_h),
           steps = COALESCE(excluded.steps, steps),
           water_ml = CASE WHEN ? THEN COALESCE(water_ml, 0) + COALESCE(excluded.water_ml, 0) ELSE COALESCE(excluded.water_ml, water_ml) END,
           updated_at = excluded.updated_at`,
      )
      .bind(this.userId, day, v.sleepH ?? null, v.steps ?? null, v.addWaterMl ?? v.waterMl ?? null, now, v.addWaterMl !== undefined ? 1 : 0)
      .run();
    return (await this.metricsOn(day))!;
  }

  async metricsOn(day: string): Promise<DailyMetrics | null> {
    const r = await this.db.prepare('SELECT * FROM daily_metrics WHERE user_id = ? AND day = ?').bind(this.userId, day).first<Row>();
    return r ? toMetrics(r) : null;
  }

  async metrics(from: string, to: string): Promise<DailyMetrics[]> {
    const { results } = await this.db.prepare('SELECT * FROM daily_metrics WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day').bind(this.userId, from, to).all<Row>();
    return results.map(toMetrics);
  }

  async deleteMetrics(day: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM daily_metrics WHERE user_id = ? AND day = ?').bind(this.userId, day).run()).meta.changes > 0;
  }

  async exportAll() {
    return { weights: await this.weights('0000-00-00', '9999-99-99'), measurements: await this.measurements('0000-00-00', '9999-99-99'), dailyMetrics: await this.metrics('0000-00-00', '9999-99-99') };
  }
}
