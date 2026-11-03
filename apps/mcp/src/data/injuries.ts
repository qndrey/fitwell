// Injuries and limitations (A11): what the person said and agreed to save (a body area, their own words, what to avoid, since when, until when). Health data: read only by their own tools.
import { INJURY_AREAS, type InjuryArea } from '../training/injuries';

export interface Injury {
  id: string;
  area: InjuryArea;
  /** The person's own words about what hurts. */
  note: string;
  /** What they were told or said to avoid, in their words ("overhead pressing, deep squats"). */
  avoid: string;
  since: string | null;
  /** The last day it applies (an end date they gave, or the day they said it was over); empty while it goes on. */
  until: string | null;
  createdAt: number;
}

type Row = Record<string, unknown>;
const toInjury = (r: Row): Injury => ({ id: r.id as string, area: r.area as InjuryArea, note: r.note as string, avoid: r.avoid as string, since: (r.since as string | null) ?? null, until: (r.until as string | null) ?? null, createdAt: r.created_at as number });

/** Words from a person or a model, kept as plain text on one line: no markup, links or control characters. */
export const plainText = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, ' ').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();

export class InjuryData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Injuries that apply on `day`: not ended before it. With no day, every injury saved. */
  async list(day?: string): Promise<Injury[]> {
    const { results } = await this.db.prepare('SELECT * FROM injuries WHERE user_id = ? ORDER BY created_at, id').bind(this.userId).all<Row>();
    return results.map(toInjury).filter((i) => day === undefined || i.until === null || i.until >= day);
  }

  async add(i: { area: InjuryArea; note: string; avoid: string; since: string | null; until: string | null }): Promise<Injury> {
    if (!INJURY_AREAS.includes(i.area)) throw new Error('Unknown body area.');
    const id = crypto.randomUUID();
    const createdAt = this.now();
    await this.db
      .prepare('INSERT INTO injuries (id, user_id, area, note, avoid, since, until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, this.userId, i.area, plainText(i.note), plainText(i.avoid), i.since, i.until, createdAt)
      .run();
    return { id, ...i, note: plainText(i.note), avoid: plainText(i.avoid), createdAt };
  }

  /** Marks an injury as over from `day` (it applies up to the day before). False when it is not this person's. */
  async end(id: string, until: string): Promise<boolean> {
    const r = await this.db.prepare('UPDATE injuries SET until = ? WHERE id = ? AND user_id = ?').bind(until, id, this.userId).run();
    return (r.meta.changes ?? 0) > 0;
  }

  async remove(id: string): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM injuries WHERE id = ? AND user_id = ?').bind(id, this.userId).run();
    return (r.meta.changes ?? 0) > 0;
  }

  async exportAll() {
    return { injuries: await this.list() };
  }
}
