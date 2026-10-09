import { entriesRepo } from '../db/foodStore';
import { onChange } from '../db/broadcast';
import { offLookup } from '../off';
import { settings } from '../state';
import { createRunner } from './runner';

const runner = createRunner({
  listPending: () => entriesRepo.listByIndex('state', 'pending'),
  apply: async (id, fn) => void (await entriesRepo.mutate(id, (cur) => fn(cur))),
  lookup: (text) => offLookup.search(text, 'background'),
  now: Date.now,
  random: Math.random,
  isOnline: () => navigator.onLine !== false,
  enabled: () => settings.value.onlineLookup,
});

let kickFn: (() => void) | null = null;
/** Ask the queue to look at its entries now (e.g. right after a pending entry was created). */
export const kickQueue = (): void => kickFn?.();

/** One runner per browser profile: other tabs skip while this one holds the lock. */
async function withLock(fn: () => Promise<void>): Promise<void> {
  if (!navigator.locks) return fn();
  await navigator.locks.request('fitwell-queue', { ifAvailable: true }, async (lock) => {
    if (lock) await fn();
  });
}

export function startQueue(): () => void {
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function kick(): Promise<void> {
    if (running) {
      again = true; // something changed while we were busy: look once more afterwards
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await withLock(async () => {
          const { nextAt } = await runner.runOnce();
          clearTimeout(timer);
          if (nextAt !== undefined) timer = setTimeout(() => void kick(), Math.min(30 * 60_000, Math.max(1000, nextAt - Date.now())));
        });
      } while (again);
    } finally {
      running = false;
    }
  }
  kickFn = () => void kick();

  const onOnline = () => void kick();
  const onVisible = () => document.visibilityState === 'visible' && void kick();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const offChange = onChange((c) => {
    if (c.store !== 'foodEntries' && c.store !== 'settings') return;
    clearTimeout(debounce);
    debounce = setTimeout(() => void kick(), 300);
  });

  // App start: give up-to-date fresh attempts to anything that gave up last session, then go.
  void withLock(async () => void (await runner.retryExhausted())).then(() => kick());

  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    offChange();
    clearTimeout(timer);
    clearTimeout(debounce);
    kickFn = null;
  };
}
