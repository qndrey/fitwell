// Members inviting friends: who may invite (active people), the limits, expiry and what is stored.
// An invitation is a users row with status 'invited' and invited_by set; member_invites only counts them (no addresses).
import { normalizeEmail, type User } from './users';

export const INVITES_PER_WINDOW = 3;
export const INVITE_WINDOW_MS = 30 * 86_400_000;
export const MAX_UNUSED_INVITES = 5;
export const INVITE_TTL_MS = 30 * 86_400_000;
export const MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;
export const ACTIVE_DAYS_NEEDED = 3;
export const ACTIVE_WINDOW_MS = 30 * 86_400_000;

const DAY_MS = 86_400_000;
export const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface Standing {
  allowed: boolean;
  /** Days with a food entry, workout or weigh-in stored in the last 30 days. */
  activeDays: number;
  /** Whole days since the first sign-in; null if never signed in. */
  accountAgeDays: number | null;
  sentInWindow: number;
  unused: number;
  /** Day the oldest counted invitation turns 30 days old (when one frees up); null while fewer than 3 are counted. */
  nextFreeOn: string | null;
}

/** Deletes member invitations nobody used within 30 days and log rows older than the window. There is no scheduled job, so callers run it as they go. */
export async function pruneExpiredInvitations(db: D1Database, now: number): Promise<void> {
  // Two independent, repeatable deletes; no batch needed.
  await db.prepare("DELETE FROM users WHERE invited_by IS NOT NULL AND status = 'invited' AND created_at <= ?").bind(now - INVITE_TTL_MS).run();
  await db.prepare('DELETE FROM member_invites WHERE created_at <= ?').bind(now - INVITE_WINDOW_MS).run();
}

async function countActiveDays(db: D1Database, userId: string, now: number): Promise<number> {
  const since = now - ACTIVE_WINDOW_MS;
  const stamp = "date(created_at / 1000, 'unixepoch')";
  return (
    (await db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT ${stamp} AS d FROM food_entries WHERE user_id = ? AND created_at > ?
           UNION SELECT ${stamp} FROM workouts WHERE user_id = ? AND created_at > ?
           UNION SELECT ${stamp} FROM weights WHERE user_id = ? AND created_at > ?)`,
      )
      .bind(userId, since, userId, since, userId, since)
      .first<number>('n')) ?? 0
  );
}

/** Whether this person may send an invitation now, with the numbers behind it. Owners skip the activity rule only. */
export async function standing(db: D1Database, user: User, isAdmin: boolean, now: number): Promise<Standing> {
  const [activeDays, window, unused] = await Promise.all([
    countActiveDays(db, user.id, now),
    db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM member_invites WHERE inviter_id = ? AND created_at > ?').bind(user.id, now - INVITE_WINDOW_MS).first<{ n: number; oldest: number | null }>(),
    countUnused(db, user.id, now),
  ]);
  const sentInWindow = window?.n ?? 0;
  const accountAgeDays = user.consented_at === null ? null : Math.floor((now - user.consented_at) / DAY_MS);
  const signedIn = user.status === 'active' && accountAgeDays !== null;
  const active = signedIn && accountAgeDays >= MIN_ACCOUNT_AGE_MS / DAY_MS && activeDays >= ACTIVE_DAYS_NEEDED;
  return {
    allowed: signedIn && (isAdmin || active),
    activeDays,
    accountAgeDays,
    sentInWindow,
    unused,
    nextFreeOn: sentInWindow >= INVITES_PER_WINDOW && window?.oldest ? day(window.oldest + INVITE_WINDOW_MS) : null,
  };
}

export async function countUnused(db: D1Database, inviterId: string, now: number): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE invited_by = ? AND status = 'invited' AND created_at > ?").bind(inviterId, now - INVITE_TTL_MS).first<number>('n')) ?? 0;
}

/** Records one invitation against the limit; false when a concurrent send already used the last of the 3. */
export async function reserveInvite(db: D1Database, inviterId: string, now: number): Promise<string | null> {
  const id = crypto.randomUUID();
  const r = await db
    .prepare('INSERT INTO member_invites (id, inviter_id, created_at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM member_invites WHERE inviter_id = ? AND created_at > ?) < ?')
    .bind(id, inviterId, now, inviterId, now - INVITE_WINDOW_MS, INVITES_PER_WINDOW)
    .run();
  return r.meta.changes === 1 ? id : null;
}

export async function releaseInvite(db: D1Database, logId: string): Promise<void> {
  await db.prepare('DELETE FROM member_invites WHERE id = ?').bind(logId).run();
}

/** Inserts the invited person unless the address exists or the sender already has 5 unused invitations; returns the new person's id or null. */
export async function insertInvitee(db: D1Database, inviterId: string, email: string, now: number): Promise<string | null> {
  const id = crypto.randomUUID();
  const r = await db
    .prepare("INSERT OR IGNORE INTO users (id, email, name, status, created_at, invited_by) SELECT ?, ?, NULL, 'invited', ?, ? WHERE (SELECT COUNT(*) FROM users WHERE invited_by = ? AND status = 'invited' AND created_at > ?) < ?")
    .bind(id, normalizeEmail(email), now, inviterId, inviterId, now - INVITE_TTL_MS, MAX_UNUSED_INVITES)
    .run();
  return r.meta.changes === 1 ? id : null;
}

export interface Invitee {
  id: string;
  email: string;
  status: 'invited' | 'active';
  created_at: number;
}

/** The people this person invited that are still valid (joined, or waiting and not expired), oldest first. */
export async function listInvitees(db: D1Database, inviterId: string, now: number): Promise<Invitee[]> {
  const { results } = await db
    .prepare("SELECT id, email, status, created_at FROM users WHERE invited_by = ? AND (status = 'active' OR created_at > ?) ORDER BY created_at")
    .bind(inviterId, now - INVITE_TTL_MS)
    .all<Invitee>();
  return results;
}

/** What export_my_data holds about invitations: the ones this person sent and who invited them. */
export async function exportInvites(db: D1Database, userId: string, now = Date.now()) {
  const invitees = await listInvitees(db, userId, now);
  const inviter = await db.prepare('SELECT i.email AS email FROM users u JOIN users i ON i.id = u.invited_by WHERE u.id = ?').bind(userId).first<string>('email');
  return {
    invitationsSent: invitees.map((p) => ({ email: p.email, status: p.status === 'active' ? 'joined' : 'waiting', invitedAt: day(p.created_at) })),
    invitedBy: inviter ?? null,
  };
}
