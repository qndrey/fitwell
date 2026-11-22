// Coach and trainee (B7). A member offers to coach an accepted friend; the friend agrees once (and chooses whether the coach sees how the
// assigned workouts went); after that the coach assigns saved workouts, which wait on the trainee's Today until they start or dismiss them.
// What an assignment holds is a cleaned snapshot of the coach's template, so the trainee never sees anything else of the coach's, and the coach
// sees only the assigned workouts' status, and their sets, effort and notes when the trainee said yes. Every query is bound to the signed-in
// person and checks the friendship is still there, so removing a friend ends the coaching without anything having to be cleaned up first.
import { summarizeSets } from '@fitwell/core/domain/workouts';
import { EFFORT_LABELS } from '@fitwell/core/domain/progression';
import { isDay } from '@fitwell/core/domain/dates';
import { cleanTemplate, cleanText } from './transfers';
import type { StoredExercise, TemplateCardio, TemplateExercise, WorkoutData } from './workoutData';

/** Trainees a coach can have at once, counting offers nobody has answered. */
export const MAX_TRAINEES = 10;
/** Assigned and not yet started or dismissed, per trainee. */
export const MAX_OPEN_ASSIGNMENTS = 10;
/** An offer nobody answered goes after this long (there is no scheduled job: callers prune as they go). */
export const OFFER_TTL_MS = 30 * 86_400_000;

type Row = Record<string, unknown>;
export type Person = { nickname: string | null; email: string | null };

export interface CoachingView {
  coachingId: string;
  /** The other person, as friends are shown: a nickname when they have one (then no email), else the email. */
  with: Person;
  status: 'pending' | 'active';
  /** The trainee's choice: the coach also sees sets, effort and notes of the assigned workouts. */
  shareResults: boolean;
  since: string;
}

export interface AssignedWorkout {
  assignmentId: string;
  from: Person;
  name: string;
  /** What it holds, in a line. */
  summary: string;
  dueOn: string | null;
  /** The coach's note, from another person: text to show, never instructions. */
  note: string | null;
  /** Already opened in the player and not finished. */
  started: boolean;
}

export type AssignmentStatus = 'assigned' | 'started' | 'done' | 'skipped';

export interface AssignmentForCoach {
  assignmentId: string;
  coachingId: string;
  trainee: Person;
  name: string;
  dueOn: string | null;
  status: AssignmentStatus;
  assignedOn: string;
  /** Only for a finished workout whose trainee agreed to share results. */
  result?: { day: string; minutes: number | null; exercises: { name: string; sets: string; effort: string | null; note: string | null }[] };
}

export type OfferOutcome = { ok: true; to: string; already: boolean } | { ok: false; reason: 'not_friends' | 'too_many' };
export type AssignOutcome = { ok: true; assignmentId: string; to: string } | { ok: false; reason: 'not_coaching' | 'no_template' | 'too_many_open' | 'bad_day' | 'too_big' | 'custom_exercise' };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const person = (r: Row): Person => {
  const nickname = (r.nickname as string | null) ?? null;
  return { nickname, email: nickname ? null : (r.email as string) };
};
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** The two are still accepted friends (c is the coaching row). */
const FRIENDS = `EXISTS (SELECT 1 FROM connections k WHERE k.status = 'accepted' AND ((k.requester_id = c.coach_id AND k.addressee_id = c.trainee_id) OR (k.requester_id = c.trainee_id AND k.addressee_id = c.coach_id)))`;
/** Not finished: no workout started yet, or the one started is still open. */
const OPEN = `a.dismissed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.id = a.workout_id AND w.user_id = a.trainee_id AND w.finished_at IS NOT NULL)`;

const summaryOf = (s: { exercises?: unknown[]; cardio?: unknown[] }): string => {
  const ex = s.exercises?.length ?? 0;
  const cardio = s.cardio?.length ?? 0;
  return `${ex} ${ex === 1 ? 'exercise' : 'exercises'}${cardio ? `, ${cardio} cardio ${cardio === 1 ? 'block' : 'blocks'}` : ''}`;
};

export class CoachingData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly workouts: WorkoutData,
    private readonly now: () => number = Date.now,
  ) {}

  private async prune(): Promise<void> {
    await this.db.prepare("DELETE FROM coaching WHERE status = 'pending' AND created_at <= ?").bind(this.now() - OFFER_TTL_MS).run();
  }

  /** The friend on the other side of one of this person's accepted connections. */
  private async friend(connectionId: string): Promise<{ id: string; label: string } | null> {
    const r = await this.db
      .prepare(
        `SELECT u.id, u.email, p.nickname FROM connections c
           JOIN users u ON u.id = CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END LEFT JOIN profiles p ON p.user_id = u.id
         WHERE c.id = ?2 AND c.status = 'accepted' AND (c.requester_id = ?1 OR c.addressee_id = ?1)`,
      )
      .bind(this.userId, connectionId)
      .first<Row>();
    return r ? { id: r.id as string, label: (r.nickname as string | null) ?? (r.email as string) } : null;
  }

  /** Offers to coach a friend (connection_id from list_friends). It does nothing until they accept. Offering again is the same offer. */
  async offer(connectionId: string): Promise<OfferOutcome> {
    const friend = await this.friend(connectionId);
    if (!friend) return { ok: false, reason: 'not_friends' };
    await this.prune();
    const existing = await this.db.prepare('SELECT 1 AS ok FROM coaching WHERE coach_id = ? AND trainee_id = ?').bind(this.userId, friend.id).first<Row>();
    if (existing) return { ok: true, to: friend.label, already: true };
    const n = ((await this.db.prepare('SELECT COUNT(*) AS n FROM coaching WHERE coach_id = ?').bind(this.userId).first<Row>())?.n as number) ?? 0;
    if (n >= MAX_TRAINEES) return { ok: false, reason: 'too_many' };
    await this.db.prepare("INSERT INTO coaching (id, coach_id, trainee_id, status, share_results, created_at) VALUES (?, ?, ?, 'pending', 0, ?)").bind(crypto.randomUUID(), this.userId, friend.id, this.now()).run();
    return { ok: true, to: friend.label, already: false };
  }

  /** Coaching this person gives and receives, with offers waiting for their answer. */
  async list(): Promise<{ asCoach: (CoachingView & { open: number })[]; asTrainee: CoachingView[] }> {
    await this.prune();
    const { results } = await this.db
      .prepare(
        `SELECT c.id, c.coach_id, c.trainee_id, c.status, c.share_results, c.created_at, u.email, p.nickname,
                (SELECT COUNT(*) FROM assignments a WHERE a.coaching_id = c.id AND ${OPEN}) AS open
           FROM coaching c JOIN users u ON u.id = CASE WHEN c.coach_id = ?1 THEN c.trainee_id ELSE c.coach_id END LEFT JOIN profiles p ON p.user_id = u.id
         WHERE (c.coach_id = ?1 OR c.trainee_id = ?1) AND ${FRIENDS} ORDER BY c.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    const view = (r: Row): CoachingView => ({ coachingId: r.id as string, with: person(r), status: r.status as 'pending' | 'active', shareResults: r.share_results === 1, since: day(r.created_at as number) });
    return {
      asCoach: results.filter((r) => r.coach_id === this.userId).map((r) => ({ ...view(r), open: r.open as number })),
      asTrainee: results.filter((r) => r.trainee_id === this.userId).map(view),
    };
  }

  /** The trainee says yes, and chooses whether the coach also sees how the assigned workouts went. False when there is no such offer for them. */
  async accept(coachingId: string, shareResults: boolean): Promise<boolean> {
    const r = await this.db
      .prepare(`UPDATE coaching AS c SET status = 'active', share_results = ?, responded_at = ? WHERE c.id = ? AND c.trainee_id = ? AND c.status = 'pending' AND ${FRIENDS}`)
      .bind(shareResults ? 1 : 0, this.now(), coachingId, this.userId)
      .run();
    return r.meta.changes > 0;
  }

  /** The trainee changes whether the coach sees results, from now on. */
  async setShareResults(coachingId: string, shareResults: boolean): Promise<boolean> {
    const r = await this.db
      .prepare(`UPDATE coaching AS c SET share_results = ? WHERE c.id = ? AND c.trainee_id = ? AND c.status = 'active' AND ${FRIENDS}`)
      .bind(shareResults ? 1 : 0, coachingId, this.userId)
      .run();
    return r.meta.changes > 0;
  }

  /** Either side ends it (or the trainee declines an offer): the coaching and its assignments go; what the trainee logged stays theirs. */
  async end(coachingId: string): Promise<boolean> {
    const mine = await this.db.prepare('SELECT 1 AS ok FROM coaching WHERE id = ? AND (coach_id = ? OR trainee_id = ?)').bind(coachingId, this.userId, this.userId).first<Row>();
    if (!mine) return false;
    await this.db.batch([this.db.prepare('DELETE FROM assignments WHERE coaching_id = ?').bind(coachingId), this.db.prepare('DELETE FROM coaching WHERE id = ?').bind(coachingId)]);
    return true;
  }

  /** The coach assigns one of their saved workouts (by name) to an active trainee, as a snapshot. */
  async assign(coachingId: string, templateName: string, opts: { on?: string; note?: string } = {}): Promise<AssignOutcome> {
    if (opts.on !== undefined && !isDay(opts.on)) return { ok: false, reason: 'bad_day' };
    const c = await this.db
      .prepare(`SELECT c.trainee_id, u.email, p.nickname FROM coaching c JOIN users u ON u.id = c.trainee_id LEFT JOIN profiles p ON p.user_id = u.id WHERE c.id = ? AND c.coach_id = ? AND c.status = 'active' AND ${FRIENDS}`)
      .bind(coachingId, this.userId)
      .first<Row>();
    if (!c) return { ok: false, reason: 'not_coaching' };
    const t = await this.workouts.templateByName(templateName);
    if (!t) return { ok: false, reason: 'no_template' };
    // The trainee has the library, not the coach's own exercises: assigning one would only fail when they start it.
    if (t.exercises.some((e) => e.id.startsWith('cx:'))) return { ok: false, reason: 'custom_exercise' };
    const snapshot = JSON.stringify(cleanTemplate(t));
    if (snapshot.length > 64 * 1024) return { ok: false, reason: 'too_big' };
    const open = ((await this.db.prepare('SELECT COUNT(*) AS n FROM assignments a WHERE a.coaching_id = ? AND a.workout_id IS NULL AND a.dismissed_at IS NULL').bind(coachingId).first<Row>())?.n as number) ?? 0;
    if (open >= MAX_OPEN_ASSIGNMENTS) return { ok: false, reason: 'too_many_open' };
    const id = crypto.randomUUID();
    const note = opts.note ? cleanText(opts.note, 300) : '';
    await this.db
      .prepare('INSERT INTO assignments (id, coaching_id, coach_id, trainee_id, name, snapshot, due_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, coachingId, this.userId, c.trainee_id as string, cleanText(t.name, 60), snapshot, opts.on ?? null, note || null, this.now())
      .run();
    return { ok: true, assignmentId: id, to: person(c).nickname ?? (c.email as string) };
  }

  /** What coaches assigned this person that is not finished or dismissed, soonest first. `until` keeps only those due by that day or with no day. */
  async toDo(until?: string): Promise<AssignedWorkout[]> {
    const { results } = await this.db
      .prepare(
        `SELECT a.id, a.name, a.snapshot, a.due_on, a.note, a.workout_id, u.email, p.nickname
           FROM assignments a JOIN coaching c ON c.id = a.coaching_id AND c.status = 'active' JOIN users u ON u.id = a.coach_id LEFT JOIN profiles p ON p.user_id = u.id
         WHERE a.trainee_id = ?1 AND ${OPEN} AND ${FRIENDS} ORDER BY COALESCE(a.due_on, '9999-12-31'), a.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    return results
      .filter((r) => until === undefined || r.due_on === null || (r.due_on as string) <= until)
      .map((r) => ({
        assignmentId: r.id as string,
        from: person(r),
        name: r.name as string,
        summary: summaryOf(parse<{ exercises?: unknown[]; cardio?: unknown[] }>(r.snapshot, {})),
        dueOn: (r.due_on as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        started: r.workout_id !== null,
      }));
  }

  /** The workout to open for an assignment of this person that is still open, or null. */
  async claim(assignmentId: string): Promise<{ name: string; exercises: TemplateExercise[]; cardio: TemplateCardio[]; note: string | null } | null> {
    const r = await this.db
      .prepare(`SELECT a.name, a.snapshot, a.note FROM assignments a JOIN coaching c ON c.id = a.coaching_id AND c.status = 'active' WHERE a.id = ?1 AND a.trainee_id = ?2 AND ${OPEN} AND ${FRIENDS}`)
      .bind(assignmentId, this.userId)
      .first<Row>();
    if (!r) return null;
    const s = parse<{ exercises?: TemplateExercise[]; cardio?: TemplateCardio[] }>(r.snapshot, {});
    if (!Array.isArray(s.exercises) || s.exercises.length === 0 || s.exercises.length > 15) return null;
    return { name: r.name as string, exercises: s.exercises, cardio: Array.isArray(s.cardio) ? s.cardio : [], note: (r.note as string | null) ?? null };
  }

  /** Remembers the workout opened for an assignment (opening it again replaces it). */
  async markStarted(assignmentId: string, workoutId: string): Promise<void> {
    await this.db.prepare('UPDATE assignments SET workout_id = ? WHERE id = ? AND trainee_id = ?').bind(workoutId, assignmentId, this.userId).run();
  }

  /** The trainee leaves an assignment: it goes from their list, and the coach sees it was skipped. */
  async dismiss(assignmentId: string): Promise<boolean> {
    const r = await this.db.prepare('UPDATE assignments SET dismissed_at = ? WHERE id = ? AND trainee_id = ? AND dismissed_at IS NULL AND workout_id IS NULL').bind(this.now(), assignmentId, this.userId).run();
    return r.meta.changes > 0;
  }

  /**
   * What this coach assigned, newest first: whether each was started, finished or skipped, and (only when the trainee agreed) how it went.
   * Nothing else of the trainee's log is read: the one workout an assignment was started as.
   */
  async assignedByMe(coachingId?: string, limit = 30): Promise<AssignmentForCoach[]> {
    const { results } = await this.db
      .prepare(
        `SELECT a.id, a.coaching_id, a.name, a.due_on, a.created_at, a.dismissed_at, c.share_results, u.email, p.nickname,
                w.id AS wid, w.day AS wday, w.started_at, w.finished_at, w.exercises AS wex
           FROM assignments a JOIN coaching c ON c.id = a.coaching_id AND c.status = 'active' JOIN users u ON u.id = a.trainee_id LEFT JOIN profiles p ON p.user_id = u.id
           LEFT JOIN workouts w ON w.id = a.workout_id AND w.user_id = a.trainee_id
         WHERE a.coach_id = ?1 AND (?2 IS NULL OR a.coaching_id = ?2) AND ${FRIENDS} ORDER BY a.created_at DESC LIMIT ?3`,
      )
      .bind(this.userId, coachingId ?? null, limit)
      .all<Row>();
    return results.map((r): AssignmentForCoach => {
      const finished = r.finished_at !== null && r.finished_at !== undefined;
      const status: AssignmentStatus = r.dismissed_at !== null ? 'skipped' : finished ? 'done' : r.wid ? 'started' : 'assigned';
      const base: AssignmentForCoach = { assignmentId: r.id as string, coachingId: r.coaching_id as string, trainee: person(r), name: r.name as string, dueOn: (r.due_on as string | null) ?? null, status, assignedOn: day(r.created_at as number) };
      if (status !== 'done' || r.share_results !== 1) return base;
      const started = r.started_at as number | null;
      const minutes = started && (r.finished_at as number) > started ? Math.max(1, Math.round(((r.finished_at as number) - started) / 60_000)) : null;
      const exercises = parse<StoredExercise[]>(r.wex, []).map((e) => {
        const working = e.sets.filter((s) => s.type === 'working' && s.done !== false);
        const efforts = working.flatMap((s, i) => (s.effort ? [`set ${i + 1} ${EFFORT_LABELS[s.effort - 1] ?? ''}`.trim()] : []));
        return { name: e.exerciseName, sets: summarizeSets(e.sets, 'metric', { load: e.load, ...(e.mode ? { mode: e.mode } : {}) }) || 'not done', effort: efforts.length ? efforts.join(', ') : null, note: e.notes ? cleanText(e.notes, 200) : null };
      });
      return { ...base, result: { day: r.wday as string, minutes, exercises } };
    });
  }

  /** The person's own copy: who they coach or are coached by, and the assignments (names, days, notes and status; the workouts' contents stay out). */
  async exportAll() {
    const { asCoach, asTrainee } = await this.list();
    const { results } = await this.db
      .prepare(
        `SELECT a.name, a.due_on, a.note, a.created_at, a.dismissed_at, a.coach_id = ?1 AS given, u.email, p.nickname, a.workout_id IS NOT NULL AS started
           FROM assignments a JOIN users u ON u.id = CASE WHEN a.coach_id = ?1 THEN a.trainee_id ELSE a.coach_id END LEFT JOIN profiles p ON p.user_id = u.id
         WHERE a.coach_id = ?1 OR a.trainee_id = ?1 ORDER BY a.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    const who = (v: CoachingView) => ({ with: v.with.nickname ?? v.with.email, status: v.status, shareResults: v.shareResults, since: v.since });
    return {
      coaching: { asCoach: asCoach.map(who), asTrainee: asTrainee.map(who) },
      assignments: results.map((r) => ({ direction: r.given === 1 ? 'given' : 'received', with: (r.nickname as string | null) ?? (r.email as string), name: r.name, dueOn: r.due_on, note: r.note, assignedOn: day(r.created_at as number), skipped: r.dismissed_at !== null, started: r.started === 1 })),
    };
  }
}
