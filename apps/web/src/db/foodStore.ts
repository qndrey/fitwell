import { getDb } from './open';
import { Repository } from './repository';
import type { CachedFood, CustomFood, Favorite, FoodEntry, SavedMeal } from './schema';
import { refKey, type FoodItem } from '../domain/foods';
import type { Quantity } from '../domain/nutrition';

const deps = { getDb };
export const entriesRepo = new Repository<FoodEntry>('foodEntries', deps);
export const customFoodsRepo = new Repository<CustomFood>('customFoods', deps);
export const favoritesRepo = new Repository<Favorite>('favorites', deps);
export const savedMealsRepo = new Repository<SavedMeal>('savedMeals', deps);
export const cachedFoodsRepo = new Repository<CachedFood>('foods', deps);

/** Foods fetched online earlier: searchable offline, ranked after the user's own foods. */
export async function cachedFoodItems(): Promise<FoodItem[]> {
  const list = await cachedFoodsRepo.list();
  return list.sort((a, b) => b.fetchedAt - a.fetchedAt).map((c) => c.food);
}

export async function cacheOnlineFood(food: FoodItem): Promise<void> {
  await cachedFoodsRepo.upsert(`off:${food.ref.id}`, { food, fetchedAt: Date.now() });
}

/** Everything not yet resolved, any day, newest day first. */
export async function unresolvedEntries(): Promise<FoodEntry[]> {
  const lists = await Promise.all((['pending', 'awaiting_confirmation', 'unmatched'] as const).map((s) => entriesRepo.listByIndex('state', s)));
  return lists.flat().sort((a, b) => (a.day === b.day ? a.createdAt - b.createdAt : a.day < b.day ? 1 : -1));
}

export async function entriesForDay(day: string): Promise<FoodEntry[]> {
  const list = await entriesRepo.listByIndex('day', day);
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

export interface RecentFood {
  food: FoodItem;
  quantity: Quantity;
}

/** Most recently logged distinct foods (with the quantity last used), newest first. */
export async function recentFoods(limit = 30): Promise<RecentFood[]> {
  const db = await getDb();
  const seen = new Set<string>();
  const out: RecentFood[] = [];
  let cursor = await db.transaction('foodEntries').store.index('createdAt').openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    const e = cursor.value as FoodEntry;
    if (e.deletedAt === undefined && e.food && e.state === 'resolved') {
      const key = refKey(e.food.ref);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ food: e.food, quantity: e.quantity });
      }
    }
    cursor = await cursor.continue();
  }
  return out;
}

export const favoriteId = (food: FoodItem): string => `fav:${refKey(food.ref)}`;

export async function setFavorite(food: FoodItem, on: boolean): Promise<void> {
  if (on) await favoritesRepo.upsert(favoriteId(food), { food });
  else await favoritesRepo.remove(favoriteId(food));
}

export async function customFoodItems(): Promise<FoodItem[]> {
  const list = await customFoodsRepo.list();
  return list
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ ref: { kind: 'custom', id: c.id }, name: c.name, brand: c.brand, per100g: c.per100g, portions: c.portions }));
}

/** When the user first created anything; undefined if the app holds no data yet. Used by the backup reminder. */
export async function firstDataAt(): Promise<number | undefined> {
  const db = await getDb();
  const cursor = await db.transaction('foodEntries').store.index('createdAt').openCursor();
  return cursor ? (cursor.value as FoodEntry).createdAt : undefined;
}
