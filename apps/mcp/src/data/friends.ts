// Friends: connections between people and what each lets the other see. Nothing is shared by default.
// Every query is bound to the signed-in person's id. A person is only ever named to a friend by the email they were connected by, and a
// request by email answers the same whether or not the address has an account, so it cannot be used to find out who is a member.
import { normalizeEmail } from './users';

export const SHARE_CATEGORIES = ['workouts', 'consistency', 'templates', 'body'] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

export const MAX_FRIENDS = 50;
export const MAX_PENDING_SENT = 10;

type Row = Record<string, unknown>;

export interface FriendView {
  /** The connection's id: what the other tools take. */
  connectionId: string;
  email: string;
  name: string | null;
  /** What this person lets the friend see, and what the friend lets this person see. */
  iShare: ShareCategory[];
  theyShare: ShareCategory[];
}

export interface RequestView {
  connectionId: string;
  email: string;
  name: string | null;
  /** The day it was sent. */
  sentOn: string;
}

export interface FriendList {
  friends: FriendView[];
  /** Requests waiting for this person's answer. */
  incoming: RequestView[];
  /** Requests this person sent that nobody has answered. */
  outgoing: RequestView[];
}

export type RequestOutcome = { ok: true } | { ok: false; reason: 'self' | 'invalid_email' | 'too_many_pending' | 'too_many_friends' };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class FriendsData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Asks a person to connect, by the email they use. Nothing says whether the address has an account: a request is made only to an
   * active member, and when that member already asked this person, the two are connected instead.
   */
  async request(rawEmail: string): Promise<RequestOutcome> {
    const email = normalizeEmail(rawEmail);
    if (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return { ok: false, reason: 'invalid_email' };
    const me = await this.db.prepare('SELECT email FROM users WHERE id = ?').bind(this.userId).first<Row>();
    if (me?.email === email) return { ok: false, reason: 'self' };
    const target = await this.db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").bind(email).first<Row>();
    const pending = (await this.db.prepare("SELECT COUNT(*) AS n FROM connections WHERE requester_id = ? AND status = 'pending'").bind(this.userId).first<Row>())?.n as number;
    if (pending >= MAX_PENDING_SENT) return { ok: false, reason: 'too_many_pending' };
    if (!target) return { ok: true }; // the same answer as for a member: the address is not confirmed or denied
    const theirId = target.id as string;
    const existing = await this.db
      .prepare('SELECT id, requester_id, status FROM connections WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
      .bind(this.userId, theirId, theirId, this.userId)
      .first<Row>();
    if (existing) {
      // They had already asked this person: asking back is an answer.
      if (existing.status === 'pending' && existing.requester_id === theirId) await this.accept(existing.id as string);
      return { ok: true };
    }
    if ((await this.countFriends()) >= MAX_FRIENDS) return { ok: false, reason: 'too_many_friends' };
    await this.db.prepare("INSERT INTO connections (id, requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)").bind(crypto.randomUUID(), this.userId, theirId, this.now()).run();
    return { ok: true };
  }

  private async countFriends(): Promise<number> {
    return ((await this.db.prepare("SELECT COUNT(*) AS n FROM connections WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)").bind(this.userId, this.userId).first<Row>())?.n as number) ?? 0;
  }

  async list(): Promise<FriendList> {
    const { results } = await this.db
      .prepare(
        `SELECT c.id, c.requester_id, c.addressee_id, c.status, c.created_at, u.email, u.name
         FROM connections c JOIN users u ON u.id = CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END
         WHERE c.requester_id = ?1 OR c.addressee_id = ?1 ORDER BY c.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    const given = await this.shares('SELECT viewer_id AS other, category FROM shares WHERE owner_id = ?');
    const received = await this.shares('SELECT owner_id AS other, category FROM shares WHERE viewer_id = ?');
    const out: FriendList = { friends: [], incoming: [], outgoing: [] };
    for (const r of results) {
      const base = { connectionId: r.id as string, email: r.email as string, name: (r.name as string | null) ?? null };
      if (r.status === 'accepted') {
        const other = (r.requester_id === this.userId ? r.addressee_id : r.requester_id) as string;
        out.friends.push({ ...base, iShare: given.get(other) ?? [], theyShare: received.get(other) ?? [] });
      } else if (r.requester_id === this.userId) out.outgoing.push({ ...base, sentOn: day(r.created_at as number) });
      else out.incoming.push({ ...base, sentOn: day(r.created_at as number) });
    }
    return out;
  }

  private async shares(sql: string): Promise<Map<string, ShareCategory[]>> {
    const { results } = await this.db.prepare(sql).bind(this.userId).all<Row>();
    const map = new Map<string, ShareCategory[]>();
    for (const r of results) map.set(r.other as string, [...(map.get(r.other as string) ?? []), r.category as ShareCategory]);
    for (const [k, v] of map) map.set(k, SHARE_CATEGORIES.filter((c) => v.includes(c)));
    return map;
  }

  /** The person on the other side of one of this person's connections, or null when the connection is not theirs. */
  private async otherOf(connectionId: string): Promise<string | null> {
    const r = await this.db.prepare('SELECT requester_id, addressee_id FROM connections WHERE id = ? AND (requester_id = ? OR addressee_id = ?)').bind(connectionId, this.userId, this.userId).first<Row>();
    if (!r) return null;
    return (r.requester_id === this.userId ? r.addressee_id : r.requester_id) as string;
  }

  /** Accepts a request addressed to this person. False when there is no such pending request for them. */
  async accept(connectionId: string): Promise<boolean> {
    if ((await this.countFriends()) >= MAX_FRIENDS) return false;
    const r = await this.db.prepare("UPDATE connections SET status = 'accepted', responded_at = ? WHERE id = ? AND addressee_id = ? AND status = 'pending'").bind(this.now(), connectionId, this.userId).run();
    return r.meta.changes > 0;
  }

  /** Declines a request addressed to this person, or takes back one this person sent. False when there is no such pending request. */
  async decline(connectionId: string): Promise<boolean> {
    const r = await this.db.prepare("DELETE FROM connections WHERE id = ? AND status = 'pending' AND (addressee_id = ? OR requester_id = ?)").bind(connectionId, this.userId, this.userId).run();
    return r.meta.changes > 0;
  }

  /** Ends an accepted connection for both people: what either shared with the other stops being shared, and each withdrawal is recorded. */
  async remove(connectionId: string): Promise<boolean> {
    const other = await this.otherOf(connectionId);
    if (!other) return false;
    const at = this.now();
    const { results } = await this.db
      .prepare('SELECT owner_id, viewer_id, category FROM shares WHERE (owner_id = ?1 AND viewer_id = ?2) OR (owner_id = ?2 AND viewer_id = ?1)')
      .bind(this.userId, other)
      .all<Row>();
    await this.db.batch([
      ...results.map((s) => this.db.prepare("INSERT INTO share_consents (owner_id, viewer_id, category, action, at) VALUES (?, ?, ?, 'withdrawn', ?)").bind(s.owner_id, s.viewer_id, s.category, at)),
      this.db.prepare('DELETE FROM shares WHERE (owner_id = ?1 AND viewer_id = ?2) OR (owner_id = ?2 AND viewer_id = ?1)').bind(this.userId, other),
      this.db.prepare('DELETE FROM connections WHERE id = ?').bind(connectionId),
    ]);
    return true;
  }

  /** Lets a friend see a category of this person's data, or stops. Only for an accepted connection; false otherwise. */
  async setSharing(connectionId: string, category: ShareCategory, share: boolean): Promise<boolean> {
    const c = await this.db.prepare("SELECT requester_id, addressee_id FROM connections WHERE id = ? AND status = 'accepted' AND (requester_id = ? OR addressee_id = ?)").bind(connectionId, this.userId, this.userId).first<Row>();
    if (!c) return false;
    const viewer = (c.requester_id === this.userId ? c.addressee_id : c.requester_id) as string;
    const at = this.now();
    if (share) {
      const r = await this.db.prepare('INSERT OR IGNORE INTO shares (owner_id, viewer_id, category, granted_at) VALUES (?, ?, ?, ?)').bind(this.userId, viewer, category, at).run();
      if (r.meta.changes > 0) await this.db.prepare("INSERT INTO share_consents (owner_id, viewer_id, category, action, at) VALUES (?, ?, ?, 'granted', ?)").bind(this.userId, viewer, category, at).run();
    } else {
      const r = await this.db.prepare('DELETE FROM shares WHERE owner_id = ? AND viewer_id = ? AND category = ?').bind(this.userId, viewer, category).run();
      if (r.meta.changes > 0) await this.db.prepare("INSERT INTO share_consents (owner_id, viewer_id, category, action, at) VALUES (?, ?, ?, 'withdrawn', ?)").bind(this.userId, viewer, category, at).run();
    }
    return true;
  }

  /** The one question every feature that shows a friend's data asks first: may this person see that category of `ownerId`'s data? */
  canView(ownerId: string, category: ShareCategory): Promise<boolean> {
    return canView(this.db, this.userId, ownerId, category);
  }

  /** What the person agreed to and withdrew, for their own copy. */
  async exportAll() {
    const [connections, shares, consents] = await Promise.all([
      this.db
        .prepare('SELECT c.status, c.created_at, c.responded_at, c.requester_id = ?1 AS sent, u.email FROM connections c JOIN users u ON u.id = CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END WHERE c.requester_id = ?1 OR c.addressee_id = ?1 ORDER BY c.created_at')
        .bind(this.userId)
        .all<Row>(),
      this.db.prepare('SELECT s.owner_id = ?1 AS mine, u.email, s.category, s.granted_at FROM shares s JOIN users u ON u.id = CASE WHEN s.owner_id = ?1 THEN s.viewer_id ELSE s.owner_id END WHERE s.owner_id = ?1 OR s.viewer_id = ?1 ORDER BY s.granted_at').bind(this.userId).all<Row>(),
      this.db.prepare('SELECT u.email, k.category, k.action, k.at FROM share_consents k JOIN users u ON u.id = k.viewer_id WHERE k.owner_id = ? ORDER BY k.id').bind(this.userId).all<Row>(),
    ]);
    return {
      friends: {
        connections: connections.results.map((r) => ({ with: r.email, status: r.status, sentByMe: r.sent === 1, createdAt: r.created_at, respondedAt: r.responded_at ?? null })),
        sharing: shares.results.map((r) => ({ with: r.email, direction: r.mine === 1 ? 'iShare' : 'theyShare', category: r.category, since: r.granted_at })),
        consents: consents.results.map((r) => ({ with: r.email, category: r.category, action: r.action, at: r.at })),
      },
    };
  }
}

/** True only when the two are connected (accepted) and the owner has shared that category with the viewer. Anything else, and yourself, is false here. */
export async function canView(db: D1Database, viewerId: string, ownerId: string, category: ShareCategory): Promise<boolean> {
  if (viewerId === ownerId) return false; // a person's own data is read through their own tools, never through a share
  const r = await db
    .prepare(
      `SELECT 1 AS ok FROM shares s JOIN connections c ON c.status = 'accepted'
         AND ((c.requester_id = s.owner_id AND c.addressee_id = s.viewer_id) OR (c.requester_id = s.viewer_id AND c.addressee_id = s.owner_id))
       WHERE s.owner_id = ? AND s.viewer_id = ? AND s.category = ?`,
    )
    .bind(ownerId, viewerId, category)
    .first<Row>();
  return r !== null;
}
