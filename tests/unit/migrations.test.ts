import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/open';
import { migrations } from '../../src/db/migrations';
import { ensureMeta } from '../../src/db/meta';
import { loadSettings, saveSettings } from '../../src/db/settings';

let n = 0;
const dbName = () => `fitwell-test-${++n}`;

describe('migrations', () => {
  it('creates the latest schema from scratch', async () => {
    const db = await openDatabase({ name: dbName() });
    expect([...db.objectStoreNames].sort()).toEqual(['customFoods', 'favorites', 'foodEntries', 'goals', 'meta', 'savedMeals', 'settings']);
    db.close();
  });

  it('upgrades a v1 fixture DB to latest and keeps its data', async () => {
    const name = dbName();
    const v1 = await openDatabase({ name, migrationList: migrations.slice(0, 1) });
    expect(v1.version).toBe(1);
    expect([...v1.objectStoreNames]).not.toContain('goals');
    await v1.put('settings', { id: 'settings', theme: 'dark', units: 'imperial', updatedAt: 5 });
    await v1.put('meta', { key: 'installId', value: 'abc' });
    v1.close();

    const db = await openDatabase({ name });
    expect(db.version).toBe(migrations[migrations.length - 1]!.version);
    expect([...db.objectStoreNames]).toContain('goals');
    expect((await loadSettings(db)).theme).toBe('dark');
    expect((await ensureMeta(db)).installId).toBe('abc');
    db.close();
  });

  it('is a no-op when already at latest', async () => {
    const name = dbName();
    (await openDatabase({ name })).close();
    const db = await openDatabase({ name });
    expect(db.version).toBe(migrations[migrations.length - 1]!.version);
    db.close();
  });
});

describe('meta + settings', () => {
  it('keeps a stable installId and fills setting defaults', async () => {
    const db = await openDatabase({ name: dbName() });
    const a = await ensureMeta(db);
    const b = await ensureMeta(db);
    expect(a.installId).toBe(b.installId);
    expect((await loadSettings(db)).theme).toBe('system');
    const saved = await saveSettings(db, { theme: 'light' }, () => 42);
    expect(saved).toMatchObject({ theme: 'light', units: 'metric', updatedAt: 42 });
    db.close();
  });
});
