// Sending a workout template or a recipe to a friend (B1). Between accepted friends only, the recipient decides, and what they get is a copy:
// the sender sees nothing of theirs afterwards and the recipient sees nothing more of the sender's. Text from another person is cleaned on the
// way (no markup, no links, no control characters, bounded lengths) and what points back to the sender (own foods, the source page) is dropped.
import type { PlanData, Recipe, RecipeItem } from './planData';
import type { Template, TemplateCardio, TemplateExercise, WorkoutData } from './workoutData';

export const TRANSFER_KINDS = ['template', 'recipe'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

/** Sent and not yet gone: at most this many in all, and this many to one friend, counting declined ones (which look waiting to the sender). */
export const MAX_SENT = 10;
export const MAX_SENT_TO_ONE = 5;
export const TRANSFER_TTL_MS = 30 * 86_400_000;
const MAX_SNAPSHOT_BYTES = 64 * 1024;

type Row = Record<string, unknown>;

export type SendOutcome =
  | { ok: true; to: string }
  | { ok: false; reason: 'not_friends' | 'not_found' | 'too_many' | 'too_many_to_one' | 'too_big' };

export interface ReceivedItem {
  transferId: string;
  /** The sender, as friends are shown: a nickname when they have one (then no email), else the email. */
  from: { nickname: string | null; email: string | null };
  kind: TransferKind;
  name: string;
  /** What it holds, in a line; never the sender's own text beyond the name. */
  summary: string;
  sentOn: string;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Text from another person: control characters out, whitespace collapsed, markup and links removed, cut to length. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

function cleanTemplate(t: Template) {
  const exercises = t.exercises.slice(0, 15).map((e): TemplateExercise => ({
    id: e.id,
    sets: num(e.sets, 1, 20, 3),
    reps: num(e.reps, 0, 200, 10),
    restSec: num(e.restSec, 0, 900, 90),
    ...(e.seconds !== undefined && { seconds: num(e.seconds, 1, 3600, 30) }),
    ...(e.weightKg !== undefined && { weightKg: num(e.weightKg, 0, 1000, 0) }),
    ...(e.notes ? { notes: cleanText(e.notes, 200) } : {}),
    ...(e.superset ? { superset: cleanText(e.superset, 20) } : {}),
    ...(e.warmup !== undefined && { warmup: e.warmup }),
  }));
  const cardio = t.cardio.slice(0, 4).map((c): TemplateCardio => ({ activityId: c.activityId, minutes: num(c.minutes, 1, 600, 10), when: c.when === 'after' ? 'after' : 'before', ...(c.distanceKm !== undefined && { distanceKm: num(c.distanceKm, 0, 1000, 0) }) }));
  return { name: cleanText(t.name, 60), exercises, cardio };
}

function cleanRecipe(r: Recipe) {
  const items = r.items.slice(0, 60).map((i): RecipeItem => {
    const { foodId, ...rest } = i;
    // Library foods are the same for everyone; the sender's own foods and packaged products are not, so only their nutrition and name travel.
    return { ...rest, name: cleanText(i.name, 80), grams: num(i.grams, 0, 10_000, 0), ...(typeof foodId === 'string' && foodId.startsWith('frida:') ? { foodId } : {}) };
  });
  return { name: cleanText(r.name, 60), servings: num(r.servings, 1, 100, 1), items, notes: r.notes ? cleanText(r.notes, 500) : null, steps: r.steps.slice(0, 40).map((s) => cleanText(s, 400)).filter(Boolean) };
}

const summaryOf = (kind: TransferKind, snapshot: Record<string, unknown>): string => {
  if (kind === 'template') {
    const ex = (snapshot.exercises as unknown[] | undefined)?.length ?? 0;
    const cardio = (snapshot.cardio as unknown[] | undefined)?.length ?? 0;
    return `${ex} ${ex === 1 ? 'exercise' : 'exercises'}${cardio ? `, ${cardio} cardio ${cardio === 1 ? 'block' : 'blocks'}` : ''}`;
  }
  const items = (snapshot.items as unknown[] | undefined)?.length ?? 0;
  const steps = (snapshot.steps as unknown[] | undefined)?.length ?? 0;
  return `${snapshot.servings as number} ${snapshot.servings === 1 ? 'serving' : 'servings'}, ${items} ${items === 1 ? 'ingredient' : 'ingredients'}${steps ? `, ${steps} ${steps === 1 ? 'step' : 'steps'}` : ''}`;
};

export class TransfersData {
  constructor(
    private readonly db: D1Database,
    readonly userId: string,
    private readonly workouts: WorkoutData,
    private readonly plans: PlanData,
    private readonly now: () => number = Date.now,
  ) {}

  private async prune(): Promise<void> {
    await this.db.prepare('DELETE FROM item_transfers WHERE created_at <= ?').bind(this.now() - TRANSFER_TTL_MS).run();
  }

  /** The friend on the other side of one of this person's accepted connections: their id and how they are shown, or null. */
  private async friend(connectionId: string): Promise<{ id: string; label: string } | null> {
    const r = await this.db
      .prepare(
        `SELECT u.id, u.email, p.nickname FROM connections c
           JOIN users u ON u.id = CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END LEFT JOIN profiles p ON p.user_id = u.id
         WHERE c.id = ?2 AND c.status = 'accepted' AND (c.requester_id = ?1 OR c.addressee_id = ?1)`,
      )
      .bind(this.userId, connectionId)
      .first<Row>();
    return r ? { id: r.id as string, label: ((r.nickname as string | null) ?? (r.email as string)) } : null;
  }

  /** Sends a copy of one of this person's templates or recipes (by name) to a friend. Sending the same item again while it waits is one transfer. */
  async send(connectionId: string, kind: TransferKind, name: string): Promise<SendOutcome> {
    const friend = await this.friend(connectionId);
    if (!friend) return { ok: false, reason: 'not_friends' };
    await this.prune();
    let snapshot: Record<string, unknown> | null = null;
    if (kind === 'template') {
      const t = await this.workouts.templateByName(name);
      if (t) snapshot = cleanTemplate(t);
    } else {
      const r = await this.plans.recipeByName(name);
      if (r) snapshot = cleanRecipe(r);
    }
    if (!snapshot) return { ok: false, reason: 'not_found' };
    const body = JSON.stringify(snapshot);
    if (body.length > MAX_SNAPSHOT_BYTES) return { ok: false, reason: 'too_big' };
    const sent = ((await this.db.prepare('SELECT COUNT(*) AS n FROM item_transfers WHERE sender_id = ?').bind(this.userId).first<Row>())?.n as number) ?? 0;
    const toOne = ((await this.db.prepare('SELECT COUNT(*) AS n FROM item_transfers WHERE sender_id = ? AND recipient_id = ?').bind(this.userId, friend.id).first<Row>())?.n as number) ?? 0;
    const repeat = await this.db.prepare("SELECT 1 AS ok FROM item_transfers WHERE sender_id = ? AND recipient_id = ? AND kind = ? AND lower(name) = lower(?) AND status = 'pending'").bind(this.userId, friend.id, kind, snapshot.name as string).first<Row>();
    if (!repeat) {
      if (sent >= MAX_SENT) return { ok: false, reason: 'too_many' };
      if (toOne >= MAX_SENT_TO_ONE) return { ok: false, reason: 'too_many_to_one' };
      await this.db
        .prepare("INSERT INTO item_transfers (id, sender_id, recipient_id, kind, name, snapshot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
        .bind(crypto.randomUUID(), this.userId, friend.id, kind, snapshot.name as string, body, this.now())
        .run();
    }
    return { ok: true, to: friend.label };
  }

  /** What friends have sent this person and nobody has answered. */
  async received(): Promise<ReceivedItem[]> {
    await this.prune();
    const { results } = await this.db
      .prepare(
        `SELECT t.id, t.kind, t.name, t.snapshot, t.created_at, u.email, p.nickname FROM item_transfers t
           JOIN users u ON u.id = t.sender_id LEFT JOIN profiles p ON p.user_id = u.id
         WHERE t.recipient_id = ?1 AND t.status = 'pending' AND EXISTS (
           SELECT 1 FROM connections c WHERE c.status = 'accepted' AND ((c.requester_id = ?1 AND c.addressee_id = t.sender_id) OR (c.requester_id = t.sender_id AND c.addressee_id = ?1)))
         ORDER BY t.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    return results.map((r) => {
      let snap: Record<string, unknown> = {};
      try {
        snap = JSON.parse(r.snapshot as string) as Record<string, unknown>;
      } catch {
        /* an unreadable snapshot is listed without a summary and cannot be accepted */
      }
      const nickname = (r.nickname as string | null) ?? null;
      return { transferId: r.id as string, from: { nickname, email: nickname ? null : (r.email as string) }, kind: r.kind as TransferKind, name: r.name as string, summary: summaryOf(r.kind as TransferKind, snap), sentOn: day(r.created_at as number) };
    });
  }

  /** Copies a received item into this person's own templates or recipes, never replacing one they have (a taken name gets a suffix), and removes the transfer. */
  async accept(transferId: string): Promise<{ kind: TransferKind; name: string } | null> {
    const t = await this.db
      .prepare(
        `SELECT t.kind, t.name, t.snapshot, u.email, p.nickname FROM item_transfers t JOIN users u ON u.id = t.sender_id LEFT JOIN profiles p ON p.user_id = u.id
         WHERE t.id = ?1 AND t.recipient_id = ?2 AND t.status = 'pending' AND EXISTS (
           SELECT 1 FROM connections c WHERE c.status = 'accepted' AND ((c.requester_id = ?2 AND c.addressee_id = t.sender_id) OR (c.requester_id = t.sender_id AND c.addressee_id = ?2)))`,
      )
      .bind(transferId, this.userId)
      .first<Row>();
    if (!t) return null;
    let snap: Record<string, unknown>;
    try {
      snap = JSON.parse(t.snapshot as string) as Record<string, unknown>;
    } catch {
      return null;
    }
    const kind = t.kind as TransferKind;
    const from = ((t.nickname as string | null) ?? 'a friend').slice(0, 20);
    const exists = (n: string) => (kind === 'template' ? this.workouts.templateByName(n) : this.plans.recipeByName(n));
    // A name already in use is not replaced: the copy is "Push day (from ana_fit)", then "(2)", "(3)"...
    let name = cleanText(snap.name, 60) || 'Received';
    if (await exists(name)) {
      const base = `${name.slice(0, 60 - from.length - 8)} (from ${from})`;
      name = base;
      for (let n = 2; (await exists(name)) && n < 50; n++) name = `${base.slice(0, 55)} (${n})`;
    }
    if (kind === 'template') {
      const ex = Array.isArray(snap.exercises) ? (snap.exercises as TemplateExercise[]) : [];
      if (ex.length === 0 || ex.length > 15) return null;
      await this.workouts.saveTemplate(name, ex, Array.isArray(snap.cardio) ? (snap.cardio as TemplateCardio[]) : []);
    } else {
      const items = Array.isArray(snap.items) ? (snap.items as RecipeItem[]) : [];
      if (items.length === 0) return null;
      await this.plans.saveRecipe(name, num(snap.servings, 1, 100, 1), items, { notes: (snap.notes as string | null) ?? null, sourceUrl: null, steps: Array.isArray(snap.steps) ? (snap.steps as string[]) : [] });
    }
    await this.db.prepare('DELETE FROM item_transfers WHERE id = ? AND recipient_id = ?').bind(transferId, this.userId).run();
    return { kind, name };
  }

  /** Declines a received item: it is hidden from this person and the sender sees no change (it still counts against their limits until it expires). */
  async decline(transferId: string): Promise<boolean> {
    const r = await this.db.prepare("UPDATE item_transfers SET status = 'declined' WHERE id = ? AND recipient_id = ? AND status = 'pending'").bind(transferId, this.userId).run();
    return r.meta.changes > 0;
  }

  /** What the person sent and has waiting (for their own copy); the snapshots stay out. */
  async exportAll() {
    const { results } = await this.db
      .prepare(
        `SELECT t.kind, t.name, t.created_at, u.email, p.nickname, t.sender_id = ?1 AS sent FROM item_transfers t
           JOIN users u ON u.id = CASE WHEN t.sender_id = ?1 THEN t.recipient_id ELSE t.sender_id END LEFT JOIN profiles p ON p.user_id = u.id
         WHERE (t.sender_id = ?1) OR (t.recipient_id = ?1 AND t.status = 'pending') ORDER BY t.created_at`,
      )
      .bind(this.userId)
      .all<Row>();
    return {
      itemTransfers: results.map((r) => ({ direction: r.sent === 1 ? 'sent' : 'received', with: (r.nickname as string | null) ?? (r.email as string), kind: r.kind, name: r.name, at: r.created_at })),
    };
  }
}
