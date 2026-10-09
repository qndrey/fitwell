import type { IDBPDatabase, IDBPTransaction } from 'idb';

export type UpgradeTx = IDBPTransaction<unknown, string[], 'versionchange'>;

export interface Migration {
  /** Becomes the IndexedDB version. Strictly increasing, never edited once shipped. */
  version: number;
  name: string;
  up(db: IDBPDatabase, tx: UpgradeTx): void | Promise<void>;
}

/**
 * Append-only. Migrations must be idempotent and tested against fixture DBs
 * (tests/unit/migrations.test.ts). A migration that rewrites user data must
 * first copy the affected stores into `backup_v{n}` (see TECH_SPEC §3.1).
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial: meta + settings',
    up(db) {
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  },
  {
    version: 2,
    name: 'goals',
    up(db) {
      db.createObjectStore('goals', { keyPath: 'id' });
    },
  },
  {
    version: 3,
    name: 'food log, custom foods, favorites, saved meals',
    up(db) {
      const entries = db.createObjectStore('foodEntries', { keyPath: 'id' });
      entries.createIndex('day', 'day');
      entries.createIndex('state', 'state');
      entries.createIndex('createdAt', 'createdAt');
      db.createObjectStore('customFoods', { keyPath: 'id' });
      db.createObjectStore('favorites', { keyPath: 'id' });
      db.createObjectStore('savedMeals', { keyPath: 'id' });
    },
  },
  {
    version: 4,
    name: 'online food cache + lookup cache',
    up(db) {
      db.createObjectStore('foods', { keyPath: 'id' });
      db.createObjectStore('offCache', { keyPath: 'key' });
    },
  },
];

export const LATEST_VERSION = migrations[migrations.length - 1]!.version;

export async function runMigrations(
  list: Migration[],
  db: IDBPDatabase,
  tx: UpgradeTx,
  oldVersion: number,
): Promise<void> {
  const pending = list.filter((m) => m.version > oldVersion).sort((a, b) => a.version - b.version);
  for (const m of pending) await m.up(db, tx);
}
