// Challenges (B4): a time-boxed, opt-in, consistency-based contest among friends of the person who made it. What is shown of anyone is one number: the days that counted (at most
// `perWeek` in each week). The numbers are worked out here from each person's own days and nothing else of theirs is read or returned. Names are shown as friends are, except that a
// person who is not your friend appears by nickname only (or as "a participant"): joining a challenge never gives out an email address.
import { addDays, dayDiff, isDay, weekStart as mondayOf } from '@fitwell/core/domain/dates';

export const METRICS = ['training_days', 'protein_days', 'steps_days'] as const;
export type Metric = (typeof METRICS)[number];
export const MAX_MEMBERS = 10;
export const MAX_OPEN_OWNED = 3;
export const MAX_OPEN_JOINED = 3;
export const MAX_WEEKS_AHEAD = 8;

type Row = Record<string, unknown>;

export interface Challenge {
  id: string;
  ownerId: string;
  name: string;
  metric: Metric;
  threshold: number | null;
  perWeek: number;
  weeks: number;
  startDay: string;
  endDay: string;
  status: 'open' | 'closed';
}

export interface Standing {
  /** As the viewer may see them: a nickname, the viewer's own friend's email, or "a participant". */
  who: string;
  you: boolean;
  score: number;
  rank: number;
}

export interface ChallengeView {
  id: string;
  name: string;
  metric: Metric;
  rule: string;
  startDay: string;
  endDay: string;
  /** upcoming, running, or finished (over, results to be sent) or closed. */
  state: 'upcoming' | 'running' | 'finished' | 'closed';
  yours: boolean;
  /** The most days a person can score. */
  maxScore: number;
  standings: Standing[];
  invited: number;
}

export interface ChallengeInvite {
  challengeId: string;
  name: string;
  from: string;
  rule: string;
  startDay: string;
  endDay: string;
}

export type CreateOutcome = { ok: true; challenge: Challenge } | { ok: false; reason: 'too_many' | 'bad_start' | 'needs_threshold' };
export type InviteOutcome = { ok: true } | { ok: false; reason: 'not_owner' | 'not_friends' | 'over' | 'full' | 'already' };
export type JoinOutcome = { ok: true } | { ok: false; reason: 'not_found' | 'over' | 'too_many' | 'needs_protein_goal' | 'full' };

const toChallenge = (r: Row): Challenge => ({
  id: r.id as string,
  ownerId: r.owner_id as string,
  name: r.name as string,
  metric: r.metric as Metric,
  threshold: (r.threshold as number | null) ?? null,
  perWeek: r.per_week as number,
  weeks: r.weeks as number,
  startDay: r.start_day as string,
  endDay: addDays(r.start_day as string, (r.weeks as number) * 7 - 1),
  status: r.status as 'open' | 'closed',
});

/** The rule in words, for the person and for the email. */
export function ruleText(c: Pick<Challenge, 'metric' | 'threshold' | 'perWeek' | 'weeks'>): string {
  const what = c.metric === 'training_days' ? 'a day with a finished workout or session' : c.metric === 'protein_days' ? 'a day with protein at or over your own protein goal' : `a day with at least ${(c.threshold ?? 0).toLocaleString('en-US')} steps`;
  return `Each ${what} counts, up to ${c.perWeek} a week, for ${c.weeks} ${c.weeks === 1 ? 'week' : 'weeks'}: a rest day never costs a point.`;
}

/** The days of a challenge that counted for one person, capped at perWeek in each week, as a total. Reads only that person's own day totals. */
export async function scoreOf(db: D1Database, userId: string, c: Challenge, upTo: string): Promise<number> {
  const to = upTo < c.endDay ? upTo : c.endDay;
  if (to < c.startDay) return 0;
  let days: string[];
  if (c.metric === 'training_days') {
    const { results } = await db.prepare("SELECT DISTINCT day FROM workouts WHERE user_id = ? AND day BETWEEN ? AND ? AND (type != 'strength' OR finished_at IS NOT NULL)").bind(userId, c.startDay, to).all<Row>();
    days = results.map((r) => r.day as string);
  } else if (c.metric === 'steps_days') {
    const { results } = await db.prepare('SELECT day FROM daily_metrics WHERE user_id = ? AND day BETWEEN ? AND ? AND steps >= ?').bind(userId, c.startDay, to, c.threshold ?? 0).all<Row>();
    days = results.map((r) => r.day as string);
  } else {
    const goal = (await db.prepare('SELECT protein_g FROM goals WHERE user_id = ?').bind(userId).first<Row>())?.protein_g as number | null | undefined;
    if (!goal) return 0;
    const { results } = await db.prepare('SELECT day FROM food_entries WHERE user_id = ? AND day BETWEEN ? AND ? GROUP BY day HAVING SUM(protein) >= ?').bind(userId, c.startDay, to, goal).all<Row>();
    days = results.map((r) => r.day as string);
  }
  const perWeek = new Map<number, number>();
  for (const d of days) {
    const w = Math.floor(dayDiff(c.startDay, d) / 7);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  return [...perWeek.values()].reduce((n, k) => n + Math.min(k, c.perWeek), 0);
}

/** Places with ties sharing one (1, 2, 2, 4). */
export function rankScores(scores: number[]): number[] {
  const sorted = [...scores].sort((a, b) => b - a);
  return scores.map((s) => sorted.indexOf(s) + 1);
}

export class ChallengeData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  private today = () => new Date(this.now()).toISOString().slice(0, 10);

  /** The first row of a challenge this person is part of (joined or invited), or null: nothing else is readable. */
  private async mineById(id: string): Promise<{ c: Challenge; status: 'invited' | 'joined' } | null> {
    const r = await this.db
      .prepare('SELECT c.*, m.status AS my_status FROM challenges c JOIN challenge_members m ON m.challenge_id = c.id WHERE c.id = ? AND m.user_id = ?')
      .bind(id, this.userId)
      .first<Row>();
    return r ? { c: toChallenge(r), status: r.my_status as 'invited' | 'joined' } : null;
  }

  async create(i: { name: string; metric: Metric; threshold: number | null; perWeek: number; weeks: number; startDay: string }): Promise<CreateOutcome> {
    if (i.metric === 'steps_days' && !i.threshold) return { ok: false, reason: 'needs_threshold' };
    if (!isDay(i.startDay) || mondayOf(i.startDay) !== i.startDay || i.startDay < mondayOf(this.today()) || i.startDay > addDays(this.today(), 7 * MAX_WEEKS_AHEAD)) return { ok: false, reason: 'bad_start' };
    const owned = ((await this.db.prepare("SELECT COUNT(*) AS n FROM challenges WHERE owner_id = ? AND status = 'open'").bind(this.userId).first<Row>())?.n as number) ?? 0;
    if (owned >= MAX_OPEN_OWNED) return { ok: false, reason: 'too_many' };
    const id = crypto.randomUUID();
    const at = this.now();
    await this.db.batch([
      this.db.prepare('INSERT INTO challenges (id, owner_id, name, metric, threshold, per_week, weeks, start_day, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, this.userId, i.name, i.metric, i.metric === 'steps_days' ? i.threshold : null, i.perWeek, i.weeks, i.startDay, 'open', at),
      this.db.prepare("INSERT INTO challenge_members (challenge_id, user_id, status, created_at, joined_at) VALUES (?, ?, 'joined', ?, ?)").bind(id, this.userId, at, at),
    ]);
    return { ok: true, challenge: (await this.mineById(id))!.c };
  }

  /** Invites a friend (by the connection's id). Only the owner, only while the challenge is not over. */
  async invite(challengeId: string, connectionId: string): Promise<InviteOutcome> {
    const mine = await this.mineById(challengeId);
    if (!mine || mine.c.ownerId !== this.userId) return { ok: false, reason: 'not_owner' };
    if (mine.c.status === 'closed' || mine.c.endDay < this.today()) return { ok: false, reason: 'over' };
    const friend = await this.db
      .prepare(`SELECT CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END AS id FROM connections c WHERE c.id = ?2 AND c.status = 'accepted' AND (c.requester_id = ?1 OR c.addressee_id = ?1)`)
      .bind(this.userId, connectionId)
      .first<Row>();
    if (!friend) return { ok: false, reason: 'not_friends' };
    const size = ((await this.db.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE challenge_id = ?').bind(challengeId).first<Row>())?.n as number) ?? 0;
    if (size >= MAX_MEMBERS) return { ok: false, reason: 'full' };
    const r = await this.db.prepare("INSERT OR IGNORE INTO challenge_members (challenge_id, user_id, status, created_at) VALUES (?, ?, 'invited', ?)").bind(challengeId, friend.id as string, this.now()).run();
    return r.meta.changes > 0 ? { ok: true } : { ok: false, reason: 'already' };
  }

  /** Invitations waiting for this person, from people who are still their friends. */
  async incoming(): Promise<ChallengeInvite[]> {
    const { results } = await this.db
      .prepare(
        `SELECT c.*, u.email, p.nickname FROM challenge_members m JOIN challenges c ON c.id = m.challenge_id JOIN users u ON u.id = c.owner_id LEFT JOIN profiles p ON p.user_id = c.owner_id
         WHERE m.user_id = ?1 AND m.status = 'invited' AND c.status = 'open' AND EXISTS (SELECT 1 FROM connections k WHERE k.status = 'accepted' AND ((k.requester_id = ?1 AND k.addressee_id = c.owner_id) OR (k.requester_id = c.owner_id AND k.addressee_id = ?1)))
         ORDER BY c.start_day`,
      )
      .bind(this.userId)
      .all<Row>();
    return results.map((r) => {
      const c = toChallenge(r);
      return { challengeId: c.id, name: c.name, from: (r.nickname as string | null) ?? (r.email as string), rule: ruleText(c), startDay: c.startDay, endDay: c.endDay };
    });
  }

  async accept(challengeId: string): Promise<JoinOutcome> {
    const mine = await this.mineById(challengeId);
    if (!mine || mine.status !== 'invited') return { ok: false, reason: 'not_found' };
    if (mine.c.status === 'closed' || mine.c.endDay < this.today()) return { ok: false, reason: 'over' };
    if (mine.c.metric === 'protein_days') {
      const goal = (await this.db.prepare('SELECT protein_g FROM goals WHERE user_id = ?').bind(this.userId).first<Row>())?.protein_g;
      if (!goal) return { ok: false, reason: 'needs_protein_goal' };
    }
    const joined = ((await this.db.prepare("SELECT COUNT(*) AS n FROM challenge_members m JOIN challenges c ON c.id = m.challenge_id WHERE m.user_id = ? AND m.status = 'joined' AND c.status = 'open'").bind(this.userId).first<Row>())?.n as number) ?? 0;
    if (joined >= MAX_OPEN_JOINED) return { ok: false, reason: 'too_many' };
    await this.db.prepare("UPDATE challenge_members SET status = 'joined', joined_at = ? WHERE challenge_id = ? AND user_id = ?").bind(this.now(), challengeId, this.userId).run();
    return { ok: true };
  }

  async decline(challengeId: string): Promise<boolean> {
    return (await this.db.prepare("DELETE FROM challenge_members WHERE challenge_id = ? AND user_id = ? AND status = 'invited'").bind(challengeId, this.userId).run()).meta.changes > 0;
  }

  /** Leaves a challenge (not the owner's own: that is cancelled). The score goes with them. */
  async leave(challengeId: string): Promise<boolean> {
    return (await this.db.prepare("DELETE FROM challenge_members WHERE challenge_id = ?1 AND user_id = ?2 AND challenge_id NOT IN (SELECT id FROM challenges WHERE owner_id = ?2)").bind(challengeId, this.userId).run()).meta.changes > 0;
  }

  /** The owner cancels a challenge: it and every score in it are deleted. */
  async cancel(challengeId: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM challenges WHERE id = ? AND owner_id = ?').bind(challengeId, this.userId).run()).meta.changes > 0;
  }

  /** The challenges this person is in (joined), with the standings of those who joined. */
  async list(): Promise<ChallengeView[]> {
    const { results } = await this.db
      .prepare("SELECT c.* FROM challenges c JOIN challenge_members m ON m.challenge_id = c.id WHERE m.user_id = ? AND m.status = 'joined' ORDER BY c.start_day DESC, c.created_at DESC LIMIT 20")
      .bind(this.userId)
      .all<Row>();
    const out: ChallengeView[] = [];
    for (const r of results) out.push(await this.view(toChallenge(r)));
    return out;
  }

  private async view(c: Challenge): Promise<ChallengeView> {
    const today = this.today();
    const { results: members } = await this.db
      .prepare(
        `SELECT m.user_id, m.status, m.score, m.rank, u.email, p.nickname,
                EXISTS (SELECT 1 FROM connections k WHERE k.status = 'accepted' AND ((k.requester_id = ?2 AND k.addressee_id = m.user_id) OR (k.requester_id = m.user_id AND k.addressee_id = ?2))) AS friend
         FROM challenge_members m JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = m.user_id WHERE m.challenge_id = ?1`,
      )
      .bind(c.id, this.userId)
      .all<Row>();
    const joined = members.filter((m) => m.status === 'joined');
    const scores: number[] = [];
    for (const m of joined) scores.push(c.status === 'closed' && m.score !== null ? (m.score as number) : await scoreOf(this.db, m.user_id as string, c, today));
    const ranks = rankScores(scores);
    const standings = joined
      .map((m, i): Standing => ({ who: m.user_id === this.userId ? 'You' : ((m.nickname as string | null) ?? (m.friend === 1 ? (m.email as string) : 'A participant')), you: m.user_id === this.userId, score: scores[i]!, rank: ranks[i]! }))
      .sort((a, b) => a.rank - b.rank || Number(b.you) - Number(a.you));
    return {
      id: c.id,
      name: c.name,
      metric: c.metric,
      rule: ruleText(c),
      startDay: c.startDay,
      endDay: c.endDay,
      state: c.status === 'closed' ? 'closed' : today < c.startDay ? 'upcoming' : today > c.endDay ? 'finished' : 'running',
      yours: c.ownerId === this.userId,
      maxScore: c.weeks * c.perWeek,
      standings,
      invited: members.length - joined.length,
    };
  }

  /** The challenges and invitations of this person, for their own copy: names and rules, their own score, nothing of anyone else's. */
  async exportAll() {
    const mine = await this.list();
    return { challenges: mine.map((c) => ({ name: c.name, rule: c.rule, startDay: c.startDay, endDay: c.endDay, state: c.state, owner: c.yours, yourScore: c.standings.find((s) => s.you)?.score ?? null })), challengeInvitations: await this.incoming() };
  }
}

/** Closes the challenges that ended before `today` (UTC, so every time zone's last day is over): fixes each joined member's score and place. Returns what was closed. */
export async function closeDue(db: D1Database, today: string, now: number): Promise<{ challenge: Challenge; members: { userId: string; score: number; rank: number }[] }[]> {
  const { results } = await db.prepare("SELECT * FROM challenges WHERE status = 'open'").all<Row>();
  const closed = [];
  for (const r of results) {
    const c = toChallenge(r);
    if (!(c.endDay < today)) continue;
    const { results: joined } = await db.prepare("SELECT user_id FROM challenge_members WHERE challenge_id = ? AND status = 'joined'").bind(c.id).all<Row>();
    const ids = joined.map((m) => m.user_id as string);
    const scores: number[] = [];
    for (const id of ids) scores.push(await scoreOf(db, id, c, c.endDay));
    const ranks = rankScores(scores);
    await db.batch([
      ...ids.map((id, i) => db.prepare('UPDATE challenge_members SET score = ?, rank = ? WHERE challenge_id = ? AND user_id = ?').bind(scores[i]!, ranks[i]!, c.id, id)),
      db.prepare("DELETE FROM challenge_members WHERE challenge_id = ? AND status = 'invited'").bind(c.id),
      db.prepare("UPDATE challenges SET status = 'closed', closed_at = ? WHERE id = ?").bind(now, c.id),
    ]);
    closed.push({ challenge: { ...c, status: 'closed' as const }, members: ids.map((userId, i) => ({ userId, score: scores[i]!, rank: ranks[i]! })) });
  }
  return closed;
}
