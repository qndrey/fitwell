// Friends: connections between people and what each lets the other see. Nothing is shared by default.
// Every query is bound to the signed-in person's id. A request is addressed to the email the person typed and is stored without looking
// up whether that address has an account, so asking (and listing what was asked) cannot be used to find out who is a member; the person
// at that address sees it when they next ask. A name is shown only for someone who asked you or is already your friend.
import { normalizeEmail } from './users';

export const SHARE_CATEGORIES = ['workouts', 'consistency', 'templates', 'body'] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

export const MAX_FRIENDS = 50;
export const MAX_PENDING_SENT = 10;
/** A request nobody answered is deleted after this long (there is no scheduled job: callers prune as they go). */
export const REQUEST_TTL_MS = 30 * 86_400_000;

type Row = Record<string, unknown>;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

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
  /** Only for a request someone sent this person; never for one this person sent. */
  name: string | null;
  /** The day it was sent. */
  sentOn: string;
}

export interface FriendList {
  friends: FriendView[];
  /** Requests waiting for this person's answer. */
  incoming: RequestView[];
  /** Requests this person sent that nobody has answered: only the address typed, the same for every address. */
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

  private async myEmail(): Promise<string> {
    return ((await this.db.prepare('SELECT email FROM users WHERE id = ?').bind(this.userId).first<Row>())?.email as string | undefined) ?? '';
  }

  private async prune(): Promise<void> {
    await this.db.prepare("DELETE FROM connections WHERE status = 'pending' AND created_at <= ?").bind(this.now() - REQUEST_TTL_MS).run();
  }

  /**
   * Asks the person at an email address to connect. Nothing here depends on whether the address has an account: the request is stored the
   * same way and the answer is the same. When that person already asked this one, asking back is an answer and the two are connected.
   */
  async request(rawEmail: string): Promise<RequestOutcome> {
    const email = normalizeEmail(rawEmail);
    if (email.length > 254 || !EMAIL.test(email)) return { ok: false, reason: 'invalid_email' };
    const mine = await this.myEmail();
    if (mine === email) return { ok: false, reason: 'self' };
    await this.prune();
    // The limits are about this person only, so they are checked before and without regard to who is asked.
    const pending = (await this.db.prepare("SELECT COUNT(*) AS n FROM connections WHERE requester_id = ? AND status = 'pending'").bind(this.userId).first<Row>())?.n as number;
    if (pending >= MAX_PENDING_SENT) return { ok: false, reason: 'too_many_pending' };
    if ((await this.countFriends()) >= MAX_FRIENDS) return { ok: false, reason: 'too_many_friends' };
    // They already asked this person: asking back accepts (what they asked is visible to this person already, in their incoming list).
    const theirs = await this.db
      .prepare("SELECT c.id FROM connections c JOIN users u ON u.id = c.requester_id WHERE c.status = 'pending' AND c.addressee_email = ? AND u.email = ?")
      .bind(mine, email)
      .first<Row>();
    if (theirs) {
      await this.accept(theirs.id as string);
      return { ok: true };
    }
    await this.db.prepare("INSERT OR IGNORE INTO connections (id, requester_id, addressee_email, status, created_at) VALUES (?, ?, ?, 'pending', ?)").bind(crypto.randomUUID(), this.userId, email, this.now()).run();
    return { ok: true };
  }

  private async countFriends(): Promise<number> {
    return ((await this.db.prepare("SELECT COUNT(*) AS n FROM connections WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)").bind(this.userId, this.userId).first<Row>())?.n as number) ?? 0;
  }

  async list(): Promise<FriendList> {
    await this.prune();
    const mine = await this.myEmail();
    const { results } = await this.db
      .prepare(
        `SELECT c.id, c.requester_id, c.addressee_id, c.addressee_email, c.status, c.created_at, r.email AS requester_email, r.name AS requester_name, a.email AS addressee_account_email, a.name AS addressee_name
         FROM connections c JOIN users r ON r.id = c.requester_id LEFT JOIN users a ON a.id = c.addressee_id
         WHERE c.requester_id = ?1 OR c.addressee_id = ?1 OR c.addressee_email = ?2 ORDER BY c.created_at`,
      )
      .bind(this.userId, mine)
      .all<Row>();
    const given = await this.shares('SELECT viewer_id AS other, category FROM shares WHERE owner_id = ?');
    const received = await this.shares('SELECT owner_id AS other, category FROM shares WHERE viewer_id = ?');
    const out: FriendList = { friends: [], incoming: [], outgoing: [] };
    for (const r of results) {
      const sentOn = day(r.created_at as number);
      const sentByMe = r.requester_id === this.userId;
      if (r.status === 'accepted') {
        const other = (sentByMe ? r.addressee_id : r.requester_id) as string;
        out.friends.push({
          connectionId: r.id as string,
          email: (sentByMe ? r.addressee_account_email : r.requester_email) as string,
          name: ((sentByMe ? r.addressee_name : r.requester_name) as string | null) ?? null,
          iShare: given.get(other) ?? [],
          theyShare: received.get(other) ?? [],
        });
      } else if (sentByMe) out.outgoing.push({ connectionId: r.id as string, email: r.addressee_email as string, name: null, sentOn });
      else out.incoming.push({ connectionId: r.id as string, email: r.requester_email as string, name: (r.requester_name as string | null) ?? null, sentOn });
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

  /** The person on the other side of one of this person's accepted connections, or null when it is not theirs. */
  private async otherOf(connectionId: string): Promise<string | null> {
    const r = await this.db.prepare("SELECT requester_id, addressee_id FROM connections WHERE id = ? AND status = 'accepted' AND (requester_id = ? OR addressee_id = ?)").bind(connectionId, this.userId, this.userId).first<Row>();
    if (!r) return null;
    return (r.requester_id === this.userId ? r.addressee_id : r.requester_id) as string;
  }

  /** Accepts a request addressed to this person's email. False when there is no such pending request for them. */
  async accept(connectionId: string): Promise<boolean> {
    if ((await this.countFriends()) >= MAX_FRIENDS) return false;
    const mine = await this.myEmail();
    const ask = await this.db.prepare("SELECT requester_id FROM connections WHERE id = ? AND status = 'pending' AND addressee_email = ?").bind(connectionId, mine).first<Row>();
    if (!ask) return false;
    // Nothing can be shared before a connection is accepted; clearing the pair first makes sure a friendship never starts with leftovers.
    const requester = ask.requester_id as string;
    const [, accepted] = await this.db.batch([
      this.db.prepare('DELETE FROM shares WHERE (owner_id = ?1 AND viewer_id = ?2) OR (owner_id = ?2 AND viewer_id = ?1)').bind(this.userId, requester),
      this.db.prepare("UPDATE connections SET status = 'accepted', addressee_id = ?, responded_at = ? WHERE id = ? AND status = 'pending' AND addressee_email = ?").bind(this.userId, this.now(), connectionId, mine),
    ]);
    return accepted!.meta.changes > 0;
  }

  /** Declines a request addressed to this person, or takes back one this person sent. False when there is no such pending request. */
  async decline(connectionId: string): Promise<boolean> {
    const mine = await this.myEmail();
    const r = await this.db.prepare("DELETE FROM connections WHERE id = ? AND status = 'pending' AND (addressee_email = ? OR requester_id = ?)").bind(connectionId, mine, this.userId).run();
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
    const other = await this.otherOf(connectionId);
    if (!other) return false;
    const at = this.now();
    if (share) {
      // One statement checks the connection and writes the share, so it cannot be written for a connection that has just ended.
      const r = await this.db
        .prepare(
          `INSERT OR IGNORE INTO shares (owner_id, viewer_id, category, granted_at)
           SELECT ?1, CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END, ?3, ?4 FROM connections
           WHERE id = ?2 AND status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1)`,
        )
        .bind(this.userId, connectionId, category, at)
        .run();
      if (r.meta.changes > 0) await this.db.prepare("INSERT INTO share_consents (owner_id, viewer_id, category, action, at) VALUES (?, ?, ?, 'granted', ?)").bind(this.userId, other, category, at).run();
    } else {
      const r = await this.db.prepare('DELETE FROM shares WHERE owner_id = ? AND viewer_id = ? AND category = ?').bind(this.userId, other, category).run();
      if (r.meta.changes > 0) await this.db.prepare("INSERT INTO share_consents (owner_id, viewer_id, category, action, at) VALUES (?, ?, ?, 'withdrawn', ?)").bind(this.userId, other, category, at).run();
    }
    return true;
  }

  /** The one question every feature that shows a friend's data asks first: may this person see that category of `ownerId`'s data? */
  canView(ownerId: string, category: ShareCategory): Promise<boolean> {
    return canView(this.db, this.userId, ownerId, category);
  }

  /** What the person agreed to and withdrew, for their own copy. */
  async exportAll() {
    const mine = await this.myEmail();
    const [connections, shares, consents] = await Promise.all([
      this.db
        .prepare(
          `SELECT c.status, c.created_at, c.responded_at, c.requester_id = ?1 AS sent, CASE WHEN c.requester_id = ?1 THEN c.addressee_email ELSE r.email END AS other
           FROM connections c JOIN users r ON r.id = c.requester_id WHERE c.requester_id = ?1 OR c.addressee_id = ?1 OR c.addressee_email = ?2 ORDER BY c.created_at`,
        )
        .bind(this.userId, mine)
        .all<Row>(),
      this.db.prepare('SELECT s.owner_id = ?1 AS mine, u.email, s.category, s.granted_at FROM shares s JOIN users u ON u.id = CASE WHEN s.owner_id = ?1 THEN s.viewer_id ELSE s.owner_id END WHERE s.owner_id = ?1 OR s.viewer_id = ?1 ORDER BY s.granted_at').bind(this.userId).all<Row>(),
      this.db.prepare('SELECT u.email, k.category, k.action, k.at FROM share_consents k JOIN users u ON u.id = k.viewer_id WHERE k.owner_id = ? ORDER BY k.id').bind(this.userId).all<Row>(),
    ]);
    return {
      friends: {
        connections: connections.results.map((r) => ({ with: r.other, status: r.status, sentByMe: r.sent === 1, createdAt: r.created_at, respondedAt: r.responded_at ?? null })),
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
