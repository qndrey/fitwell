import type { IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Settings } from './schema';
import { publishChange } from './broadcast';

export async function loadSettings(db: IDBPDatabase): Promise<Settings> {
  const stored = (await db.get('settings', 'settings')) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(
  db: IDBPDatabase,
  patch: Partial<Omit<Settings, 'id' | 'updatedAt'>>,
  now: () => number = Date.now,
): Promise<Settings> {
  const tx = db.transaction('settings', 'readwrite');
  const stored = (await tx.store.get('settings')) as Partial<Settings> | undefined;
  const next: Settings = { ...DEFAULT_SETTINGS, ...stored, ...patch, id: 'settings', updatedAt: now() };
  await tx.store.put(next);
  await tx.done;
  publishChange({ store: 'settings', ids: ['settings'] });
  return next;
}
