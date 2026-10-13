import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/open';
import { Repository } from '../../src/db/repository';
import { onChange } from '../../src/db/broadcast';
import type { Base } from '@fitwell/core/schema';

// The `goals` store is a convenient keyPath:'id' store for exercising the generic repo.
interface Thing extends Base { label: string }

async function setup() {
  const db = await openDatabase({ name: `repo-${Math.random()}` });
  let t = 1000;
  let i = 0;
  const repo = new Repository<Thing>('goals', { getDb: async () => db, now: () => t, newId: () => `id-${++i}` });
  return { repo, setNow: (v: number) => (t = v) };
}

describe('Repository', () => {
  it('stamps id, timestamps and rev on create', async () => {
    const { repo } = await setup();
    const r = await repo.create({ label: 'a' });
    expect(r).toMatchObject({ id: 'id-1', label: 'a', createdAt: 1000, updatedAt: 1000, rev: 1 });
    expect(await repo.get('id-1')).toEqual(r);
  });

  it('update bumps rev and updatedAt, keeps createdAt', async () => {
    const { repo, setNow } = await setup();
    const r = await repo.create({ label: 'a' });
    setNow(2000);
    const u = await repo.update(r.id, { label: 'b' });
    expect(u).toMatchObject({ label: 'b', createdAt: 1000, updatedAt: 2000, rev: 2 });
  });

  it('updatedAt never goes backwards if the clock does', async () => {
    const { repo, setNow } = await setup();
    const r = await repo.create({ label: 'a' });
    setNow(500);
    expect((await repo.update(r.id, { label: 'b' })).updatedAt).toBe(1000);
  });

  it('soft-deletes: hidden from get/list, row remains as a tombstone', async () => {
    const { repo, setNow } = await setup();
    const a = await repo.create({ label: 'a' });
    await repo.create({ label: 'b' });
    setNow(3000);
    await repo.remove(a.id);
    expect(await repo.get(a.id)).toBeUndefined();
    expect((await repo.list()).map((x) => x.label)).toEqual(['b']);
    await expect(repo.update(a.id, { label: 'x' })).rejects.toThrow(/not found/);
    await repo.remove(a.id); // idempotent
  });

  it('publishes changes only after commit', async () => {
    const { repo } = await setup();
    const seen: string[] = [];
    const off = onChange((c) => seen.push(`${c.store}:${c.ids[0]}`));
    const r = await repo.create({ label: 'a' });
    await repo.update(r.id, { label: 'b' });
    await repo.remove(r.id);
    off();
    expect(seen).toEqual(['goals:id-1', 'goals:id-1', 'goals:id-1']);
  });
});

describe('Repository extras', () => {
  it('upsert creates, replaces, and revives a tombstone while keeping history', async () => {
    const { repo, setNow } = await setup();
    const a = await repo.upsert('fav:1', { label: 'a' });
    expect(a).toMatchObject({ id: 'fav:1', rev: 1, createdAt: 1000 });
    setNow(2000);
    await repo.remove('fav:1');
    expect(await repo.get('fav:1')).toBeUndefined();
    setNow(3000);
    const b = await repo.upsert('fav:1', { label: 'b' });
    expect(b).toMatchObject({ label: 'b', createdAt: 1000, updatedAt: 3000, rev: 3 });
    expect(b.deletedAt).toBeUndefined();
    expect((await repo.list()).length).toBe(1);
  });

  it('restore undoes a soft delete and is a no-op on live records', async () => {
    const { repo } = await setup();
    const a = await repo.create({ label: 'a' });
    await repo.remove(a.id);
    expect((await repo.restore(a.id))?.deletedAt).toBeUndefined();
    expect((await repo.get(a.id))?.label).toBe('a');
    expect((await repo.restore(a.id))?.rev).toBe(3);
    expect(await repo.restore('missing')).toBeUndefined();
  });
});
