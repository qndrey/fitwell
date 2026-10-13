import { signal } from '@preact/signals';
import { unresolvedEntries } from '../../db/foodStore';
import { onChange } from '../../db/broadcast';
import type { FoodEntry } from '@fitwell/core/schema';

/** Everything not yet resolved, any day. Drives the "N items to confirm" badge and the review screen. */
export const unresolved = signal<FoodEntry[]>([]);

/** Entries that need the user (a match to confirm, or nothing found). `pending` ones are still waiting on the lookup. */
export const toConfirmCount = () => unresolved.value.filter((e) => e.state !== 'pending').length;

export function watchUnresolved(): () => void {
  let live = true;
  const load = () =>
    unresolvedEntries().then((list) => {
      if (live) unresolved.value = list;
    });
  void load();
  const off = onChange((c) => {
    if (c.store === 'foodEntries') void load();
  });
  return () => {
    live = false;
    off();
  };
}
