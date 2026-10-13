// A person's workouts and templates. Like UserData, every query is bound to the signed-in user's id.
import type { CardioDetails, WorkoutExercise, WorkoutSet } from '@fitwell/core/schema';

/** A set as the server stores it: the web shape plus the target the plan asked for. */
export type StoredSet = WorkoutSet & { targetReps?: number; skipped?: boolean };
/** The web shape plus plan details shown in the player (the web backup format ignores the extras). */
export type StoredExercise = Omit<WorkoutExercise, 'sets'> & { sets: StoredSet[]; restSec?: number; equipment?: string; lastTime?: string; note?: string };

export interface Workout {
  id: string;
  day: string;
  type: 'strength' | 'cardio';
  name: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  exercises: StoredExercise[];
  cardio: CardioDetails | null;
  templateId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateExercise {
  id: string;
  sets: number;
  reps: number;
  weightKg?: number;
  restSec: number;
}

export interface Template {
  id: string;
  name: string;
  exercises: TemplateExercise[];
  lastUsedAt: number | null;
}

type Row = Record<string, unknown>;
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const toWorkout = (r: Row): Workout => ({
  id: r.id as string,
  day: r.day as string,
  type: r.type as Workout['type'],
  name: (r.name as string | null) ?? null,
  startedAt: (r.started_at as number | null) ?? null,
  finishedAt: (r.finished_at as number | null) ?? null,
  exercises: parse<StoredExercise[]>(r.exercises, []),
  cardio: parse<CardioDetails | null>(r.cardio, null),
  templateId: (r.template_id as string | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});
const toTemplate = (r: Row): Template => ({ id: r.id as string, name: r.name as string, exercises: parse<TemplateExercise[]>(r.exercises, []), lastUsedAt: (r.last_used_at as number | null) ?? null });

export class WorkoutData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------- workouts ----------
  async create(w: Omit<Workout, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workout> {
    const now = this.now();
    const row: Workout = { ...w, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await this.db
      .prepare('INSERT INTO workouts (id, user_id, day, type, name, started_at, finished_at, exercises, cardio, template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(row.id, this.userId, row.day, row.type, row.name, row.startedAt, row.finishedAt, row.type === 'strength' ? JSON.stringify(row.exercises) : null, row.cardio ? JSON.stringify(row.cardio) : null, row.templateId, now, now)
      .run();
    return row;
  }

  async get(id: string): Promise<Workout | null> {
    const r = await this.db.prepare('SELECT * FROM workouts WHERE user_id = ? AND id = ?').bind(this.userId, id).first<Row>();
    return r ? toWorkout(r) : null;
  }

  /** Saves the exercises (and optionally the finish time) of a strength workout. */
  async saveExercises(id: string, exercises: StoredExercise[], finishedAt?: number): Promise<void> {
    await this.db
      .prepare('UPDATE workouts SET exercises = ?, finished_at = COALESCE(?, finished_at), updated_at = ? WHERE user_id = ? AND id = ?')
      .bind(JSON.stringify(exercises), finishedAt ?? null, this.now(), this.userId, id)
      .run();
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM workouts WHERE user_id = ? AND id = ?').bind(this.userId, id).run()).meta.changes > 0;
  }

  /** Workouts in an inclusive day range, newest first. */
  async between(from: string, to: string, type?: Workout['type']): Promise<Workout[]> {
    const sql = `SELECT * FROM workouts WHERE user_id = ? AND day BETWEEN ? AND ?${type ? ' AND type = ?' : ''} ORDER BY day DESC, created_at DESC`;
    const stmt = this.db.prepare(sql);
    const { results } = await (type ? stmt.bind(this.userId, from, to, type) : stmt.bind(this.userId, from, to)).all<Row>();
    return results.map(toWorkout);
  }

  /**
   * Recent sessions of each exercise, newest first, from the last `scan` strength workouts (excluding one, e.g. the
   * workout being planned). Reads at most `scan` rows, so it stays cheap on D1's daily budget.
   */
  async recentSessions(exerciseIds: string[], perExercise = 3, exclude?: string, scan = 60): Promise<Map<string, { day: string; workoutId: string; exercise: StoredExercise }[]>> {
    const { results } = await this.db
      .prepare("SELECT * FROM workouts WHERE user_id = ? AND type = 'strength' ORDER BY day DESC, created_at DESC LIMIT ?")
      .bind(this.userId, scan)
      .all<Row>();
    const out = new Map(exerciseIds.map((id) => [id, [] as { day: string; workoutId: string; exercise: StoredExercise }[]]));
    for (const w of results.map(toWorkout)) {
      if (w.id === exclude) continue;
      for (const e of w.exercises) {
        const list = out.get(e.exerciseRef);
        if (!list || list.length >= perExercise) continue;
        if (!e.sets.some((s) => s.done !== false && s.type === 'working')) continue;
        list.push({ day: w.day, workoutId: w.id, exercise: e });
      }
    }
    return out;
  }

  // ---------- templates ----------
  async saveTemplate(name: string, exercises: TemplateExercise[]): Promise<Template> {
    const now = this.now();
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO workout_templates (id, user_id, name, exercises, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, name) DO UPDATE SET exercises = excluded.exercises, updated_at = excluded.updated_at`,
      )
      .bind(id, this.userId, name, JSON.stringify(exercises), now, now)
      .run();
    return (await this.templateByName(name))!;
  }

  async templateByName(name: string): Promise<Template | null> {
    const r = await this.db.prepare('SELECT * FROM workout_templates WHERE user_id = ? AND name = ?').bind(this.userId, name).first<Row>();
    return r ? toTemplate(r) : null;
  }

  async template(id: string): Promise<Template | null> {
    const r = await this.db.prepare('SELECT * FROM workout_templates WHERE user_id = ? AND id = ?').bind(this.userId, id).first<Row>();
    return r ? toTemplate(r) : null;
  }

  async templates(): Promise<Template[]> {
    const { results } = await this.db.prepare('SELECT * FROM workout_templates WHERE user_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC').bind(this.userId).all<Row>();
    return results.map(toTemplate);
  }

  async touchTemplate(id: string): Promise<void> {
    await this.db.prepare('UPDATE workout_templates SET last_used_at = ? WHERE user_id = ? AND id = ?').bind(this.now(), this.userId, id).run();
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM workout_templates WHERE user_id = ? AND id = ?').bind(this.userId, id).run()).meta.changes > 0;
  }

  async exportAll() {
    const { results } = await this.db.prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY day, created_at').bind(this.userId).all<Row>();
    return { workouts: results.map(toWorkout), workoutTemplates: await this.templates() };
  }
}
