import { signal } from '@preact/signals';

const KEY = 'fitwell-collapsed-meals';

function load(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Which meals are folded away on Today. A preference of this device, kept between visits and the same on every day. */
export const collapsedMeals = signal<Set<string>>(load());

export function setMealCollapsed(slot: string, on: boolean): void {
  const next = new Set(collapsedMeals.value);
  if (on) next.add(slot);
  else next.delete(slot);
  collapsedMeals.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* storage may be blocked: it still works for this visit */
  }
}
