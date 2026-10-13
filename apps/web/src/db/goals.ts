import type { IDBPDatabase } from 'idb';
import type { Goals } from '@fitwell/core/schema';
import { publishChange } from './broadcast';

export async function loadGoals(db: IDBPDatabase): Promise<Goals> {
  return { id: 'goals', updatedAt: 0, ...((await db.get('goals', 'goals')) as Partial<Goals> | undefined) };
}

export async function saveGoals(db: IDBPDatabase, patch: Partial<Omit<Goals, 'id' | 'updatedAt'>>, now: () => number = Date.now): Promise<Goals> {
  const tx = db.transaction('goals', 'readwrite');
  const stored = (await tx.store.get('goals')) as Partial<Goals> | undefined;
  const next: Goals = { ...stored, ...patch, id: 'goals', updatedAt: now() };
  await tx.store.put(next);
  await tx.done;
  publishChange({ store: 'goals', ids: ['goals'] });
  return next;
}
