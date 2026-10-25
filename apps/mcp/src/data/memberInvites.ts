// Members inviting friends: who may invite (active people), the limits, expiry and what is stored.
// Every send is a member_invites row with the typed address, so the inviter's list and counts look the same whether or not
// the address already had an account. A new address also gets a users row (status 'invited', invited_by set); it is "joined" once that person signs in.
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

const JOINED = "EXISTS (SELECT 1 FROM users u WHERE u.email = m.email AND u.invited_by = m.inviter_id AND u.status = 'active')";

/** Waiting invitations: typed in the last 30 days, not cancelled, and not yet signed in through this inviter's invitation. */
export async function countUnused(db: D1Database, inviterId: string, now: number): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM member_invites m WHERE m.inviter_id = ? AND m.email IS NOT NULL AND m.created_at > ? AND NOT ${JOINED}`).bind(inviterId, now - INVITE_TTL_MS).first<number>('n')) ?? 0;
}

/** Records one invitation (and its address) unless the person has sent 3 in 30 days or has 5 waiting (with today's numbers the first always comes first; both are checked in case the numbers change); null then. One statement, so parallel sends cannot get past either limit. */
export async function reserveInvite(db: D1Database, inviterId: string, email: string, now: number, limits = { perWindow: INVITES_PER_WINDOW, maxUnused: MAX_UNUSED_INVITES }): Promise<string | null> {
  const id = crypto.randomUUID();
  const r = await db
    .prepare(
      `INSERT INTO member_invites (id, inviter_id, created_at, email)
       SELECT ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM member_invites WHERE inviter_id = ? AND created_at > ?) < ?
         AND (SELECT COUNT(*) FROM member_invites m WHERE m.inviter_id = ? AND m.email IS NOT NULL AND m.created_at > ? AND NOT ${JOINED}) < ?`,
    )
    .bind(id, inviterId, now, normalizeEmail(email), inviterId, now - INVITE_WINDOW_MS, limits.perWindow, inviterId, now - INVITE_TTL_MS, limits.maxUnused)
    .run();
  return r.meta.changes === 1 ? id : null;
}

export async function releaseInvite(db: D1Database, logId: string): Promise<void> {
  await db.prepare('DELETE FROM member_invites WHERE id = ?').bind(logId).run();
}

/** Adds the invited person unless the address already is one; true when a row was added. */
export async function insertInvitee(db: D1Database, inviterId: string, email: string, now: number): Promise<string | null> {
  const id = crypto.randomUUID();
  const r = await db.prepare("INSERT OR IGNORE INTO users (id, email, name, status, created_at, invited_by) VALUES (?, ?, NULL, 'invited', ?, ?)").bind(id, normalizeEmail(email), now, inviterId).run();
  return r.meta.changes === 1 ? id : null;
}

/** Takes an invitation back: its address is cleared (the row stays, so it still counts) and a person it created and nobody has signed in as is deleted. */
export async function cancelInvite(db: D1Database, inviterId: string, email: string): Promise<void> {
  const address = normalizeEmail(email);
  await db.prepare('UPDATE member_invites SET email = NULL WHERE inviter_id = ? AND email = ?').bind(inviterId, address).run();
  await db.prepare("DELETE FROM users WHERE email = ? AND status = 'invited' AND invited_by = ?").bind(address, inviterId).run();
}

export interface Invitee {
  email: string;
  joined: boolean;
  /** When the invitation was sent, or the friend's first invitation was made. */
  created_at: number;
}

/** What the inviter sees: waiting invitations from the last 30 days (also for addresses that already were people), and friends who joined through them. Oldest first. */
export async function listInvitees(db: D1Database, inviterId: string, now: number): Promise<Invitee[]> {
  const waiting = await db
    .prepare(`SELECT m.email AS email, m.created_at AS created_at FROM member_invites m WHERE m.inviter_id = ? AND m.email IS NOT NULL AND m.created_at > ? AND NOT ${JOINED} ORDER BY m.created_at`)
    .bind(inviterId, now - INVITE_TTL_MS)
    .all<{ email: string; created_at: number }>();
  const joined = await db.prepare("SELECT email, created_at FROM users WHERE invited_by = ? AND status = 'active' ORDER BY created_at").bind(inviterId).all<{ email: string; created_at: number }>();
  return [...waiting.results.map((r) => ({ ...r, joined: false })), ...joined.results.map((r) => ({ ...r, joined: true }))].sort((x, y) => x.created_at - y.created_at);
}

/** What export_my_data holds about invitations: the ones this person sent and who invited them. */
export async function exportInvites(db: D1Database, userId: string, now = Date.now()) {
  const invitees = await listInvitees(db, userId, now);
  const inviter = await db.prepare('SELECT i.email AS email FROM users u JOIN users i ON i.id = u.invited_by WHERE u.id = ?').bind(userId).first<string>('email');
  return {
    invitationsSent: invitees.map((p) => ({ email: p.email, status: p.joined ? 'joined' : 'waiting', invitedAt: day(p.created_at) })),
    invitedBy: inviter ?? null,
  };
}
