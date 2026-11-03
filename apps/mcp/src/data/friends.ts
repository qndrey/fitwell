// Friends: connections between people and what each lets the other see. Nothing is shared by default.
// Every query is bound to the signed-in person's id. A request is addressed to the email the person typed and is stored without looking
// up whether that address has an account, so asking (and listing what was asked) cannot be used to find out who is a member; the person
// at that address sees it when they next ask. A name is shown only for someone who asked you or is already your friend.
import { checkNickname, NicknameData } from './nicknames';
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
  /** How the friend is shown: by nickname when they have one (then there is no email), else by email. */
  nickname: string | null;
  email: string | null;
  /** What this person lets the friend see, and what the friend lets this person see. */
  iShare: ShareCategory[];
  theyShare: ShareCategory[];
}

export interface RequestView {
  connectionId: string;
  /** Incoming: the one who asked, by nickname when they have one (then no email). Outgoing: the nickname asked, or the address typed. */
  nickname: string | null;
  email: string | null;
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

export type RequestOutcome =
  | { ok: true }
  | { ok: false; reason: 'self' | 'invalid_email' | 'too_many_pending' | 'too_many_friends' | 'invalid_nickname' | 'own_nickname_needed' | 'too_many_lookups' | 'unknown_nickname' };

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
    return this.send(email, false);
  }

  /**
   * Asks the member with this nickname to connect. A nickname is meant to be shared, so an unknown one is said to be unknown; to keep members
   * from being found by guessing, lookups are limited to a few an hour, and the person must have a nickname of their own (so the one asked
   * is shown a nickname, never this person's email). The one asked is never shown to this person by email.
   */
  async requestByNickname(rawNickname: string): Promise<RequestOutcome> {
    const nick = checkNickname(rawNickname);
    if (!nick.ok) return { ok: false, reason: 'invalid_nickname' };
    const nicknames = new NicknameData(this.db, this.userId, this.now);
    if ((await nicknames.get()) === null) return { ok: false, reason: 'own_nickname_needed' };
    const found = await nicknames.find(nick.value);
    if (found === false) return { ok: false, reason: 'too_many_lookups' };
    if (found === null) return { ok: false, reason: 'unknown_nickname' };
    if (found.id === this.userId) return { ok: false, reason: 'self' };
    return this.send(found.email, true);
  }

  private async send(email: string, viaNickname: boolean): Promise<RequestOutcome> {
    const mine = await this.myEmail();
    if (mine === email) return { ok: false, reason: 'self' };
    await this.prune();
    // The limits are about this person only, so they are checked before and without regard to who is asked.
    const pending = (await this.db.prepare("SELECT COUNT(*) AS n FROM connections WHERE requester_id = ? AND status = 'pending'").bind(this.userId).first<Row>())?.n as number;
    if (pending >= MAX_PENDING_SENT) return { ok: false, reason: 'too_many_pending' };
    if ((await this.countFriends()) >= MAX_FRIENDS) return { ok: false, reason: 'too_many_friends' };
    // Anything already between the two, whichever way it went and whatever its state: a friendship stays one row, and a repeat changes nothing.
    const { results: between } = await this.db
      .prepare('SELECT c.id, c.status, c.requester_id FROM connections c JOIN users r ON r.id = c.requester_id WHERE (c.requester_id = ?1 AND c.addressee_email = ?2) OR (c.addressee_email = ?3 AND r.email = ?2)')
      .bind(this.userId, email, mine)
      .all<Row>();
    if (between.some((c) => c.status === 'accepted')) return { ok: true };
    // They already asked this person: asking back accepts (what they asked is visible to this person already, in their incoming list).
    const theirs = between.find((c) => c.requester_id !== this.userId);
    if (theirs) {
      await this.accept(theirs.id as string);
      return { ok: true };
    }
    if (between.length > 0) return { ok: true }; // this person already asked
    await this.db
      .prepare("INSERT OR IGNORE INTO connections (id, requester_id, addressee_email, via_nickname, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)")
      .bind(crypto.randomUUID(), this.userId, email, viaNickname ? 1 : 0, this.now())
      .run();
    return { ok: true };
  }

  /** Every connection this person is part of (or has a request waiting for), with the nicknames needed to show the other side. */
  private async rows(): Promise<Row[]> {
    const mine = await this.myEmail();
    const { results } = await this.db
      .prepare(
        `SELECT c.id, c.requester_id, c.addressee_id, c.addressee_email, c.status, c.via_nickname, c.created_at, c.responded_at,
                r.email AS requester_email, rp.nickname AS requester_nick, ap.nickname AS addressee_nick
         FROM connections c JOIN users r ON r.id = c.requester_id LEFT JOIN profiles rp ON rp.user_id = r.id
              LEFT JOIN users a ON a.email = c.addressee_email LEFT JOIN profiles ap ON ap.user_id = a.id
         WHERE c.requester_id = ?1 OR c.addressee_id = ?1 OR c.addressee_email = ?2 ORDER BY c.created_at`,
      )
      .bind(this.userId, mine)
      .all<Row>();
    return results;
  }

  /** How the other side of a row is shown to this person: a nickname when they have one (and then never an email); an outgoing request by nickname is only a nickname. */
  private shown(r: Row): { nickname: string | null; email: string | null } {
    const sentByMe = r.requester_id === this.userId;
    if (r.status === 'pending' && sentByMe) return r.via_nickname === 1 ? { nickname: (r.addressee_nick as string | null) ?? null, email: null } : { nickname: null, email: r.addressee_email as string };
    const nickname = ((sentByMe ? r.addressee_nick : r.requester_nick) as string | null) ?? null;
    return { nickname, email: nickname ? null : ((sentByMe ? r.addressee_email : r.requester_email) as string) };
  }

  private async countFriends(): Promise<number> {
    return ((await this.db.prepare("SELECT COUNT(*) AS n FROM connections WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)").bind(this.userId, this.userId).first<Row>())?.n as number) ?? 0;
  }

  async list(): Promise<FriendList> {
    await this.prune();
    const results = await this.rows();
    const given = await this.shares('SELECT viewer_id AS other, category FROM shares WHERE owner_id = ?');
    const received = await this.shares('SELECT owner_id AS other, category FROM shares WHERE viewer_id = ?');
    const out: FriendList = { friends: [], incoming: [], outgoing: [] };
    for (const r of results) {
      const sentOn = day(r.created_at as number);
      const sentByMe = r.requester_id === this.userId;
      const view = { connectionId: r.id as string, ...this.shown(r) };
      if (r.status === 'accepted') {
        const other = (sentByMe ? r.addressee_id : r.requester_id) as string;
        out.friends.push({ ...view, iShare: given.get(other) ?? [], theyShare: received.get(other) ?? [] });
      } else if (sentByMe) out.outgoing.push({ ...view, sentOn });
      else out.incoming.push({ ...view, sentOn });
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
    const requester = ask.requester_id as string;
    const friends = await this.db
      .prepare("SELECT 1 AS ok FROM connections WHERE status = 'accepted' AND ((requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1))")
      .bind(this.userId, requester)
      .first<Row>();
    if (friends) {
      // Already friends (a second request crossed the first): the extra request goes, and what is shared is left exactly as it is.
      await this.db.prepare("DELETE FROM connections WHERE id = ? AND status = 'pending'").bind(connectionId).run();
      return true;
    }
    // Nothing can be shared before a friendship starts, so anything found for the pair is a leftover: it goes, and each is recorded as withdrawn.
    const at = this.now();
    const { results: leftovers } = await this.db.prepare('SELECT owner_id, viewer_id, category FROM shares WHERE (owner_id = ?1 AND viewer_id = ?2) OR (owner_id = ?2 AND viewer_id = ?1)').bind(this.userId, requester).all<Row>();
    try {
      const done = await this.db.batch([
        ...leftovers.map((s) => this.db.prepare("INSERT INTO share_consents (owner_id, viewer_id, category, action, at) VALUES (?, ?, ?, 'withdrawn', ?)").bind(s.owner_id, s.viewer_id, s.category, at)),
        this.db.prepare('DELETE FROM shares WHERE (owner_id = ?1 AND viewer_id = ?2) OR (owner_id = ?2 AND viewer_id = ?1)').bind(this.userId, requester),
        this.db.prepare("UPDATE connections SET status = 'accepted', addressee_id = ?, responded_at = ? WHERE id = ? AND status = 'pending' AND addressee_email = ?").bind(this.userId, at, connectionId, mine),
      ]);
      return done.at(-1)!.meta.changes > 0;
    } catch {
      return false; // the database allows one accepted connection per pair: a racing accept lost
    }
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
    const mine = await this.myEmail();
    const otherEmail = ((await this.db.prepare('SELECT email FROM users WHERE id = ?').bind(other).first<Row>())?.email as string | undefined) ?? '';
    const at = this.now();
    const { results } = await this.db
      .prepare('SELECT owner_id, viewer_id, category FROM shares WHERE (owner_id = ?1 AND viewer_id = ?2) OR (owner_id = ?2 AND viewer_id = ?1)')
      .bind(this.userId, other)
      .all<Row>();
    await this.db.batch([
      ...results.map((s) => this.db.prepare("INSERT INTO share_consents (owner_id, viewer_id, category, action, at) VALUES (?, ?, ?, 'withdrawn', ?)").bind(s.owner_id, s.viewer_id, s.category, at)),
      this.db.prepare('DELETE FROM shares WHERE (owner_id = ?1 AND viewer_id = ?2) OR (owner_id = ?2 AND viewer_id = ?1)').bind(this.userId, other),
      // Every row between the two, whatever its state or direction, so nothing is left that could bring the friendship back.
      this.db.prepare('DELETE FROM connections WHERE id = ?1 OR (requester_id = ?2 AND addressee_id = ?3) OR (requester_id = ?3 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_email = ?4) OR (requester_id = ?3 AND addressee_email = ?5)').bind(connectionId, this.userId, other, otherEmail, mine),
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
    const label = (nickname: unknown, email: unknown) => (nickname as string | null) ?? (email as string | null) ?? 'unknown';
    const [rows, shares, consents] = await Promise.all([
      this.rows(),
      this.db.prepare('SELECT s.owner_id = ?1 AS mine, u.email, p.nickname, s.category, s.granted_at FROM shares s JOIN users u ON u.id = CASE WHEN s.owner_id = ?1 THEN s.viewer_id ELSE s.owner_id END LEFT JOIN profiles p ON p.user_id = u.id WHERE s.owner_id = ?1 OR s.viewer_id = ?1 ORDER BY s.granted_at').bind(this.userId).all<Row>(),
      this.db.prepare('SELECT u.email, p.nickname, k.category, k.action, k.at FROM share_consents k JOIN users u ON u.id = k.viewer_id LEFT JOIN profiles p ON p.user_id = u.id WHERE k.owner_id = ? ORDER BY k.id').bind(this.userId).all<Row>(),
    ]);
    // People are named as they are shown in list_friends: by nickname when they have one, so the export never gives an email the person only knew by nickname.
    return {
      friends: {
        connections: rows.map((r) => {
          const w = this.shown(r);
          return { with: label(w.nickname, w.email), status: r.status, sentByMe: r.requester_id === this.userId, createdAt: r.created_at, respondedAt: r.responded_at ?? null };
        }),
        sharing: shares.results.map((r) => ({ with: label(r.nickname, r.email), direction: r.mine === 1 ? 'iShare' : 'theyShare', category: r.category, since: r.granted_at })),
        consents: consents.results.map((r) => ({ with: label(r.nickname, r.email), category: r.category, action: r.action, at: r.at })),
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
