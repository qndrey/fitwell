import * as v from 'valibot';
import type { IDBPDatabase } from 'idb';
import { LATEST_VERSION } from '../db/migrations';
import { publishChange } from '../db/broadcast';
import { BACKUP_STORES, backupSchema, headerSchema, type Backup, type BackupData } from './schema';

export type ParseError =
  | { kind: 'not-json' }
  | { kind: 'not-fitwell' }
  | { kind: 'newer'; version: number }
  | { kind: 'invalid'; where: string };

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: ParseError };

/**
 * Backups from older app versions are upgraded in memory here, one step at a time.
 * Stores added after a backup was made are simply absent and imported as empty.
 * Add a step when a later schema version changes the *shape* of existing records.
 */
const EXPORT_UPGRADES: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (data) => ({ ...data, ... })   // upgrades v1 -> v2, etc.
};

function upgrade(raw: { schemaVersion: number; data?: unknown } & Record<string, unknown>): void {
  let data = (raw.data ?? {}) as Record<string, unknown>;
  for (let ver = raw.schemaVersion; ver < LATEST_VERSION; ver++) data = EXPORT_UPGRADES[ver]?.(data) ?? data;
  raw.data = data;
  raw.schemaVersion = LATEST_VERSION;
}

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { kind: 'not-json' } };
  }
  const header = v.safeParse(headerSchema, raw);
  if (!header.success) return { ok: false, error: { kind: 'not-fitwell' } };
  if (header.output.schemaVersion > LATEST_VERSION) return { ok: false, error: { kind: 'newer', version: header.output.schemaVersion } };

  upgrade(raw as { schemaVersion: number } & Record<string, unknown>);
  const res = v.safeParse(backupSchema, raw);
  if (!res.success) {
    const issue = res.issues[0]!;
    const where = (issue.path ?? []).map((p) => String(p.key)).slice(0, 3).join(' › ');
    return { ok: false, error: { kind: 'invalid', where } };
  }
  return { ok: true, backup: res.output };
}

export type ImportMode = 'replace' | 'merge';

export interface Counts {
  foodEntries: number;
  customFoods: number;
  favorites: number;
  savedMeals: number;
  workouts: number;
  weights: number;
  measurements: number;
}

export const countsOf = (d: BackupData): Counts => ({
  foodEntries: d.foodEntries?.length ?? 0,
  customFoods: d.customFoods?.length ?? 0,
  favorites: d.favorites?.length ?? 0,
  savedMeals: d.savedMeals?.length ?? 0,
  workouts: d.workouts?.length ?? 0,
  weights: d.weightEntries?.length ?? 0,
  measurements: d.measurementEntries?.length ?? 0,
});

export async function currentCounts(db: IDBPDatabase): Promise<Counts> {
  const live = async (store: string) => ((await db.getAll(store)) as { deletedAt?: number }[]).filter((r) => r.deletedAt === undefined).length;
  return { foodEntries: await live('foodEntries'), customFoods: await live('customFoods'), favorites: await live('favorites'), savedMeals: await live('savedMeals'), workouts: await live('workouts'), weights: await live('weightEntries'), measurements: await live('measurementEntries') };
}

interface Rec {
  id: string;
  updatedAt: number;
  deletedAt?: number;
}

/** Newer `updatedAt` wins; on a tie a deletion wins (so removed things stay removed); otherwise keep what's here. */
export function mergeWins(incoming: Rec, existing: Rec | undefined): boolean {
  if (!existing) return true;
  if (incoming.updatedAt !== existing.updatedAt) return incoming.updatedAt > existing.updatedAt;
  return incoming.deletedAt !== undefined && existing.deletedAt === undefined;
}

/**
 * One transaction over every backed-up store: either all of it lands or none of it does.
 * Puts are queued without awaiting each one, so tens of thousands of records stay fast.
 */
export async function applyImport(db: IDBPDatabase, backup: Backup, mode: ImportMode): Promise<void> {
  const names = BACKUP_STORES.map((s) => s.name);
  const tx = db.transaction(names, 'readwrite');
  const writes: Promise<unknown>[] = [];
  // Mark the completion promise as observed up front so an abort can never surface as an unhandled rejection.
  tx.done.catch(() => undefined);
  try {
    for (const s of BACKUP_STORES) {
      const store = tx.objectStore(s.name);
      const incoming: Rec[] =
        s.kind === 'doc'
          ? ((backup.data[s.name] ? [backup.data[s.name]] : []) as unknown as Rec[]).map((r) => ({ ...r, id: s.name }))
          : ((backup.data[s.name] ?? []) as unknown as Rec[]);
      if (mode === 'replace') {
        writes.push(store.clear());
        for (const r of incoming) writes.push(store.put(r));
      } else {
        const existing = new Map(((await store.getAll()) as Rec[]).map((r) => [r.id, r]));
        for (const r of incoming) if (mergeWins(r, existing.get(r.id))) writes.push(store.put(r));
      }
    }
    await Promise.all(writes);
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    await Promise.allSettled(writes);
    throw e;
  }
  for (const s of BACKUP_STORES) publishChange({ store: s.name, ids: [] });
}
