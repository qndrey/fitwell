import type { Candidate, FoodEntry } from '@fitwell/core/schema';
import { OffError } from '@fitwell/core/off/client';
import { MAX_ATTEMPTS, isDue, reduce, type Patch } from './machine';

export interface RunnerDeps {
  /** All entries currently in the `pending` state. */
  listPending(): Promise<FoodEntry[]>;
  /** Atomic read-modify-write on one entry; fn returns null to leave it untouched. */
  apply(id: string, fn: (cur: FoodEntry) => Patch | null): Promise<void>;
  lookup(text: string): Promise<Candidate[]>;
  now(): number;
  random(): number;
  isOnline(): boolean;
  enabled(): boolean;
}

export interface RunResult {
  processed: number;
  /** When the runner should wake up again on its own (earliest scheduled retry), if any. */
  nextAt?: number;
}

const RATE_PAUSE_MS = 30_000;

/**
 * One pass over the queue. Network trouble stops the pass without blaming the entry (we simply try
 * again on the next trigger); a failing *request* is recorded with backoff; results are applied only if
 * the entry is still waiting for exactly this text (see machine.ts).
 */
export function createRunner(d: RunnerDeps) {
  return {
    async runOnce(): Promise<RunResult> {
      let processed = 0;
      if (!d.enabled() || !d.isOnline()) return { processed, nextAt: await this.nextWake() };

      const due = (await d.listPending()).filter((e) => isDue(e, d.now())).sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of due) {
        if (!d.enabled() || !d.isOnline()) break;
        const version = entry.lookup?.queryVersion ?? 0;
        try {
          const candidates = await d.lookup(entry.queryText!);
          await d.apply(entry.id, (cur) => reduce(cur, { type: 'LOOKUP_OK', version, candidates, at: d.now() }));
          processed++;
        } catch (e) {
          const kind = e instanceof OffError ? e.kind : 'server';
          if (kind === 'offline') break; // not the entry's fault: wait for the next trigger
          if (kind === 'rate') return { processed, nextAt: d.now() + ((e as OffError).retryAfterMs ?? RATE_PAUSE_MS) };
          const error = e instanceof Error ? e.message : String(e);
          await d.apply(entry.id, (cur) => reduce(cur, { type: 'LOOKUP_FAILED', version, error, at: d.now(), random: d.random() }));
        }
      }
      return { processed, nextAt: await this.nextWake() };
    },

    async nextWake(): Promise<number | undefined> {
      const times = (await d.listPending())
        .filter((e) => e.deletedAt === undefined && e.lookup && e.lookup.attempts < MAX_ATTEMPTS && e.lookup.nextAttemptAt !== undefined)
        .map((e) => e.lookup!.nextAttemptAt!);
      return times.length ? Math.min(...times) : undefined;
    },

    /** Entries that gave up in an earlier session get a fresh start when the app is opened again. */
    async retryExhausted(): Promise<number> {
      const stuck = (await d.listPending()).filter((e) => (e.lookup?.attempts ?? 0) >= MAX_ATTEMPTS);
      for (const e of stuck) await d.apply(e.id, (cur) => reduce(cur, { type: 'USER_RETRY' }));
      return stuck.length;
    },
  };
}
