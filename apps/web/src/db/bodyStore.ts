import { getDb } from './open';
import { Repository } from './repository';
import type { MeasurementEntry, MeasurementType, WeightEntry } from './schema';
import { PRESETS, presetId } from '../data/measurements';

const deps = { getDb };
export const weightRepo = new Repository<WeightEntry>('weightEntries', deps);
export const measurementTypesRepo = new Repository<MeasurementType>('measurementTypes', deps);
export const measurementEntriesRepo = new Repository<MeasurementEntry>('measurementEntries', deps);

export const weightId = (day: string): string => `weight:${day}`;
export const measurementId = (day: string): string => `meas:${day}`;

/** Logging a day again replaces that day's weight (same id), reviving it if it was deleted. */
export const saveWeight = (day: string, kg: number): Promise<WeightEntry> => weightRepo.upsert(weightId(day), { day, kg });
export const weightFor = (day: string): Promise<WeightEntry | undefined> => weightRepo.get(weightId(day));

async function newestWeight(upToDay?: string, excludeDay?: string): Promise<WeightEntry | undefined> {
  const db = await getDb();
  const range = upToDay === undefined ? null : IDBKeyRange.upperBound(upToDay, excludeDay !== undefined);
  let cursor = await db.transaction('weightEntries').store.index('day').openCursor(range, 'prev');
  while (cursor) {
    const w = cursor.value as WeightEntry;
    if (w.deletedAt === undefined) return w;
    cursor = await cursor.continue();
  }
  return undefined;
}

/** Most recent weight on or before `day` (default: the newest ever). */
export const latestWeight = (day?: string): Promise<WeightEntry | undefined> => newestWeight(day);
/** The weight before `day`, for "last time". */
export const weightBefore = (day: string): Promise<WeightEntry | undefined> => newestWeight(day, day);

export const saveMeasurements = (day: string, values: Record<string, number>): Promise<MeasurementEntry> => measurementEntriesRepo.upsert(measurementId(day), { day, values });
export const measurementsFor = (day: string): Promise<MeasurementEntry | undefined> => measurementEntriesRepo.get(measurementId(day));

export async function latestMeasurementDay(): Promise<string | undefined> {
  const db = await getDb();
  let cursor = await db.transaction('measurementEntries').store.index('day').openCursor(null, 'prev');
  while (cursor) {
    if ((cursor.value as MeasurementEntry).deletedAt === undefined) return (cursor.value as MeasurementEntry).day;
    cursor = await cursor.continue();
  }
  return undefined;
}

/** Most recent value for each type before `day`, to show as a placeholder ("last time"). */
export async function lastValues(beforeDay: string): Promise<Record<string, number>> {
  const db = await getDb();
  const out: Record<string, number> = {};
  let cursor = await db.transaction('measurementEntries').store.index('day').openCursor(IDBKeyRange.upperBound(beforeDay, true), 'prev');
  while (cursor) {
    const e = cursor.value as MeasurementEntry;
    if (e.deletedAt === undefined) for (const [k, v] of Object.entries(e.values)) if (!(k in out)) out[k] = v;
    cursor = await cursor.continue();
  }
  return out;
}

/**
 * Creates any preset type that doesn't exist yet. Never touches existing rows, so what you switched on or off
 * is kept, and presets added in a later release simply appear (switched off unless they are on by default).
 */
export async function ensureMeasurementTypes(): Promise<void> {
  const db = await getDb();
  const existing = new Set(((await db.getAllKeys('measurementTypes')) as string[]));
  for (const [i, p] of PRESETS.entries()) {
    const id = presetId(p.key);
    if (!existing.has(id)) await measurementTypesRepo.upsert(id, { key: p.key, label: p.label, kind: p.kind, enabled: p.defaultOn, preset: true, order: i });
  }
}

export async function listMeasurementTypes(): Promise<MeasurementType[]> {
  return (await measurementTypesRepo.list()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
