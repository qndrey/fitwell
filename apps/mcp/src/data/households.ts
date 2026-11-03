// Households (B2): people who cook together share one meal plan and one set of grocery ticks, with a portion each. Members are friends. A person's goals, allergies, dislikes, food log
// and what they ate are never read through a household: only the plan, the portions, who is in it and the ticks are shared. What one member writes that another reads (dish names)
// is cleaned like anything else from another person.
import type { PlannedItem } from '../planning/check';
import { scaleItem } from '../planning/scalePlan';
import { cleanText } from './transfers';

export const MAX_MEMBERS = 6;
export const MAX_PENDING_INVITES = 10;
export const MIN_PORTION = 0.25;
export const MAX_PORTION = 3;

type Row = Record<string, unknown>;
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const label = (nickname: unknown, email: unknown) => (nickname as string | null) ?? (email as string | null) ?? 'unknown';

export interface HouseholdMember {
  /** How the member is shown, as friends are: a nickname when they have one (then no email), else the email. */
  nickname: string | null;
  email: string | null;
  portion: number;
  you: boolean;
}

export interface HouseholdInfo {
  id: string;
  members: HouseholdMember[];
  /** Weeks that have a shared plan, newest first. */
  weeks: { weekStart: string; items: number; savedBy: string | null; updatedOn: string }[];
}

export interface HouseholdInvite {
  inviteId: string;
  from: { nickname: string | null; email: string | null };
  sentOn: string;
}

export type InviteOutcome = { ok: true } | { ok: false; reason: 'not_friends' | 'already_member' | 'full' | 'too_many_pending' | 'already_invited' };
export type JoinOutcome = { ok: true } | { ok: false; reason: 'not_found' | 'already_in_one' | 'full' };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** What another member reads of a planned item: names cleaned, and what points to the saver's own things (recipes, their packaged or own foods) dropped. */
export function sharedItem(i: PlannedItem): PlannedItem {
  const { recipeId: _r, loggedAt: _l, ...rest } = i;
  void _r;
  void _l;
  const food = typeof rest.foodId === 'string' && rest.foodId.startsWith('frida:') ? { foodId: rest.foodId } : {};
  const { foodId: _f, ...withoutFood } = rest;
  void _f;
  return { ...withoutFood, ...food, name: cleanText(i.name, 100) || 'Meal', ingredients: i.ingredients.map(({ foodId, ...g }) => ({ ...g, ...(typeof foodId === 'string' && foodId.startsWith('frida:') ? { foodId } : {}), name: cleanText(g.name, 100) || 'Ingredient' })) };
}

export class HouseholdData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** The household this person is in: its id and their own portion. */
  async mine(): Promise<{ id: string; portion: number } | null> {
    const r = await this.db.prepare('SELECT household_id, portion FROM household_members WHERE user_id = ?').bind(this.userId).first<Row>();
    return r ? { id: r.household_id as string, portion: r.portion as number } : null;
  }

  /** The household, its members (portions, shown like friends) and the weeks that have a shared plan. */
  async info(): Promise<HouseholdInfo | null> {
    const me = await this.mine();
    if (!me) return null;
    const members = await this.db
      .prepare('SELECT m.user_id, m.portion, u.email, p.nickname FROM household_members m JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = m.user_id WHERE m.household_id = ? ORDER BY m.joined_at, m.user_id')
      .bind(me.id)
      .all<Row>();
    const weeks = await this.db
      .prepare('SELECT hp.week_start, hp.items, hp.updated_at, u.email, p.nickname FROM household_plans hp LEFT JOIN users u ON u.id = hp.saved_by LEFT JOIN profiles p ON p.user_id = hp.saved_by WHERE hp.household_id = ? ORDER BY hp.week_start DESC LIMIT 12')
      .bind(me.id)
      .all<Row>();
    return {
      id: me.id,
      members: members.results.map((r) => ({ nickname: (r.nickname as string | null) ?? null, email: r.nickname ? null : (r.email as string), portion: r.portion as number, you: r.user_id === this.userId })),
      weeks: weeks.results.map((r) => ({ weekStart: r.week_start as string, items: parse<unknown[]>(r.items, []).length, savedBy: r.email || r.nickname ? label(r.nickname, r.email) : null, updatedOn: day(r.updated_at as number) })),
    };
  }

  /** Invites a friend (by the connection's id), creating the household when this person has none. */
  async invite(connectionId: string): Promise<InviteOutcome> {
    const friend = await this.db
      .prepare(
        `SELECT CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END AS id FROM connections c
         WHERE c.id = ?2 AND c.status = 'accepted' AND (c.requester_id = ?1 OR c.addressee_id = ?1)`,
      )
      .bind(this.userId, connectionId)
      .first<Row>();
    if (!friend) return { ok: false, reason: 'not_friends' };
    const friendId = friend.id as string;
    if ((await this.db.prepare('SELECT 1 AS x FROM household_members WHERE user_id = ?').bind(friendId).first<Row>()) !== null) return { ok: false, reason: 'already_member' };
    const pending = ((await this.db.prepare('SELECT COUNT(*) AS n FROM household_invites WHERE inviter_id = ?').bind(this.userId).first<Row>())?.n as number) ?? 0;
    if (pending >= MAX_PENDING_INVITES) return { ok: false, reason: 'too_many_pending' };
    let me = await this.mine();
    if (!me) {
      const id = crypto.randomUUID();
      const at = this.now();
      await this.db.batch([
        this.db.prepare('INSERT INTO households (id, created_at) VALUES (?, ?)').bind(id, at),
        this.db.prepare('INSERT INTO household_members (household_id, user_id, portion, joined_at) VALUES (?, ?, 1, ?)').bind(id, this.userId, at),
      ]);
      me = { id, portion: 1 };
    }
    const size = ((await this.db.prepare('SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?').bind(me.id).first<Row>())?.n as number) ?? 0;
    const open = ((await this.db.prepare('SELECT COUNT(*) AS n FROM household_invites WHERE household_id = ?').bind(me.id).first<Row>())?.n as number) ?? 0;
    if (size + open >= MAX_MEMBERS) return { ok: false, reason: 'full' };
    const r = await this.db.prepare('INSERT OR IGNORE INTO household_invites (id, household_id, inviter_id, invitee_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), me.id, this.userId, friendId, this.now()).run();
    return r.meta.changes > 0 ? { ok: true } : { ok: false, reason: 'already_invited' };
  }

  /** Invitations waiting for this person's answer, from people who are still their friends. */
  async incoming(): Promise<HouseholdInvite[]> {
    const { results } = await this.db
      .prepare(
        `SELECT i.id, i.created_at, u.email, p.nickname FROM household_invites i JOIN users u ON u.id = i.inviter_id LEFT JOIN profiles p ON p.user_id = i.inviter_id
         WHERE i.invitee_id = ?1 AND EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted' AND ((c.requester_id = ?1 AND c.addressee_id = i.inviter_id) OR (c.requester_id = i.inviter_id AND c.addressee_id = ?1)))
         ORDER BY i.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    return results.map((r) => ({ inviteId: r.id as string, from: { nickname: (r.nickname as string | null) ?? null, email: r.nickname ? null : (r.email as string) }, sentOn: day(r.created_at as number) }));
  }

  /** Joins the household of an invitation. The invitation goes, and so do this person's other invitations (they are in one household now). */
  async accept(inviteId: string): Promise<JoinOutcome> {
    const inv = (await this.incoming()).find((i) => i.inviteId === inviteId);
    const row = inv ? await this.db.prepare('SELECT household_id FROM household_invites WHERE id = ? AND invitee_id = ?').bind(inviteId, this.userId).first<Row>() : null;
    if (!row) return { ok: false, reason: 'not_found' };
    if (await this.mine()) return { ok: false, reason: 'already_in_one' };
    const id = row.household_id as string;
    const size = ((await this.db.prepare('SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?').bind(id).first<Row>())?.n as number) ?? 0;
    if (size >= MAX_MEMBERS) return { ok: false, reason: 'full' };
    await this.db.batch([
      this.db.prepare('INSERT INTO household_members (household_id, user_id, portion, joined_at) VALUES (?, ?, 1, ?)').bind(id, this.userId, this.now()),
      this.db.prepare('DELETE FROM household_invites WHERE invitee_id = ?').bind(this.userId),
    ]);
    return { ok: true };
  }

  async decline(inviteId: string): Promise<boolean> {
    return (await this.db.prepare('DELETE FROM household_invites WHERE id = ? AND invitee_id = ?').bind(inviteId, this.userId).run()).meta.changes > 0;
  }

  /** Leaves the household. The last one out takes it with them (its plans, ticks and invitations). The person's own copies of its plans stay theirs, no longer following it. */
  async leave(): Promise<boolean> {
    const me = await this.mine();
    if (!me) return false;
    const left = ((await this.db.prepare('SELECT COUNT(*) AS n FROM household_members WHERE household_id = ? AND user_id != ?').bind(me.id, this.userId).first<Row>())?.n as number) ?? 0;
    await this.db.batch([
      this.db.prepare('UPDATE meal_plans SET household_id = NULL, household_synced_at = NULL, household_portion = NULL WHERE user_id = ?').bind(this.userId),
      this.db.prepare('DELETE FROM household_members WHERE user_id = ?').bind(this.userId),
      ...(left === 0 ? [this.db.prepare('DELETE FROM households WHERE id = ?').bind(me.id)] : []),
    ]);
    return true;
  }

  async setPortion(portion: number): Promise<boolean> {
    return (await this.db.prepare('UPDATE household_members SET portion = ? WHERE user_id = ?').bind(Math.min(MAX_PORTION, Math.max(MIN_PORTION, portion)), this.userId).run()).meta.changes > 0;
  }

  /** The shared plan of a week (items for one standard portion), or null. Only for a member. */
  async plan(weekStart: string): Promise<{ items: PlannedItem[]; updatedAt: number } | null> {
    const me = await this.mine();
    if (!me) return null;
    const r = await this.db.prepare('SELECT items, updated_at FROM household_plans WHERE household_id = ? AND week_start = ?').bind(me.id, weekStart).first<Row>();
    return r ? { items: parse<PlannedItem[]>(r.items, []).map(sharedItem), updatedAt: r.updated_at as number } : null;
  }

  /** Saves the shared plan of a week for the household (items for one standard portion, cleaned for the others who read them). A save always moves the version on. */
  async savePlan(weekStart: string, items: PlannedItem[]): Promise<boolean> {
    const me = await this.mine();
    if (!me) return false;
    const at = this.now();
    await this.db
      .prepare(
        `INSERT INTO household_plans (household_id, week_start, items, saved_by, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (household_id, week_start) DO UPDATE SET items = excluded.items, saved_by = excluded.saved_by, updated_at = MAX(excluded.updated_at, household_plans.updated_at + 1)`,
      )
      .bind(me.id, weekStart, JSON.stringify(items.map(sharedItem)), this.userId, at)
      .run();
    return true;
  }

  async ticks(weekStart: string): Promise<Set<string>> {
    const me = await this.mine();
    if (!me) return new Set();
    const { results } = await this.db.prepare('SELECT item_key FROM household_ticks WHERE household_id = ? AND week_start = ?').bind(me.id, weekStart).all<Row>();
    return new Set(results.map((r) => r.item_key as string));
  }

  async setTick(weekStart: string, key: string, checked: boolean): Promise<void> {
    const me = await this.mine();
    if (!me) return;
    if (checked) await this.db.prepare('INSERT OR IGNORE INTO household_ticks (household_id, week_start, item_key, checked_at) VALUES (?, ?, ?, ?)').bind(me.id, weekStart, key, this.now()).run();
    else await this.db.prepare('DELETE FROM household_ticks WHERE household_id = ? AND week_start = ? AND item_key = ?').bind(me.id, weekStart, key).run();
  }

  async clearTicks(weekStart: string): Promise<void> {
    const me = await this.mine();
    if (me) await this.db.prepare('DELETE FROM household_ticks WHERE household_id = ? AND week_start = ?').bind(me.id, weekStart).run();
  }

  /** The sum of the members' portions: how many standard portions the household cooks for. */
  async totalPortions(): Promise<number> {
    const me = await this.mine();
    if (!me) return 0;
    return ((await this.db.prepare('SELECT SUM(portion) AS s FROM household_members WHERE household_id = ?').bind(me.id).first<Row>())?.s as number) ?? 0;
  }

  /** What this person can see of their household, for their export: who is in it, their portion, the shared plans and invitations. Nothing of another member's own data is in it. */
  async exportAll() {
    const info = await this.info();
    const me = await this.mine();
    const plans = me ? await this.db.prepare('SELECT week_start, items, updated_at FROM household_plans WHERE household_id = ? ORDER BY week_start').bind(me.id).all<Row>() : { results: [] as Row[] };
    return {
      household: info ? { members: info.members, yourPortion: me!.portion, plans: plans.results.map((r) => ({ weekStart: r.week_start, items: parse<PlannedItem[]>(r.items, []).map(sharedItem), updatedOn: day(r.updated_at as number) })) } : null,
      householdInvites: await this.incoming(),
    };
  }

  /** The household's items scaled to this person's portion. */
  async planForMe(weekStart: string): Promise<{ items: PlannedItem[]; updatedAt: number; portion: number } | null> {
    const me = await this.mine();
    const p = me ? await this.plan(weekStart) : null;
    return me && p ? { items: p.items.map((i) => scaleItem(i, me.portion)), updatedAt: p.updatedAt, portion: me.portion } : null;
  }
}
