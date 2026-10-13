import { sum, type Nutrients } from './nutrition';
import type { FoodEntry } from '../schema';

export interface DayTotals extends Nutrients {
  resolvedCount: number;
  pendingCount: number;
}

/** Totals include resolved entries only; everything else is counted as pending. */
export function dayTotals(entries: FoodEntry[]): DayTotals {
  const resolved = entries.filter((e) => e.state === 'resolved' && e.nutrition);
  const total = sum(resolved.map((e) => e.nutrition!));
  return { ...total, resolvedCount: resolved.length, pendingCount: entries.length - resolved.length };
}

export function slotTotals(entries: FoodEntry[], slot: FoodEntry['slot']): Nutrients {
  return sum(entries.filter((e) => e.slot === slot && e.state === 'resolved' && e.nutrition).map((e) => e.nutrition!));
}
