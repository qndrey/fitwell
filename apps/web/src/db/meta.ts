import type { IDBPDatabase } from 'idb';
import { LATEST_VERSION } from './migrations';

interface MetaRow {
  key: string;
  value: unknown;
}

/** Ensures installId exists and records the logical schema version. */
export async function ensureMeta(db: IDBPDatabase): Promise<{ installId: string; schemaVersion: number }> {
  const tx = db.transaction('meta', 'readwrite');
  const existing = (await tx.store.get('installId')) as MetaRow | undefined;
  const installId = typeof existing?.value === 'string' ? existing.value : crypto.randomUUID();
  if (!existing) await tx.store.put({ key: 'installId', value: installId });
  await tx.store.put({ key: 'schemaVersion', value: LATEST_VERSION });
  await tx.done;
  return { installId, schemaVersion: LATEST_VERSION };
}
