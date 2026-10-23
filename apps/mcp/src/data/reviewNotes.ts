// The written notes of a week or month review. Like the other data classes, every query is bound to the signed-in user's id.
import type { ReviewPeriod, SavedNotes } from '../analytics/reviewTypes';

type Row = Record<string, unknown>;
const pair = (note: unknown, next: unknown) => (typeof note === 'string' && note ? { note, next: typeof next === 'string' && next ? next : null } : null);

export class ReviewNotesData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** The notes saved for one period: a pair is null where Claude wrote none. */
  async get(period: ReviewPeriod, startDay: string): Promise<SavedNotes> {
    const r = await this.db.prepare('SELECT * FROM review_notes WHERE user_id = ? AND period = ? AND start_day = ?').bind(this.userId, period, startDay).first<Row>();
    return { training: pair(r?.training_note, r?.training_next), nutrition: pair(r?.nutrition_note, r?.nutrition_next) };
  }

  /** Writes the given pairs for a period; a pair that is not given keeps what was saved. A new write replaces the old one. */
  async save(period: ReviewPeriod, startDay: string, notes: Partial<SavedNotes>): Promise<void> {
    const t = notes.training ?? null;
    const n = notes.nutrition ?? null;
    if (!t && !n) return;
    await this.db
      .prepare(
        `INSERT INTO review_notes (user_id, period, start_day, training_note, training_next, nutrition_note, nutrition_next, written_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, period, start_day) DO UPDATE SET
           training_note = CASE WHEN excluded.training_note IS NOT NULL THEN excluded.training_note ELSE training_note END,
           training_next = CASE WHEN excluded.training_note IS NOT NULL THEN excluded.training_next ELSE training_next END,
           nutrition_note = CASE WHEN excluded.nutrition_note IS NOT NULL THEN excluded.nutrition_note ELSE nutrition_note END,
           nutrition_next = CASE WHEN excluded.nutrition_note IS NOT NULL THEN excluded.nutrition_next ELSE nutrition_next END,
           written_at = excluded.written_at`,
      )
      .bind(this.userId, period, startDay, t?.note ?? null, t?.next ?? null, n?.note ?? null, n?.next ?? null, this.now())
      .run();
  }

  async exportAll() {
    const { results } = await this.db.prepare('SELECT period, start_day, training_note, training_next, nutrition_note, nutrition_next, written_at FROM review_notes WHERE user_id = ? ORDER BY start_day, period').bind(this.userId).all<Row>();
    return {
      reviewNotes: results.map((r) => ({ period: r.period as string, startDay: r.start_day as string, training: pair(r.training_note, r.training_next), nutrition: pair(r.nutrition_note, r.nutrition_next), writtenAt: r.written_at as number })),
    };
  }
}
