import { getDb } from '../../db/open';
import { requestPersistence } from '../../db/persistence';
import { cacheOnlineFood, entriesRepo, savedMealsRepo, setFavorite } from '../../db/foodStore';
import { freshLookup, reduce } from '../../queue/machine';
import { kickQueue } from '../../queue';
import type { FoodEntry, SavedMeal, Slot } from '../../db/schema';
import type { FoodItem } from '../../domain/foods';
import { quantityGrams, scale, type Nutrients, type Quantity } from '../../domain/nutrition';
import { t } from '../../i18n';
import { showToast } from './toast';

export { entryFields } from './entry';
import { entryFields } from './entry';

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

// ---- Unresolved entries (pending lookup, awaiting confirmation, unmatched) ----

/** Log free text with an amount in grams. No nutrition yet: a background lookup will suggest matches. */
export async function logPending(day: string, slot: Slot, text: string, grams: number): Promise<FoodEntry> {
  const entry = await entriesRepo.create({
    day,
    slot,
    state: 'pending',
    queryText: text.trim(),
    quantity: { amount: grams, unit: 'g' },
    lookup: freshLookup(0),
  });
  void maybeRequestPersistence();
  kickQueue();
  return entry;
}

/** Change the text and/or the amount of an unresolved entry. New text restarts the lookup (and invalidates any in flight). */
export async function editUnresolved(entry: FoodEntry, change: { text: string; grams: number }): Promise<void> {
  const textChanged = change.text.trim() !== (entry.queryText ?? '');
  await entriesRepo.mutate(entry.id, (cur) => {
    const quantity = { amount: change.grams, unit: 'g' as const };
    if (!textChanged) return cur.state === 'resolved' ? null : { quantity };
    const patch = reduce(cur, { type: 'USER_EDIT_TEXT', text: change.text.trim() });
    return patch && { ...patch, quantity };
  });
  if (textChanged) kickQueue();
}

export async function retryLookup(entry: FoodEntry): Promise<void> {
  await entriesRepo.mutate(entry.id, (cur) => reduce(cur, { type: 'USER_RETRY' }));
  kickQueue();
}

/** The user chose a food (a suggested match, or one found by searching): this is the only way out of "unresolved". */
export async function resolveWithFood(entry: FoodEntry, food: FoodItem): Promise<void> {
  const grams = entry.quantity.unit === 'g' ? entry.quantity.amount : quantityGrams(entry.quantity, food.portions);
  await entriesRepo.mutate(entry.id, (cur) => {
    const patch = reduce(cur, { type: 'USER_RESOLVE' });
    return patch && { ...patch, food, grams, nutrition: scale(food.per100g, grams), manual: undefined };
  });
  if (food.ref.kind === 'off') await cacheOnlineFood(food); // searchable offline from now on
}

/** The user typed the totals for this amount by hand. */
export async function resolveWithValues(entry: FoodEntry, nutrition: Nutrients): Promise<void> {
  await entriesRepo.mutate(entry.id, (cur) => {
    const patch = reduce(cur, { type: 'USER_RESOLVE' });
    return patch && { ...patch, nutrition, grams: cur.quantity.amount, manual: true, food: undefined };
  });
}

export async function updateManualValues(entry: FoodEntry, nutrition: Nutrients, grams: number): Promise<void> {
  await entriesRepo.mutate(entry.id, (cur) => (cur.manual ? { nutrition, grams, quantity: { amount: grams, unit: 'g' as const } } : null));
}
