import type { IDBPDatabase } from 'idb';
import type { Base } from './schema';
import { publishChange } from './broadcast';

type Fields<T extends Base> = Omit<T, keyof Base>;

export interface RepoDeps {
  getDb: () => Promise<IDBPDatabase>;
  now?: () => number;
  newId?: () => string;
}

/**
 * Generic repository for user-owned records. Owns id/timestamps/rev and
 * soft-deletes. UI code goes through repositories, never through `idb`.
 * Every write is one transaction and is published only after it commits.
 */
export class Repository<T extends Base> {
  private readonly getDb: () => Promise<IDBPDatabase>;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    readonly store: string,
    deps: RepoDeps,
  ) {
    this.getDb = deps.getDb;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  async create(fields: Fields<T>): Promise<T> {
    const t = this.now();
    const record = { ...fields, id: this.newId(), createdAt: t, updatedAt: t, rev: 1 } as unknown as T;
    const db = await this.getDb();
    const tx = db.transaction(this.store, 'readwrite');
    await tx.store.add(record);
    await tx.done;
    publishChange({ store: this.store, ids: [record.id] });
    return record;
  }

  /** Returns undefined for missing or soft-deleted records. */
  async get(id: string): Promise<T | undefined> {
    const db = await this.getDb();
    const rec = (await db.get(this.store, id)) as T | undefined;
    return rec && rec.deletedAt === undefined ? rec : undefined;
  }

  async list(): Promise<T[]> {
    const db = await this.getDb();
    const all = (await db.getAll(this.store)) as T[];
    return all.filter((r) => r.deletedAt === undefined);
  }

  async update(id: string, patch: Partial<Fields<T>>): Promise<T> {
    const db = await this.getDb();
    const tx = db.transaction(this.store, 'readwrite');
    const cur = (await tx.store.get(id)) as T | undefined;
    if (!cur || cur.deletedAt !== undefined) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new Error(`${this.store}: record ${id} not found`);
    }
    const next = { ...cur, ...patch, updatedAt: this.nextTimestamp(cur), rev: cur.rev + 1 } as T;
    await tx.store.put(next);
    await tx.done;
    publishChange({ store: this.store, ids: [id] });
    return next;
  }

  /** Soft delete (tombstone). */
  async remove(id: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(this.store, 'readwrite');
    const cur = (await tx.store.get(id)) as T | undefined;
    if (!cur || cur.deletedAt !== undefined) {
      await tx.done;
      return;
    }
    const t = this.nextTimestamp(cur);
    await tx.store.put({ ...cur, deletedAt: t, updatedAt: t, rev: cur.rev + 1 });
    await tx.done;
    publishChange({ store: this.store, ids: [id] });
  }

  /** updatedAt never goes backwards for a record, even if the clock does. */
  private nextTimestamp(cur: T): number {
    return Math.max(this.now(), cur.updatedAt);
  }
}
