import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/db/open';
import { ensureMeta } from '../../src/db/meta';
import { buildBackup, backupFilename, countRecords } from '../../src/backup/export';
import { applyImport, countsOf, currentCounts, mergeWins, parseBackup } from '../../src/backup/import';
import { backupReminderDue } from '../../src/domain/backupReminder';
import { LATEST_VERSION } from '../../src/db/migrations';
import type { FoodEntry } from '../../src/db/schema';
import { BACKUP_STORES } from '../../src/backup/schema';

let n = 0;
async function freshDb() {
  const db = await openDatabase({ name: `backup-${++n}` });
  await ensureMeta(db);
  return db;
}

// Small seeded PRNG so "random" datasets are reproducible.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const food = (i: number) => ({
  ref: { kind: 'bundled' as const, id: `frida:${i}` },
  name: `Food ${i}`,
  per100g: { kcal: 100 + i, protein: 1, carbs: 2, fat: 3 },
  portions: i % 2 ? [{ label: 'piece', grams: 40 }] : [],
});

function entry(i: number, over: Partial<FoodEntry> = {}): FoodEntry {
  const f = food(i);
  return {
    id: `e${i}`, createdAt: 1000 + i, updatedAt: 1000 + i, rev: 1,
    day: '2026-10-09', slot: 'lunch', state: 'resolved', food: f,
    quantity: { amount: 100, unit: 'g' }, grams: 100, nutrition: { kcal: f.per100g.kcal, protein: 1, carbs: 2, fat: 3 },
    ...over,
  };
}

async function seed(db: Awaited<ReturnType<typeof freshDb>>, count: number, random = rng(1)) {
  const tx = db.transaction(['foodEntries', 'customFoods', 'favorites', 'savedMeals', 'settings', 'goals'], 'readwrite');
  for (let i = 0; i < count; i++) {
    const r = random();
    const del = random() < 0.2 ? { deletedAt: 5000 + i } : {};
    if (r < 0.7) await tx.objectStore('foodEntries').put(entry(i, del));
    else if (r < 0.8) await tx.objectStore('customFoods').put({ id: `c${i}`, createdAt: 1, updatedAt: 2 + i, rev: 1, name: `Custom ${i}`, per100g: food(i).per100g, portions: [], ...del });
    else if (r < 0.9) await tx.objectStore('favorites').put({ id: `fav:${i}`, createdAt: 1, updatedAt: 2, rev: 1, food: food(i), ...del });
    else await tx.objectStore('savedMeals').put({ id: `m${i}`, createdAt: 1, updatedAt: 2, rev: 1, name: `Meal ${i}`, items: [{ food: food(i), quantity: { amount: 1, unit: 'portion', portionLabel: 'piece' } }], ...del });
  }
  await tx.objectStore('settings').put({ id: 'settings', units: 'imperial', theme: 'dark', habitOnly: true, hideBodyTracking: false, backupReminderDays: 14, updatedAt: 9 });
  await tx.objectStore('goals').put({ id: 'goals', kcal: 2000, updatedAt: 9 });
  await tx.done;
}

async function dump(db: Awaited<ReturnType<typeof freshDb>>) {
  const out: Record<string, unknown> = {};
  for (const s of BACKUP_STORES) out[s.name] = (await db.getAll(s.name)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return out;
}

const roundtrip = (b: unknown) => {
  const r = parseBackup(JSON.stringify(b));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.backup;
};

describe('export → wipe → import', () => {
  it('is lossless for many random datasets, tombstones included', async () => {
    for (let seedNo = 1; seedNo <= 25; seedNo++) {
      const a = await freshDb();
      await seed(a, 5 + seedNo * 7, rng(seedNo));
      const backup = await buildBackup(a, () => 123);
      const b = await freshDb();
      await applyImport(b, roundtrip(backup), 'replace');
      expect(await dump(b), `seed ${seedNo}`).toEqual(await dump(a));
      expect(countRecords(backup.data)).toBeGreaterThan(0);
      a.close();
      b.close();
    }
  });

  it('keeps the destination device identity and bundled/derived data out of the file', async () => {
    const a = await freshDb();
    await seed(a, 10);
    const backup = await buildBackup(a);
    expect(Object.keys(backup.data).sort()).toEqual(['customFoods', 'favorites', 'foodEntries', 'goals', 'savedMeals', 'settings']);
    const b = await freshDb();
    const before = (await b.get('meta', 'installId')).value;
    await applyImport(b, roundtrip(backup), 'replace');
    expect((await b.get('meta', 'installId')).value).toBe(before);
  });

  it('replace removes what was on the device', async () => {
    const a = await freshDb();
    await seed(a, 20);
    const b = await freshDb();
    await b.put('foodEntries', entry(999));
    await applyImport(b, roundtrip(await buildBackup(a)), 'replace');
    expect(await b.get('foodEntries', 'e999')).toBeUndefined();
  });
});

describe('unresolved entries survive a backup', () => {
  it('keeps lookup state, candidates and hand-typed values through export → import', async () => {
    const a = await freshDb();
    const candidate = { source: 'off' as const, sourceId: '111', name: 'Test oat drink', brand: 'Acme', per100g: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5 }, portions: [{ label: 'serving', grams: 250 }] };
    await a.put('foodEntries', { ...entry(1), state: 'awaiting_confirmation', food: undefined, nutrition: undefined, queryText: 'oat drink', lookup: { queryVersion: 2, attempts: 1, lastError: 'HTTP 500', nextAttemptAt: 99, candidates: [candidate], suggestedIndex: 0, completedAt: 5 } });
    await a.put('foodEntries', { ...entry(2), state: 'resolved', food: undefined, queryText: 'grandma soup', manual: true });
    await a.put('settings', { id: 'settings', units: 'metric', theme: 'system', habitOnly: false, hideBodyTracking: false, onlineLookup: false, backupReminderDays: 14, updatedAt: 3 });
    const b = await freshDb();
    await applyImport(b, roundtrip(await buildBackup(a)), 'replace');
    expect(await dump(b)).toEqual(await dump(a));
    expect((await b.get('settings', 'settings')).onlineLookup).toBe(false);
  });
});

describe('parseBackup', () => {
  const good = async () => roundtrip(await buildBackup(await freshDb()));

  it('rejects text that is not JSON', () => {
    expect(parseBackup('hello')).toEqual({ ok: false, error: { kind: 'not-json' } });
    expect(parseBackup('')).toEqual({ ok: false, error: { kind: 'not-json' } });
  });
  it('rejects JSON that is not a Fitwell backup', () => {
    for (const x of ['[]', '{}', '{"app":"other","schemaVersion":1}', 'null', '"x"']) expect(parseBackup(x), x).toEqual({ ok: false, error: { kind: 'not-fitwell' } });
  });
  it('reports backups from a newer app version', async () => {
    const b = { ...(await good()), schemaVersion: LATEST_VERSION + 1 };
    expect(parseBackup(JSON.stringify(b))).toEqual({ ok: false, error: { kind: 'newer', version: LATEST_VERSION + 1 } });
  });
  it('points at where a record is invalid', async () => {
    const db = await freshDb();
    await db.put('foodEntries', entry(1));
    const b = JSON.parse(JSON.stringify(await buildBackup(db)));
    b.data.foodEntries[0].day = '2026-02-31';
    const r = parseBackup(JSON.stringify(b));
    expect(r).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    expect((r as { error: { where: string } }).error.where).toContain('foodEntries');
    b.data.foodEntries[0].day = '2026-02-03';
    b.data.foodEntries[0].nutrition.kcal = -5;
    expect(parseBackup(JSON.stringify(b)).ok).toBe(false);
    b.data.foodEntries[0].nutrition.kcal = Number.NaN; // serialises to null
    expect(parseBackup(JSON.stringify(b)).ok).toBe(false);
  });
  it('accepts an older backup (version 1, fewer stores) and treats missing stores as empty', () => {
    const old = { app: 'fitwell', schemaVersion: 1, exportedAt: 1, installId: 'x', data: { settings: { id: 'settings', units: 'metric', theme: 'light', habitOnly: false, hideBodyTracking: false, backupReminderDays: 14, updatedAt: 3 } } };
    const r = parseBackup(JSON.stringify(old));
    expect(r.ok && r.backup.schemaVersion).toBe(LATEST_VERSION);
    expect(r.ok && countsOf(r.backup.data)).toEqual({ foodEntries: 0, customFoods: 0, favorites: 0, savedMeals: 0 });
  });
  it('ignores unknown fields instead of importing them', async () => {
    const db = await freshDb();
    await db.put('foodEntries', entry(1));
    const b = JSON.parse(JSON.stringify(await buildBackup(db)));
    b.data.foodEntries[0].evil = '<script>';
    b.extra = 1;
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok && (r.backup.data.foodEntries![0] as Record<string, unknown>).evil).toBeUndefined();
  });
});

describe('merge', () => {
  it('rule: newer wins, tie → deletion wins, otherwise keep existing', () => {
    const r = (updatedAt: number, deletedAt?: number) => ({ id: 'x', updatedAt, deletedAt });
    expect(mergeWins(r(2), r(1))).toBe(true);
    expect(mergeWins(r(1), r(2))).toBe(false);
    expect(mergeWins(r(1, 1), r(1))).toBe(true);
    expect(mergeWins(r(1), r(1, 1))).toBe(false);
    expect(mergeWins(r(1), r(1))).toBe(false);
    expect(mergeWins(r(1), undefined)).toBe(true);
  });

  it('unions disjoint data and resolves conflicts per record', async () => {
    const a = await freshDb();
    await a.put('foodEntries', entry(1, { updatedAt: 50, quantity: { amount: 111, unit: 'g' } })); // newer in backup
    await a.put('foodEntries', entry(2, { updatedAt: 10 })); // older in backup
    await a.put('foodEntries', entry(3, { updatedAt: 20, deletedAt: 20 })); // deleted in backup, tie
    await a.put('foodEntries', entry(4)); // only in backup
    const backup = roundtrip(await buildBackup(a));

    const b = await freshDb();
    await b.put('foodEntries', entry(1, { updatedAt: 40, quantity: { amount: 5, unit: 'g' } }));
    await b.put('foodEntries', entry(2, { updatedAt: 30, quantity: { amount: 222, unit: 'g' } }));
    await b.put('foodEntries', entry(3, { updatedAt: 20 }));
    await b.put('foodEntries', entry(5)); // only here
    await applyImport(b, backup, 'merge');

    const got: Record<string, FoodEntry> = Object.fromEntries((await b.getAll('foodEntries')).map((e: FoodEntry) => [e.id, e]));
    expect(got.e1!.quantity.amount).toBe(111);
    expect(got.e2!.quantity.amount).toBe(222);
    expect(got.e3!.deletedAt).toBe(20);
    expect(got.e4).toBeTruthy();
    expect(got.e5).toBeTruthy();
    expect((await currentCounts(b)).foodEntries).toBe(4);
  });
});

describe('atomicity and scale', () => {
  it('leaves the database untouched if the write fails part-way', async () => {
    const a = await freshDb();
    await seed(a, 30);
    const backup = roundtrip(await buildBackup(a));
    const b = await freshDb();
    await b.put('foodEntries', entry(900));
    await b.put('settings', { id: 'settings', units: 'metric', theme: 'light', habitOnly: false, hideBodyTracking: false, backupReminderDays: 14, updatedAt: 1 });
    const before = await dump(b);

    let calls = 0;
    const real = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: unknown, ...args: Parameters<typeof real>) {
      if (++calls === 15) throw new Error('disk exploded');
      return real.apply(this as IDBObjectStore, args);
    });
    await expect(applyImport(b, backup, 'replace')).rejects.toThrow('disk exploded');
    spy.mockRestore();
    expect(await dump(b)).toEqual(before);
  });

  it('imports 50,000 records quickly in a single transaction', async () => {
    const a = await freshDb();
    const tx = a.transaction('foodEntries', 'readwrite');
    for (let i = 0; i < 50_000; i++) void tx.store.put(entry(i));
    await tx.done;
    const text = JSON.stringify(await buildBackup(a));
    const b = await freshDb();
    const t0 = performance.now();
    const parsed = parseBackup(text);
    const t1 = performance.now();
    expect(parsed.ok).toBe(true);
    if (parsed.ok) await applyImport(b, parsed.backup, 'replace');
    const t2 = performance.now();
    expect((await currentCounts(b)).foodEntries).toBe(50_000);
    console.log(`50k records: parse+validate ${Math.round(t1 - t0)} ms, write ${Math.round(t2 - t1)} ms (Node + fake-indexeddb)`);
    expect(t2 - t0).toBeLessThan(15_000);
  }, 60_000);
});

describe('helpers', () => {
  it('names files by local date', () => {
    expect(backupFilename(new Date(2026, 0, 5))).toBe('fitwell-backup-2026-01-05.json');
  });
  it('backup reminder: only with data, only when stale, snoozable', () => {
    const DAY = 86_400_000;
    const base = { now: 100 * DAY, firstDataAt: 50 * DAY, lastBackupAt: undefined, dismissedAt: undefined, everyDays: 14 };
    expect(backupReminderDue({ ...base, firstDataAt: undefined })).toBe(false);
    expect(backupReminderDue(base)).toBe(true);
    expect(backupReminderDue({ ...base, firstDataAt: 95 * DAY })).toBe(false);
    expect(backupReminderDue({ ...base, lastBackupAt: 90 * DAY })).toBe(false);
    expect(backupReminderDue({ ...base, lastBackupAt: 80 * DAY })).toBe(true);
    expect(backupReminderDue({ ...base, dismissedAt: 96 * DAY })).toBe(false);
    expect(backupReminderDue({ ...base, dismissedAt: 90 * DAY })).toBe(true);
  });
});
