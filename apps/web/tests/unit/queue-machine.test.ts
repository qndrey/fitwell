import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, MAX_CANDIDATES, backoffMs, freshLookup, isDue, normalizeQuery, reduce, type QueueEvent } from '../../src/queue/machine';
import type { Candidate, EntryState, FoodEntry } from '@fitwell/core/schema';

const cand = (i: number): Candidate => ({ source: 'off', sourceId: String(i), name: `Oat milk ${i}`, per100g: { kcal: 40, protein: 1, carbs: 6, fat: 1.5 }, portions: [] });
type Slice = Pick<FoodEntry, 'state' | 'queryText' | 'lookup'>;
const entry = (state: EntryState, over: Partial<Slice> = {}): Slice => ({ state, queryText: 'oat milk', lookup: freshLookup(0), ...over });

const EVENTS: QueueEvent[] = [
  { type: 'LOOKUP_OK', version: 0, candidates: [cand(1)], at: 1 },
  { type: 'LOOKUP_OK', version: 0, candidates: [], at: 1 },
  { type: 'LOOKUP_FAILED', version: 0, error: 'x', at: 1, random: 0.5 },
  { type: 'USER_EDIT_TEXT', text: 'other' },
  { type: 'USER_RETRY' },
  { type: 'USER_RESOLVE' },
];
const STATES: EntryState[] = ['resolved', 'pending', 'awaiting_confirmation', 'unmatched'];

describe('queue state machine', () => {
  it('INVARIANT: only a user action can resolve an entry (every state × every event)', () => {
    for (const s of STATES) {
      for (const ev of EVENTS) {
        const patch = reduce(entry(s), ev);
        if (patch?.state === 'resolved') expect(ev.type, `${s} + ${ev.type}`).toBe('USER_RESOLVE');
      }
    }
  });

  it('a successful lookup with matches waits for confirmation (suggesting the first)', () => {
    const p = reduce(entry('pending'), { type: 'LOOKUP_OK', version: 0, candidates: [1, 2, 3, 4, 5, 6, 7].map(cand), at: 9 })!;
    expect(p.state).toBe('awaiting_confirmation');
    expect(p.lookup!.candidates).toHaveLength(MAX_CANDIDATES);
    expect(p.lookup).toMatchObject({ suggestedIndex: 0, completedAt: 9 });
  });

  it('no matches → unmatched', () => {
    expect(reduce(entry('pending'), { type: 'LOOKUP_OK', version: 0, candidates: [], at: 1 })).toMatchObject({ state: 'unmatched' });
  });

  it('drops stale results (text edited meanwhile) and results for entries no longer pending', () => {
    expect(reduce(entry('pending', { lookup: freshLookup(3) }), { type: 'LOOKUP_OK', version: 2, candidates: [cand(1)], at: 1 })).toBeNull();
    expect(reduce(entry('resolved'), { type: 'LOOKUP_OK', version: 0, candidates: [cand(1)], at: 1 })).toBeNull();
    expect(reduce(entry('awaiting_confirmation'), { type: 'LOOKUP_OK', version: 0, candidates: [cand(1)], at: 1 })).toBeNull();
    expect(reduce(entry('pending', { lookup: freshLookup(3) }), { type: 'LOOKUP_FAILED', version: 1, error: 'x', at: 1, random: 0.5 })).toBeNull();
  });

  it('a failure stays pending and schedules a retry with growing backoff', () => {
    let e = entry('pending');
    let last = 0;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const p = reduce(e, { type: 'LOOKUP_FAILED', version: 0, error: 'HTTP 500', at: 1000, random: 0.5 })!;
      expect(p.state).toBeUndefined(); // untouched: still pending
      expect(p.lookup!.attempts).toBe(i);
      const wait = p.lookup!.nextAttemptAt! - 1000;
      expect(wait).toBeGreaterThanOrEqual(last);
      last = wait;
      e = { ...e, lookup: p.lookup };
    }
  });

  it('after MAX_ATTEMPTS it stops retrying on its own', () => {
    const e = entry('pending', { lookup: { queryVersion: 0, attempts: MAX_ATTEMPTS - 1 } });
    const p = reduce(e, { type: 'LOOKUP_FAILED', version: 0, error: 'x', at: 1, random: 0.5 })!;
    expect(p.lookup!.attempts).toBe(MAX_ATTEMPTS);
    expect(p.lookup!.nextAttemptAt).toBeUndefined();
    expect(isDue({ ...e, lookup: p.lookup, queryText: 'x' }, 1e12)).toBe(false);
  });

  it('editing the text starts over: pending, new version, no old candidates', () => {
    const e = entry('awaiting_confirmation', { lookup: { queryVersion: 4, attempts: 2, candidates: [cand(1)], suggestedIndex: 0 } });
    expect(reduce(e, { type: 'USER_EDIT_TEXT', text: 'rice milk' })).toEqual({ state: 'pending', queryText: 'rice milk', lookup: { queryVersion: 5, attempts: 0 } });
    expect(reduce(entry('resolved'), { type: 'USER_EDIT_TEXT', text: 'x' })).toBeNull();
  });

  it('retry from unmatched goes back to pending with a new version', () => {
    expect(reduce(entry('unmatched', { lookup: freshLookup(1) }), { type: 'USER_RETRY' })).toMatchObject({ state: 'pending', lookup: { queryVersion: 2, attempts: 0 } });
  });

  it('backoff: 15 s doubling, ±20 %, capped at 30 minutes', () => {
    expect(backoffMs(0, 0.5)).toBe(15_000);
    expect(backoffMs(1, 0.5)).toBe(30_000);
    expect(backoffMs(0, 0)).toBe(12_000);
    expect(backoffMs(0, 0.999)).toBeLessThanOrEqual(18_000);
    expect(backoffMs(20, 0.5)).toBe(30 * 60_000);
    expect(backoffMs(20, 0)).toBe(24 * 60_000);
  });

  it('isDue: only live, pending, non-empty text whose retry time has come', () => {
    const base = { state: 'pending' as const, queryText: 'x', lookup: freshLookup(0), deletedAt: undefined };
    expect(isDue(base, 1)).toBe(true);
    expect(isDue({ ...base, lookup: { ...freshLookup(0), nextAttemptAt: 100 } }, 99)).toBe(false);
    expect(isDue({ ...base, lookup: { ...freshLookup(0), nextAttemptAt: 100 } }, 100)).toBe(true);
    expect(isDue({ ...base, state: 'unmatched' }, 1)).toBe(false);
    expect(isDue({ ...base, queryText: '  ' }, 1)).toBe(false);
    expect(isDue({ ...base, deletedAt: 5 }, 1)).toBe(false);
  });

  it('normalises queries for de-duplication', () => {
    expect(normalizeQuery('  Oat   MILK ')).toBe('oat milk');
    expect(normalizeQuery('ﬁsh')).toBe('fish');
  });
});
