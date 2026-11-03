// Programs (A4): a block of weeks over saved workouts, one active at a time, with the workout started for each session. Every query is bound to the signed-in user's id.
import { positionAfter, type ProgramDay, type ProgramPosition, type ProgramShape } from '../workout/program';
import { cleanText } from './transfers';

export const MAX_DAYS = 7;

export interface Program extends ProgramShape {
  id: string;
  name: string;
  createdAt: number;
}

type Row = Record<string, unknown>;
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const toProgram = (r: Row): Program => ({ id: r.id as string, name: r.name as string, weeks: r.weeks as number, deloadWeeks: parse<number[]>(r.deload_weeks, []), days: parse<ProgramDay[]>(r.days, []), createdAt: r.created_at as number });

export class ProgramData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  async active(): Promise<Program | null> {
    const r = await this.db.prepare("SELECT * FROM programs WHERE user_id = ? AND status = 'active'").bind(this.userId).first<Row>();
    return r ? toProgram(r) : null;
  }

  /** Starts a program and ends the one that was running. */
  async create(name: string, weeks: number, days: ProgramDay[], deloadWeeks: number[]): Promise<Program> {
    const id = crypto.randomUUID();
    const at = this.now();
    const clean = { name: cleanText(name, 60) || 'Program', days: days.map((d) => ({ label: cleanText(d.label, 12) || '?', templateId: d.templateId })) };
    await this.db.batch([
      this.db.prepare("UPDATE programs SET status = 'ended', ended_at = ? WHERE user_id = ? AND status = 'active'").bind(at, this.userId),
      this.db.prepare('INSERT INTO programs (id, user_id, name, weeks, deload_weeks, days, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, this.userId, clean.name, weeks, JSON.stringify(deloadWeeks), JSON.stringify(clean.days), 'active', at),
    ]);
    return { id, name: clean.name, weeks, deloadWeeks, days: clean.days, createdAt: at };
  }

  async end(): Promise<boolean> {
    return (await this.db.prepare("UPDATE programs SET status = 'ended', ended_at = ? WHERE user_id = ? AND status = 'active'").bind(this.now(), this.userId).run()).meta.changes > 0;
  }

  /** Sessions of the program that were finished: the position is the one after them. */
  async completed(programId: string): Promise<number> {
    const r = await this.db
      .prepare('SELECT COUNT(*) AS n FROM program_sessions ps JOIN workouts w ON w.id = ps.workout_id WHERE ps.program_id = ? AND w.user_id = ? AND w.finished_at IS NOT NULL')
      .bind(programId, this.userId)
      .first<Row>();
    return (r?.n as number) ?? 0;
  }

  async position(p: Program): Promise<ProgramPosition> {
    return positionAfter(p, await this.completed(p.id));
  }

  /** Remembers the workout started for a step (starting the same step again replaces it). */
  async recordSession(programId: string, step: number, workoutId: string, deload: boolean): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO program_sessions (program_id, step, workout_id, deload) VALUES (?, ?, ?, ?)').bind(programId, step, workoutId, deload ? 1 : 0).run();
  }

  /** The workouts that were deload sessions: what the next weights are built from leaves them out. */
  async deloadWorkoutIds(): Promise<Set<string>> {
    const { results } = await this.db
      .prepare('SELECT ps.workout_id FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE p.user_id = ? AND ps.deload = 1')
      .bind(this.userId)
      .all<Row>();
    return new Set(results.map((r) => r.workout_id as string));
  }

  async exportAll() {
    const { results } = await this.db.prepare('SELECT * FROM programs WHERE user_id = ? ORDER BY created_at').bind(this.userId).all<Row>();
    const programs = [];
    for (const r of results) {
      const p = toProgram(r);
      const { results: sessions } = await this.db.prepare('SELECT step, workout_id, deload FROM program_sessions WHERE program_id = ? ORDER BY step').bind(p.id).all<Row>();
      programs.push({ ...p, status: r.status, sessions: sessions.map((s) => ({ step: s.step, workoutId: s.workout_id, deload: s.deload === 1 })) });
    }
    return { programs };
  }
}
