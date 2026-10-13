import { getDb } from '../db/open';
import { saveSettings } from '../db/settings';
import { backupFilename, buildBackup, countRecords } from './export';

/** Triggers a normal file download (works offline and on iOS/Android, where it lands in Files/Downloads). */
function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Builds the backup, saves it as a file and records the time for the reminder. Returns how many records it holds. */
export async function saveBackupFile(): Promise<number> {
  const db = await getDb();
  const backup = await buildBackup(db);
  download(JSON.stringify(backup), backupFilename(new Date(backup.exportedAt)));
  await saveSettings(db, { lastBackupAt: backup.exportedAt });
  return countRecords(backup.data);
}
