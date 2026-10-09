export interface Change {
  store: string;
  ids: string[];
}

const listeners = new Set<(c: Change) => void>();

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('fitwell');
// Don't keep Node (tests) alive; no-op in browsers.
(channel as unknown as { unref?: () => void } | null)?.unref?.();

function emit(c: Change) {
  for (const fn of listeners) fn(c);
}

channel?.addEventListener('message', (e: MessageEvent<Change>) => emit(e.data));

/** Call only after the IndexedDB transaction has committed. */
export function publishChange(c: Change): void {
  emit(c);
  channel?.postMessage(c);
}

export function onChange(fn: (c: Change) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
