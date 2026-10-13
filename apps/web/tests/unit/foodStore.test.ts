import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/db/open';

// foodStore uses the shared app connection; point it at a test DB.
vi.mock('../../src/db/open', async (orig) => {
  const real = await orig<typeof import('../../src/db/open')>();
  let p: Promise<unknown> | null = null;
  return { ...real, getDb: () => (p ??= real.openDatabase({ name: 'foodstore-test' })) };
});

const { entriesRepo, entriesForDay, recentFoods, setFavorite, favoritesRepo, customFoodItems, customFoodsRepo } = await import('../../src/db/foodStore');
const { entryFields } = await import('../../src/features/food/entry');

const food = (id: string, name: string) => ({
  ref: { kind: 'bundled' as const, id },
  name,
  per100g: { kcal: 100, protein: 10, carbs: 10, fat: 1 },
  portions: [{ label: 'piece', grams: 50 }],
});

beforeAll(() => void openDatabase);

describe('food store', () => {
  it('builds entry snapshots with grams and nutrition', () => {
    const f = entryFields('2026-10-09', 'lunch', food('a', 'A'), { amount: 3, unit: 'portion', portionLabel: 'piece' });
    expect(f).toMatchObject({ state: 'resolved', grams: 150, nutrition: { kcal: 150, protein: 15, carbs: 15, fat: 1.5 } });
  });

  it('lists a day in logging order and ignores deleted entries', async () => {
    const a = await entriesRepo.create(entryFields('2026-10-09', 'lunch', food('a', 'A'), { amount: 100, unit: 'g' }));
    await new Promise((r) => setTimeout(r, 2));
    const b = await entriesRepo.create(entryFields('2026-10-09', 'dinner', food('b', 'B'), { amount: 50, unit: 'g' }));
    await entriesRepo.create(entryFields('2026-10-10', 'lunch', food('c', 'C'), { amount: 10, unit: 'g' }));
    expect((await entriesForDay('2026-10-09')).map((e) => e.food?.name)).toEqual(['A', 'B']);
    await entriesRepo.remove(b.id);
    expect((await entriesForDay('2026-10-09')).map((e) => e.id)).toEqual([a.id]);
  });

  it('recents are distinct, newest first, carry the last quantity, skip deleted', async () => {
    const mk = async (id: string, grams: number) => {
      await new Promise((r) => setTimeout(r, 2));
      return entriesRepo.create(entryFields('2026-11-01', 'snacks', food(id, id.toUpperCase()), { amount: grams, unit: 'g' }));
    };
    await mk('r1', 10);
    await mk('r2', 20);
    await mk('r1', 30);
    const gone = await mk('r3', 40);
    await entriesRepo.remove(gone.id);
    const recent = await recentFoods(5);
    const ids = recent.map((r) => r.food.ref.id);
    expect(ids.slice(0, 2)).toEqual(['r1', 'r2']);
    expect(ids).not.toContain('r3');
    expect(recent[0]!.quantity.amount).toBe(30);
  });

  it('toggles favorites and lists custom foods', async () => {
    const f = food('fav', 'Fav');
    await setFavorite(f, true);
    await setFavorite(f, true);
    expect((await favoritesRepo.list()).filter((x) => x.food.name === 'Fav')).toHaveLength(1);
    await setFavorite(f, false);
    expect((await favoritesRepo.list()).filter((x) => x.food.name === 'Fav')).toHaveLength(0);
    await setFavorite(f, true);
    expect((await favoritesRepo.list()).filter((x) => x.food.name === 'Fav')).toHaveLength(1);

    await customFoodsRepo.create({ name: 'Zed', per100g: f.per100g, portions: [] });
    await customFoodsRepo.create({ name: 'Abe', per100g: f.per100g, portions: [] });
    expect((await customFoodItems()).map((c) => c.name)).toEqual(['Abe', 'Zed']);
  });
});
