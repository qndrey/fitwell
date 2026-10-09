import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { getDb } from '../../db/open';
import { onChange } from '../../db/broadcast';
import type { Day } from '../../domain/dates';
import type { RangeData } from '../../domain/stats';

const STORES = ['foodEntries', 'workouts', 'weightEntries', 'measurementEntries'] as const;

/** Bumped whenever logged data changes, so open screens reload. */
export const dataRevision = signal(0);
onChange((c) => {
  if ((STORES as readonly string[]).includes(c.store)) dataRevision.value++;
});

/** Everything logged between two days (inclusive), straight from the day indexes: no stored aggregates to drift. */
export async function loadRange(from: Day, to: Day): Promise<RangeData> {
  const db = await getDb();
  const range = IDBKeyRange.bound(from, to);
  const [entries, workouts, weights, measurements] = await Promise.all([
    db.getAllFromIndex('foodEntries', 'day', range),
    db.getAllFromIndex('workouts', 'day', range),
    db.getAllFromIndex('weightEntries', 'day', range),
    db.getAllFromIndex('measurementEntries', 'day', range),
  ]);
  return { entries, workouts, weights, measurements };
}

/** The earliest day with anything logged, for the "All" range. */
export async function earliestDay(): Promise<Day | undefined> {
  const db = await getDb();
  const firsts = await Promise.all(
    STORES.map(async (s) => {
      let cursor = await db.transaction(s).store.index('day').openCursor();
      while (cursor && (cursor.value as { deletedAt?: number }).deletedAt !== undefined) cursor = await cursor.continue();
      return cursor ? (cursor.value as { day: Day }).day : undefined;
    }),
  );
  return firsts.filter((d): d is Day => !!d).sort()[0];
}

/** Loads a range and reloads it when the data changes. `null` until the first load. */
export function useRangeData(from: Day, to: Day): RangeData | null {
  const [data, setData] = useState<RangeData | null>(null);
  const rev = dataRevision.value;
  useEffect(() => {
    let live = true;
    void loadRange(from, to).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [from, to, rev]);
  return data;
}

export function useEarliest(): Day | undefined | null {
  const [d, setD] = useState<Day | undefined | null>(null);
  const rev = dataRevision.value;
  useEffect(() => {
    let live = true;
    void earliestDay().then((x) => live && setD(x));
    return () => {
      live = false;
    };
  }, [rev]);
  return d;
}
