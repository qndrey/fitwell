import { openDB, type IDBPDatabase } from 'idb';
import { LATEST_VERSION, migrations, runMigrations, type Migration } from './migrations';

export const DB_NAME = 'fitwell';

export interface OpenOptions {
  name?: string;
  migrationList?: Migration[];
  /** Called when another tab wants to upgrade/delete the DB; we close so it isn't blocked. */
  onVersionChange?: () => void;
  onBlocked?: () => void;
}

export function openDatabase(opts: OpenOptions = {}): Promise<IDBPDatabase> {
  const { name = DB_NAME, migrationList = migrations, onVersionChange, onBlocked } = opts;
  const version = migrationList[migrationList.length - 1]!.version;
  return openDB(name, version, {
    upgrade(db, oldVersion, _newVersion, tx) {
      return runMigrations(migrationList, db, tx, oldVersion);
    },
    blocked() {
      onBlocked?.();
    },
    blocking() {
      // A newer tab/app version needs to upgrade: release the connection.
      onVersionChange?.();
    },
  });
}

let shared: Promise<IDBPDatabase> | null = null;

/** Shared app connection. Closes itself when another tab needs a version change. */
export function getDb(): Promise<IDBPDatabase> {
  shared ??= openDatabase({
    onVersionChange() {
      void shared?.then((db) => db.close());
      shared = null;
    },
  });
  return shared;
}

export { LATEST_VERSION };
