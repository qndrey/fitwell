import { getDb } from '../../db/open';
import { requestPersistence } from '../../db/persistence';
import { entriesRepo, savedMealsRepo, setFavorite } from '../../db/foodStore';
import type { Base, FoodEntry, SavedMeal, Slot } from '../../db/schema';
import type { FoodItem } from '../../domain/foods';
import { quantityGrams, scale, type Quantity } from '../../domain/nutrition';
import { t } from '../../i18n';
import { showToast } from './toast';

type Fields = Omit<FoodEntry, keyof Base>;

export function entryFields(day: string, slot: Slot, food: FoodItem, quantity: Quantity): Fields {
  const grams = quantityGrams(quantity, food.portions);
  return { day, slot, state: 'resolved', food, quantity, grams, nutrition: scale(food.per100g, grams) };
}

/** Asks the browser to keep our data (once, after the first real save). */
async function maybeRequestPersistence(): Promise<void> {
  try {
    const db = await getDb();
    if (await db.get('meta', 'persistRequested')) return;
    await db.put('meta', { key: 'persistRequested', value: await requestPersistence() });
  } catch {
    /* best effort */
  }
}

export async function logFood(day: string, slot: Slot, food: FoodItem, quantity: Quantity): Promise<FoodEntry> {
  const entry = await entriesRepo.create(entryFields(day, slot, food, quantity));
  void maybeRequestPersistence();
  return entry;
}

export async function changeEntry(entry: FoodEntry, change: { slot: Slot; quantity: Quantity }): Promise<void> {
  if (!entry.food) return;
  const { quantity, grams, nutrition } = entryFields(entry.day, change.slot, entry.food, change.quantity);
  await entriesRepo.update(entry.id, { slot: change.slot, quantity, grams, nutrition });
}

export async function deleteEntry(entry: FoodEntry): Promise<void> {
  await entriesRepo.remove(entry.id);
  showToast(t('food.removed'), { label: t('food.undo'), run: () => void entriesRepo.restore(entry.id) });
}

export async function logMeal(day: string, slot: Slot, meal: SavedMeal): Promise<void> {
  for (const item of meal.items) await logFood(day, slot, item.food, item.quantity);
}

export async function saveSlotAsMeal(entries: FoodEntry[], name: string): Promise<SavedMeal> {
  const items = entries.flatMap((e) => (e.food ? [{ food: e.food, quantity: e.quantity }] : []));
  return savedMealsRepo.create({ name: name.trim(), items });
}

export async function deleteMeal(meal: SavedMeal): Promise<void> {
  await savedMealsRepo.remove(meal.id);
  showToast(t('meal.removed'), { label: t('food.undo'), run: () => void savedMealsRepo.restore(meal.id) });
}

export { setFavorite };
