import type { Base, FoodEntry, Slot } from '@fitwell/core/schema';
import type { FoodItem } from '@fitwell/core/domain/foods';
import { quantityGrams, scale, type Quantity } from '@fitwell/core/domain/nutrition';

type Fields = Omit<FoodEntry, keyof Base>;

export function entryFields(day: string, slot: Slot, food: FoodItem, quantity: Quantity): Fields {
  const grams = quantityGrams(quantity, food.portions);
  return { day, slot, state: 'resolved', food, quantity, grams, nutrition: scale(food.per100g, grams) };
}
