// Email digests (E1): who asked for which, the secret behind each unsubscribe link, and what was already sent.
export const DIGEST_KINDS = ['weekly', 'nudge'] as const;
export type DigestKind = (typeof DIGEST_KINDS)[number];

export interface DigestSettings {
  weeklyReview: boolean;
  inactivityNudge: boolean;
}

type Row = Record<string, unknown>;

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export class DigestData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  async settings(): Promise<DigestSettings> {
    const r = await this.db.prepare('SELECT digest_weekly, digest_nudge FROM profiles WHERE user_id = ?').bind(this.userId).first<Row>();
    return { weeklyReview: r?.digest_weekly === 1, inactivityNudge: r?.digest_nudge === 1 };
  }

  /** Turns digests on or off (only the given ones change). The first time one is turned on the unsubscribe secret is made. */
  async set(patch: Partial<DigestSettings>): Promise<DigestSettings> {
    await this.db.prepare('INSERT OR IGNORE INTO profiles (user_id, updated_at) VALUES (?, ?)').bind(this.userId, this.now()).run();
    const cur = await this.settings();
    const next = { ...cur, ...patch };
    await this.db
      .prepare('UPDATE profiles SET digest_weekly = ?, digest_nudge = ?, digest_token = CASE WHEN ?3 = 1 AND digest_token IS NULL THEN ?4 ELSE digest_token END, updated_at = ?5 WHERE user_id = ?6')
      .bind(next.weeklyReview ? 1 : 0, next.inactivityNudge ? 1 : 0, next.weeklyReview || next.inactivityNudge ? 1 : 0, randomToken(), this.now(), this.userId)
      .run();
    return next;
  }
}

/** Whether this is the person's unsubscribe secret (nothing is changed). */
export async function validToken(db: D1Database, userId: string, token: string): Promise<boolean> {
  const r = await db.prepare('SELECT digest_token FROM profiles WHERE user_id = ?').bind(userId).first<Row>();
  const stored = r?.digest_token as string | null | undefined;
  return !!stored && sameToken(stored, token);
}

/** Switches one kind (or all) off for the person whose secret this is. False when the secret is not theirs. Constant-time comparison of the secret. */
export async function unsubscribe(db: D1Database, userId: string, token: string, kind: DigestKind | 'all'): Promise<boolean> {
  const r = await db.prepare('SELECT digest_token FROM profiles WHERE user_id = ?').bind(userId).first<Row>();
  const stored = r?.digest_token as string | null | undefined;
  if (!stored || !sameToken(stored, token)) return false;
  const sets = kind === 'all' ? 'digest_weekly = 0, digest_nudge = 0' : kind === 'weekly' ? 'digest_weekly = 0' : 'digest_nudge = 0';
  await db.prepare(`UPDATE profiles SET ${sets} WHERE user_id = ?`).bind(userId).run();
  return true;
}

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Everyone with a digest on and an active account, with what they need to be sent one. */
export async function recipients(db: D1Database): Promise<{ id: string; email: string; weekly: boolean; nudge: boolean; token: string }[]> {
  const { results } = await db
    .prepare("SELECT u.id, u.email, p.digest_weekly, p.digest_nudge, p.digest_token FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.status = 'active' AND (p.digest_weekly = 1 OR p.digest_nudge = 1) AND p.digest_token IS NOT NULL")
    .all<Row>();
  return results.map((r) => ({ id: r.id as string, email: r.email as string, weekly: r.digest_weekly === 1, nudge: r.digest_nudge === 1, token: r.digest_token as string }));
}

/** Records that a digest is being sent; false when it already was (so a second cron run, or a retry, sends nothing). */
export async function claim(db: D1Database, userId: string, kind: DigestKind, period: string, now: number): Promise<boolean> {
  const r = await db.prepare('INSERT OR IGNORE INTO digest_log (user_id, kind, period, sent_at) VALUES (?, ?, ?, ?)').bind(userId, kind, period, now).run();
  return r.meta.changes > 0;
}

/** Gives the claim back when the email could not be sent, so the next run tries again. */
export async function release(db: D1Database, userId: string, kind: DigestKind, period: string): Promise<void> {
  await db.prepare('DELETE FROM digest_log WHERE user_id = ? AND kind = ? AND period = ?').bind(userId, kind, period).run();
}
