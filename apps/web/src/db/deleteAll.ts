import { DB_NAME } from './open';

/** Flag read once after the reload, so the fresh start can say what happened. */
export const DELETED_FLAG = 'fitwell-deleted';

/**
 * Removes every trace Fitwell keeps on this device: the whole database (records, settings, caches, queue),
 * the small theme mirror used to avoid a flash, and any runtime caches. The app shell stays cached so it still opens offline.
 * Then reloads, which creates an empty database again.
 */
export async function deleteEverything(): Promise<void> {
  // Close our own connection first, otherwise the delete waits forever.
  try {
    const { getDb } = await import('./open');
    (await getDb()).close();
  } catch {
    /* nothing open */
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => setTimeout(() => reject(new Error('Another Fitwell tab is open')), 4000);
  });
  try {
    localStorage.removeItem('fitwell-theme');
  } catch {
    /* storage may be blocked */
  }
  try {
    for (const name of await caches.keys()) if (!/precache/i.test(name)) await caches.delete(name);
  } catch {
    /* no Cache API */
  }
  try {
    sessionStorage.setItem(DELETED_FLAG, '1');
  } catch {
    /* ignore */
  }
  location.hash = '#/today';
  location.reload();
}
