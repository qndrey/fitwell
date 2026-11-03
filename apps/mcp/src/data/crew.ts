// The crew feed (B3): what friends have shared with this person, and kudos. Every read goes through one rule: an accepted friendship and a share of
// that category from the friend to this person. No share, no pending request and no ended friendship gives anything, and nothing here reads body data.
import type { CrewConsistency, CrewFeed, CrewFriend, CrewPerson, CrewWorkout } from '../analytics/crewTypes';
import { loadConsistency } from '../analytics/streaks';
import { sessionBest } from '../workout/bests';
import type { StoredExercise } from './workoutData';
import { cleanText } from './transfers';
import { UserData } from './userData';
import { WorkoutData } from './workoutData';

export const FEED_DAYS = 14;
export const FEED_LIMIT = 30;
export const MAX_CONSISTENCY_FRIENDS = 20;

type Row = Record<string, unknown>;

const person = (r: Row): CrewPerson => {
  const nickname = (r.nickname as string | null) ?? null;
  return { nickname, email: nickname ? null : (r.email as string) };
};

export class CrewData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Friends who share workouts and/or consistency with this person. */
  private async sharingFriends(): Promise<{ id: string; who: CrewPerson; workouts: boolean; consistency: boolean }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT u.id, u.email, p.nickname,
                EXISTS (SELECT 1 FROM shares s WHERE s.owner_id = u.id AND s.viewer_id = ?1 AND s.category = 'workouts') AS workouts,
                EXISTS (SELECT 1 FROM shares s WHERE s.owner_id = u.id AND s.viewer_id = ?1 AND s.category = 'consistency') AS consistency
         FROM connections c JOIN users u ON u.id = CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END LEFT JOIN profiles p ON p.user_id = u.id
         WHERE c.status = 'accepted' AND (c.requester_id = ?1 OR c.addressee_id = ?1) ORDER BY u.email`,
      )
      .bind(this.userId)
      .all<Row>();
    return results.map((r) => ({ id: r.id as string, who: person(r), workouts: r.workouts === 1, consistency: r.consistency === 1 })).filter((f) => f.workouts || f.consistency);
  }

  /** Finished workouts of friends who share them, newest first, from `fromDay`; each carries the kudos count and whether this person gave one. */
  async workouts(fromDay: string): Promise<CrewWorkout[]> {
    const { results } = await this.db
      .prepare(
        `SELECT w.id, w.user_id AS owner_id, w.day, w.type, w.finished_at AS fin, w.name, w.started_at, w.finished_at, w.exercises, w.cardio, w.session, u.email, p.nickname,
                (SELECT COUNT(*) FROM kudos k WHERE k.workout_id = w.id) AS kudos,
                EXISTS (SELECT 1 FROM kudos k WHERE k.workout_id = w.id AND k.giver_id = ?1) AS mine
         FROM workouts w
         JOIN shares s ON s.owner_id = w.user_id AND s.viewer_id = ?1 AND s.category = 'workouts'
         JOIN connections c ON c.status = 'accepted' AND ((c.requester_id = s.owner_id AND c.addressee_id = s.viewer_id) OR (c.requester_id = s.viewer_id AND c.addressee_id = s.owner_id))
         JOIN users u ON u.id = w.user_id LEFT JOIN profiles p ON p.user_id = u.id
         WHERE w.day >= ?2 AND (w.type != 'strength' OR w.finished_at IS NOT NULL)
         ORDER BY w.day DESC, w.created_at DESC LIMIT ?3`,
      )
      .bind(this.userId, fromDay, FEED_LIMIT)
      .all<Row>();
    const out = results.map((r) => toCrewWorkout(r));
    // A new personal best: the best estimated 1RM of an exercise in this workout beats the friend's earlier finished workouts (and there were some: a first time is not a record).
    const owners = [...new Set(results.filter((r) => r.type === 'strength').map((r) => r.owner_id as string))];
    for (const owner of owners) {
      const { results: past } = await this.db
        .prepare("SELECT id, finished_at, exercises FROM workouts WHERE user_id = ? AND type = 'strength' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 400")
        .bind(owner)
        .all<Row>();
      const sessions = past.map((p) => ({ id: p.id as string, at: p.finished_at as number, exercises: parse<StoredExercise[]>(p.exercises, []) }));
      for (const [i, r] of results.entries()) {
        if (r.owner_id !== owner || r.type !== 'strength') continue;
        const me = sessions.find((s) => s.id === r.id);
        if (!me) continue;
        const best = (exs: StoredExercise[]) => new Map(exs.map((e) => [e.exerciseRef, sessionBest(e.sets)]));
        const earlier = new Map<string, number>();
        for (const s of sessions) if (s.at < me.at) for (const [ref, v] of best(s.exercises)) earlier.set(ref, Math.max(earlier.get(ref) ?? 0, v));
        out[i]!.records = me.exercises.filter((e) => earlier.has(e.exerciseRef) && earlier.get(e.exerciseRef)! > 0 && sessionBest(e.sets) > earlier.get(e.exerciseRef)!).slice(0, 3).map((e) => cleanText(e.exerciseName, 40)).filter(Boolean);
      }
    }
    return out;
  }

  /** Gives kudos on a friend's finished workout this person can see. False when they cannot (not a friend, nothing shared, not finished, or their own). */
  async giveKudos(workoutId: string): Promise<boolean> {
    const r = await this.db
      .prepare(
        `INSERT OR IGNORE INTO kudos (giver_id, workout_id, owner_id, created_at)
         SELECT ?1, w.id, w.user_id, ?3 FROM workouts w
           JOIN shares s ON s.owner_id = w.user_id AND s.viewer_id = ?1 AND s.category = 'workouts'
           JOIN connections c ON c.status = 'accepted' AND ((c.requester_id = s.owner_id AND c.addressee_id = s.viewer_id) OR (c.requester_id = s.viewer_id AND c.addressee_id = s.owner_id))
         WHERE w.id = ?2 AND w.user_id != ?1 AND (w.type != 'strength' OR w.finished_at IS NOT NULL)`,
      )
      .bind(this.userId, workoutId, this.now())
      .run();
    if (r.meta.changes > 0) return true;
    // Nothing was added: either kudos were already given on a workout they can still see (done), or they may not see it (refused).
    return (await this.canSee(workoutId)) && (await this.db.prepare('SELECT 1 AS ok FROM kudos WHERE giver_id = ? AND workout_id = ?').bind(this.userId, workoutId).first<Row>()) !== null;
  }

  /** Whether this person may see (and so give kudos on) this workout: a friend's, finished, with workouts shared with them. */
  private async canSee(workoutId: string): Promise<boolean> {
    const r = await this.db
      .prepare(
        `SELECT 1 AS ok FROM workouts w
           JOIN shares s ON s.owner_id = w.user_id AND s.viewer_id = ?1 AND s.category = 'workouts'
           JOIN connections c ON c.status = 'accepted' AND ((c.requester_id = s.owner_id AND c.addressee_id = s.viewer_id) OR (c.requester_id = s.viewer_id AND c.addressee_id = s.owner_id))
         WHERE w.id = ?2 AND w.user_id != ?1 AND (w.type != 'strength' OR w.finished_at IS NOT NULL)`,
      )
      .bind(this.userId, workoutId)
      .first<Row>();
    return r !== null;
  }

  /** This person's own recent workouts that friends gave kudos to, and who gave them (only friends they still have, shown as friends are). */
  async kudosOnMine(fromDay: string): Promise<CrewFeed['yours']> {
    const { results } = await this.db
      .prepare(
        `SELECT w.id, w.day, w.name, w.type, u.email, p.nickname FROM kudos k
           JOIN workouts w ON w.id = k.workout_id AND w.user_id = ?1
           JOIN connections c ON c.status = 'accepted' AND ((c.requester_id = ?1 AND c.addressee_id = k.giver_id) OR (c.requester_id = k.giver_id AND c.addressee_id = ?1))
           JOIN users u ON u.id = k.giver_id LEFT JOIN profiles p ON p.user_id = u.id
         WHERE w.day >= ?2 ORDER BY w.day DESC, k.created_at`,
      )
      .bind(this.userId, fromDay)
      .all<Row>();
    const byWorkout = new Map<string, CrewFeed['yours'][number]>();
    for (const r of results) {
      const id = r.id as string;
      if (!byWorkout.has(id)) byWorkout.set(id, { id, day: r.day as string, title: titleOf(r), from: [] });
      byWorkout.get(id)!.from.push(person(r));
    }
    return [...byWorkout.values()];
  }

  /** The feed: friends, their consistency (where shared), their recent workouts (where shared), and kudos on this person's own. */
  async feed(today: string, addDays: (d: string, n: number) => string): Promise<CrewFeed> {
    const from = addDays(today, -(FEED_DAYS - 1));
    const friends = await this.sharingFriends();
    const crew: CrewFriend[] = [];
    for (const f of friends.slice(0, 50)) {
      let consistency: CrewConsistency | null = null;
      if (f.consistency && crew.filter((c) => c.consistency).length < MAX_CONSISTENCY_FRIENDS) {
        consistency = await loadConsistency({ data: new UserData(this.db, f.id), workouts: new WorkoutData(this.db, f.id) });
      }
      crew.push({ who: f.who, consistency });
    }
    return { from, to: today, friends: crew, workouts: await this.workouts(from), yours: await this.kudosOnMine(from) };
  }

  /** The kudos this person gave and received, for their own copy. */
  async exportAll() {
    const { results } = await this.db
      .prepare(
        `SELECT k.workout_id, k.created_at, k.giver_id = ?1 AS gave, u.email, p.nickname FROM kudos k
           JOIN users u ON u.id = CASE WHEN k.giver_id = ?1 THEN k.owner_id ELSE k.giver_id END LEFT JOIN profiles p ON p.user_id = u.id
         WHERE k.giver_id = ?1 OR k.owner_id = ?1 ORDER BY k.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    return { kudos: results.map((r) => ({ direction: r.gave === 1 ? 'gave' : 'received', with: (r.nickname as string | null) ?? (r.email as string), at: r.created_at })) };
  }
}

const KIND = { strength: 'Strength workout', cardio: 'Cardio', session: 'Session' } as const;

function parse<T>(v: unknown, fallback: T): T {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function titleOf(r: Row): string {
  const type = r.type as keyof typeof KIND;
  return cleanText(r.name, 60) || KIND[type] || 'Workout';
}

/** A friend's workout as the feed shows it: counts and names only, never weights, reps, notes, body weight or calories. */
function toCrewWorkout(r: Row): CrewWorkout {
  const type = r.type as CrewWorkout['type'];
  const exercises = parse<{ exerciseName?: string; sets?: { done?: boolean }[] }[]>(r.exercises, []);
  const details = parse<{ durationMin?: number; activityName?: string; category?: string } | null>(type === 'session' ? r.session : r.cardio, null);
  const started = r.started_at as number | null;
  const finished = r.finished_at as number | null;
  const minutes = type === 'strength' ? (started && finished && finished > started ? Math.max(1, Math.round((finished - started) / 60_000)) : null) : typeof details?.durationMin === 'number' ? Math.round(details.durationMin) : null;
  const named = type === 'strength' ? null : cleanText(details?.activityName ?? details?.category, 40);
  return {
    id: r.id as string,
    who: person(r),
    day: r.day as string,
    type,
    title: cleanText(r.name, 60) || named || KIND[type] || 'Workout',
    exercises: type === 'strength' ? exercises.slice(0, 4).map((e) => cleanText(e.exerciseName, 40)).filter(Boolean) : [],
    exerciseCount: type === 'strength' ? exercises.length : 0,
    sets: type === 'strength' ? exercises.reduce((n, e) => n + (e.sets ?? []).filter((s) => s.done !== false).length, 0) : 0,
    minutes,
    kudos: { count: (r.kudos as number) ?? 0, mine: r.mine === 1 },
    records: [],
  };
}
