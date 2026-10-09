import type { Candidate } from '../../db/schema';
import type { FoodItem } from '../../domain/foods';

export const candidateToFood = (c: Candidate): FoodItem => ({
  ref: { kind: 'off', id: c.sourceId },
  name: c.name,
  brand: c.brand,
  group: 'Open Food Facts',
  per100g: c.per100g,
  portions: c.portions,
});
