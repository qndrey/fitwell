import { signal } from '@preact/signals';
import { entriesForDay } from '../../db/foodStore';
import { onChange } from '../../db/broadcast';
import type { FoodEntry } from '@fitwell/core/schema';

export const dayEntries = signal<FoodEntry[]>([]);
/** The day whose entries have been read at least once: until then an empty list means "not loaded yet", not "nothing logged". */
export const dayLoaded = signal<string | null>(null);

/** Loads the day and keeps it fresh (own writes, other tabs). Returns a cleanup function. */
export function watchDay(day: string): () => void {
  let live = true;
  const load = () =>
    entriesForDay(day).then((list) => {
      if (live) {
        dayEntries.value = list;
        dayLoaded.value = day;
      }
    });
  dayEntries.value = [];
  dayLoaded.value = null;
  void load();
  const off = onChange((c) => {
    if (c.store === 'foodEntries') void load();
  });
  return () => {
    live = false;
    off();
  };
}
