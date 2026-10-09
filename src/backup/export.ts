import type { IDBPDatabase } from 'idb';
import { LATEST_VERSION } from '../db/migrations';
import { BACKUP_STORES, type Backup, type BackupData } from './schema';

interface MetaRow {
  key: string;
  value: unknown;
}

/** Everything the user owns, including tombstones (needed for future sync/merge). Not bundled data, not derived data. */
export async function buildBackup(db: IDBPDatabase, now: () => number = Date.now): Promise<Backup> {
  const tx = db.transaction([...BACKUP_STORES.map((s) => s.name), 'meta'], 'readonly');
  const data: Record<string, unknown> = {};
  for (const s of BACKUP_STORES) {
    const rows = await tx.objectStore(s.name).getAll();
    if (s.kind === 'doc') {
      if (rows[0]) data[s.name] = rows[0];
    } else {
      data[s.name] = rows;
    }
  }
  const install = (await tx.objectStore('meta').get('installId')) as MetaRow | undefined;
  await tx.done;
  return {
    app: 'fitwell',
    schemaVersion: LATEST_VERSION,
    exportedAt: now(),
    installId: typeof install?.value === 'string' ? install.value : '',
    data: data as BackupData,
  };
}

export function backupFilename(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `fitwell-backup-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.json`;
}

export function countRecords(data: BackupData): number {
  return (data.foodEntries?.length ?? 0) + (data.customFoods?.length ?? 0) + (data.favorites?.length ?? 0) + (data.savedMeals?.length ?? 0);
}
