import { signal } from '@preact/signals';
import { entriesForDay } from '../../db/foodStore';
import { onChange } from '../../db/broadcast';
import type { FoodEntry } from '@fitwell/core/schema';

export const dayEntries = signal<FoodEntry[]>([]);

/** Loads the day and keeps it fresh (own writes, other tabs). Returns a cleanup function. */
export function watchDay(day: string): () => void {
  let live = true;
  const load = () =>
    entriesForDay(day).then((list) => {
      if (live) dayEntries.value = list;
    });
  dayEntries.value = [];
  void load();
  const off = onChange((c) => {
    if (c.store === 'foodEntries') void load();
  });
  return () => {
    live = false;
    off();
  };
}
