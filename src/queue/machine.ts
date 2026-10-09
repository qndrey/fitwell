import type { Candidate, EntryState, FoodEntry, LookupInfo } from '../db/schema';

/**
 * Pure state machine for entries that are not resolved yet (PLAN §8).
 *
 *   pending ──lookup ok, ≥1 match──▶ awaiting_confirmation
 *      │  ▲ ──lookup ok, no match──▶ unmatched
 *      │  └── edit text / retry ─────────┘
 *      └── lookup fails: stays pending, retried with backoff
 *   any unresolved ──USER_* action──▶ resolved
 *
 * Invariant (tested): `resolved` is reachable only through a USER_* event. A lookup can never resolve an entry.
 */

export const MAX_CANDIDATES = 5;
export const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 30 * 60_000;

export type QueueEvent =
  | { type: 'LOOKUP_OK'; version: number; candidates: Candidate[]; at: number }
  | { type: 'LOOKUP_FAILED'; version: number; error: string; at: number; random: number }
  | { type: 'USER_EDIT_TEXT'; text: string }
  | { type: 'USER_RETRY' }
  | { type: 'USER_RESOLVE' };

/** Fields of an entry the machine is allowed to change. `null` means "ignore this event". */
export type Patch = Partial<Pick<FoodEntry, 'state' | 'queryText' | 'lookup'>>;

export const isUnresolved = (s: EntryState): boolean => s !== 'resolved';

export const freshLookup = (version = 0): LookupInfo => ({ queryVersion: version, attempts: 0 });

/** 15 s · 2^attempts, capped at 30 min, ±20 % jitter (`random` in [0,1)). */
export function backoffMs(attempts: number, random = 0.5): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts));
  return Math.round(base * (0.8 + 0.4 * random));
}

type Slice = Pick<FoodEntry, 'state' | 'queryText' | 'lookup'>;

export function reduce(entry: Slice, event: QueueEvent): Patch | null {
  const lookup = entry.lookup ?? freshLookup();
  switch (event.type) {
    case 'LOOKUP_OK': {
      // Stale or irrelevant results are dropped: the user edited the text, or already decided.
      if (entry.state !== 'pending' || event.version !== lookup.queryVersion) return null;
      const candidates = event.candidates.slice(0, MAX_CANDIDATES);
      return candidates.length
        ? { state: 'awaiting_confirmation', lookup: { ...lookup, candidates, suggestedIndex: 0, completedAt: event.at, lastError: undefined, nextAttemptAt: undefined } }
        : { state: 'unmatched', lookup: { ...lookup, candidates: [], completedAt: event.at, lastError: undefined, nextAttemptAt: undefined } };
    }
    case 'LOOKUP_FAILED': {
      if (entry.state !== 'pending' || event.version !== lookup.queryVersion) return null;
      const attempts = lookup.attempts + 1;
      return {
        lookup: {
          ...lookup,
          attempts,
          lastError: event.error,
          // After MAX_ATTEMPTS we stop retrying until the next app start or a manual retry.
          nextAttemptAt: attempts >= MAX_ATTEMPTS ? undefined : event.at + backoffMs(attempts, event.random),
        },
      };
    }
    case 'USER_EDIT_TEXT': {
      if (entry.state === 'resolved') return null;
      return { state: 'pending', queryText: event.text, lookup: freshLookup(lookup.queryVersion + 1) };
    }
    case 'USER_RETRY': {
      if (entry.state === 'resolved') return null;
      return { state: 'pending', lookup: freshLookup(lookup.queryVersion + 1) };
    }
    case 'USER_RESOLVE':
      // The caller attaches the chosen food / typed values; the machine only decides the state.
      return entry.state === 'resolved' ? null : { state: 'resolved', lookup: undefined };
  }
}

/** Entries the background runner should look up now. */
export function isDue(entry: Pick<FoodEntry, 'state' | 'lookup' | 'queryText' | 'deletedAt'>, now: number): boolean {
  if (entry.deletedAt !== undefined || entry.state !== 'pending' || !entry.queryText?.trim()) return false;
  const l = entry.lookup;
  if (!l) return true;
  if (l.attempts >= MAX_ATTEMPTS) return false;
  return l.nextAttemptAt === undefined || l.nextAttemptAt <= now;
}

export const normalizeQuery = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
