// Nicknames: one per person, unique across the system ignoring case, shown to friends instead of an email address.
// A nickname is meant to be shared, so whether one is taken can be found out; only lookups for friend requests are rate-limited.

export const NICKNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/;
/** Names that would pass for the service or its owner. */
export const RESERVED_NICKNAMES = ['fitwell', 'admin', 'administrator', 'owner', 'support', 'help', 'official', 'staff', 'moderator', 'system', 'security', 'anthropic', 'claude', 'root', 'team'];

export type NicknameCheck = { ok: true; value: string } | { ok: false; error: string };

/** A nickname as typed: trimmed, 3 to 20 characters of letters, digits, dot, dash and underscore, starting with a letter or digit, not a reserved word. */
export function checkNickname(raw: string): NicknameCheck {
  const value = raw.trim();
  if (!NICKNAME_RE.test(value)) return { ok: false, error: 'A nickname is 3 to 20 characters: letters, digits, dot, dash or underscore, starting with a letter or digit.' };
  if (RESERVED_NICKNAMES.includes(value.toLowerCase())) return { ok: false, error: 'That nickname is not available.' };
  return { ok: true, value };
}

export const LOOKUPS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;

type Row = Record<string, unknown>;

export class NicknameData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string | null> {
    const r = await this.db.prepare('SELECT nickname FROM profiles WHERE user_id = ?').bind(this.userId).first<Row>();
    return (r?.nickname as string | null | undefined) ?? null;
  }

  /** Sets or clears (null) the nickname. 'taken' when someone else has it (ignoring case); changing only the case of one's own is fine. */
  async set(nickname: string | null): Promise<'ok' | 'taken'> {
    try {
      await this.db.prepare('INSERT OR IGNORE INTO profiles (user_id, updated_at) VALUES (?, ?)').bind(this.userId, this.now()).run();
      await this.db.prepare('UPDATE profiles SET nickname = ?, updated_at = ? WHERE user_id = ?').bind(nickname, this.now(), this.userId).run();
      return 'ok';
    } catch (e) {
      if (/unique|constraint/i.test(e instanceof Error ? e.message : String(e))) return 'taken';
      throw e;
    }
  }

  /** The active member with this nickname, or null. Counts as one lookup against this person's hourly limit; false when over it. */
  async find(nickname: string): Promise<{ id: string; email: string } | null | false> {
    const since = this.now() - HOUR_MS;
    await this.db.prepare('DELETE FROM nickname_lookups WHERE at <= ?').bind(since).run();
    const used = ((await this.db.prepare('SELECT COUNT(*) AS n FROM nickname_lookups WHERE user_id = ?').bind(this.userId).first<Row>())?.n as number) ?? 0;
    if (used >= LOOKUPS_PER_HOUR) return false;
    await this.db.prepare('INSERT INTO nickname_lookups (user_id, at) VALUES (?, ?)').bind(this.userId, this.now()).run();
    const r = await this.db
      .prepare("SELECT u.id, u.email FROM profiles p JOIN users u ON u.id = p.user_id WHERE lower(p.nickname) = lower(?) AND u.status = 'active'")
      .bind(nickname)
      .first<Row>();
    return r ? { id: r.id as string, email: r.email as string } : null;
  }
}
