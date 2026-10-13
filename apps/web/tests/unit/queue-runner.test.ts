import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createRunner, type RunnerDeps } from '../../src/queue/runner';
import { MAX_ATTEMPTS, freshLookup, reduce } from '../../src/queue/machine';
import { OffError } from '@fitwell/core/off/client';
import { createLookup } from '../../src/off/lookup';
import { Repository } from '../../src/db/repository';
import { openDatabase } from '../../src/db/open';
import type { Candidate, FoodEntry } from '@fitwell/core/schema';

const cand = (id: string, name = 'Oat drink'): Candidate => ({ source: 'off', sourceId: id, name, per100g: { kcal: 46, protein: 1, carbs: 6, fat: 1.5 }, portions: [] });

/** Real Repository on fake-indexeddb, so `mutate` is exercised exactly as in the app. */
async function setup(over: Partial<RunnerDeps> = {}) {
  const db = await openDatabase({ name: `runner-${Math.random()}` });
  let clock = 1_000_000;
  const repo = new Repository<FoodEntry>('foodEntries', { getDb: async () => db, now: () => clock, newId: (() => { let i = 0; return () => `e${++i}`; })() });
  const add = (text: string, over: Partial<FoodEntry> = {}) =>
    repo.create({ day: '2026-10-09', slot: 'lunch', state: 'pending', queryText: text, quantity: { amount: 100, unit: 'g' }, lookup: freshLookup(0), ...over });
  const lookup = vi.fn(async (...args: [string]): Promise<Candidate[]> => (void args, [cand('1')]));
  const deps: RunnerDeps = {
    listPending: () => repo.listByIndex('state', 'pending'),
    apply: async (id, fn) => void (await repo.mutate(id, (cur) => fn(cur))),
    lookup,
    now: () => clock,
    random: () => 0.5,
    isOnline: () => true,
    enabled: () => true,
    ...over,
  };
  return { repo, add, lookup, runner: createRunner(deps), tick: (ms: number) => (clock += ms), now: () => clock, deps };
}

describe('queue runner', () => {
  it('looks up pending entries and parks the matches for confirmation (never resolving)', async () => {
    const { repo, add, runner, lookup } = await setup();
    const a = await add('oat drink');
    const res = await runner.runOnce();
    expect(res.processed).toBe(1);
    expect(lookup).toHaveBeenCalledWith('oat drink');
    const got = (await repo.get(a.id))!;
    expect(got.state).toBe('awaiting_confirmation');
    expect(got.food).toBeUndefined();
    expect(got.nutrition).toBeUndefined();
    expect(got.lookup!.candidates).toHaveLength(1);
  });

  it('no matches → unmatched; it is not asked again', async () => {
    const { repo, add, runner, lookup } = await setup({ lookup: vi.fn(async () => []) });
    const a = await add('zzz');
    await runner.runOnce();
    await runner.runOnce();
    expect((await repo.get(a.id))!.state).toBe('unmatched');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does nothing while offline or when online lookup is switched off, and does not count it as a failure', async () => {
    for (const deps of [{ isOnline: () => false }, { enabled: () => false }]) {
      const { repo, add, runner } = await setup(deps);
      const a = await add('oat');
      await runner.runOnce();
      expect(await repo.get(a.id)).toMatchObject({ state: 'pending', lookup: { attempts: 0 } });
    }
  });

  it('a network drop mid-pass stops quietly without blaming the entry', async () => {
    const { repo, add, runner } = await setup({ lookup: vi.fn(async () => { throw new OffError('offline', 'x'); }) });
    const a = await add('a');
    const b = await add('b');
    const res = await runner.runOnce();
    expect(res.processed).toBe(0);
    expect((await repo.get(a.id))!.lookup!.attempts).toBe(0);
    expect((await repo.get(b.id))!.lookup!.attempts).toBe(0);
  });

  it('a server error is recorded with backoff and retried only when due', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new OffError('server', 'HTTP 500')).mockResolvedValue([cand('1')]);
    const { repo, add, runner, tick, now } = await setup({ lookup });
    const a = await add('oat');
    const first = await runner.runOnce();
    const after = (await repo.get(a.id))!;
    expect(after.state).toBe('pending');
    expect(after.lookup).toMatchObject({ attempts: 1, lastError: 'HTTP 500' });
    expect(after.lookup!.nextAttemptAt).toBeGreaterThan(now());
    expect(first.nextAt).toBe(after.lookup!.nextAttemptAt);

    await runner.runOnce(); // not due yet
    expect(lookup).toHaveBeenCalledTimes(1);
    tick(after.lookup!.nextAttemptAt! - now());
    await runner.runOnce();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect((await repo.get(a.id))!.state).toBe('awaiting_confirmation');
  });

  it('rate limiting pauses the pass and is not charged to the entry', async () => {
    const lookup = vi.fn(async () => { throw new OffError('rate', 'HTTP 503', 45_000); });
    const { repo, add, runner, now } = await setup({ lookup });
    const a = await add('a');
    await add('b');
    const res = await runner.runOnce();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(res.nextAt).toBe(now() + 45_000);
    expect((await repo.get(a.id))!.lookup!.attempts).toBe(0);
  });

  it('gives up after MAX_ATTEMPTS, and a new session starts it fresh', async () => {
    const { repo, add, runner, tick, deps } = await setup({ lookup: vi.fn(async () => { throw new OffError('server', 'x'); }) });
    const a = await add('a');
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await runner.runOnce();
      tick(40 * 60_000);
    }
    expect((await repo.get(a.id))!.lookup).toMatchObject({ attempts: MAX_ATTEMPTS, nextAttemptAt: undefined });
    expect(deps.lookup).toHaveBeenCalledTimes(MAX_ATTEMPTS);

    expect(await runner.retryExhausted()).toBe(1);
    expect((await repo.get(a.id))!.lookup).toMatchObject({ attempts: 0, queryVersion: 1 });
  });

  it('RACE: text edited while the lookup is in flight → the old result is discarded', async () => {
    let release!: (c: Candidate[]) => void;
    const lookup = vi.fn(() => new Promise<Candidate[]>((r) => (release = r)));
    const { repo, add, runner } = await setup({ lookup });
    const a = await add('oat drnk');
    const pass = runner.runOnce();
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled());

    await repo.mutate(a.id, (cur) => reduce(cur, { type: 'USER_EDIT_TEXT', text: 'oat drink' })); // user fixes the typo
    release([cand('stale')]);
    await pass;

    const got = (await repo.get(a.id))!;
    expect(got.state).toBe('pending');
    expect(got.queryText).toBe('oat drink');
    expect(got.lookup).toMatchObject({ queryVersion: 1, attempts: 0 });
    expect(got.lookup!.candidates).toBeUndefined();

    lookup.mockResolvedValueOnce([cand('fresh')]);
    await runner.runOnce(); // the corrected text is looked up on the next pass
    expect((await repo.get(a.id))!.lookup!.candidates![0]!.sourceId).toBe('fresh');
  });

  it('RACE: user resolved or deleted the entry while the lookup was in flight → result ignored', async () => {
    for (const action of ['resolve', 'delete'] as const) {
      let release!: (c: Candidate[]) => void;
      const { repo, add, runner, lookup } = await setup({ lookup: vi.fn(() => new Promise<Candidate[]>((r) => (release = r))) });
      void lookup;
      const a = await add('oat');
      const pass = runner.runOnce();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      if (action === 'resolve') await repo.mutate(a.id, (cur) => reduce(cur, { type: 'USER_RESOLVE' }));
      else await repo.remove(a.id);
      release([cand('1')]);
      await pass;
      const raw = await repo.get(a.id);
      if (action === 'resolve') expect(raw!.state).toBe('resolved');
      else expect(raw).toBeUndefined();
    }
  });

  it('identical texts cost one request (shared lookup), and entries are processed oldest first', async () => {
    const search = vi.fn(async () => [cand('1')]);
    const rows = new Map();
    const shared = createLookup({ client: { search, product: async () => null }, cache: { get: async (k) => rows.get(k), put: async (r) => void rows.set(r.key, r) } });
    const order: string[] = [];
    const { repo, add, runner } = await setup({ lookup: async (t) => (order.push(t), shared.search(t)) });
    const ids = [await add('Oat Milk'), await add('rice'), await add(' oat  milk ')];
    await runner.runOnce();
    expect(order).toEqual(['Oat Milk', 'rice', ' oat  milk ']);
    expect(search).toHaveBeenCalledTimes(2);
    for (const e of ids) expect((await repo.get(e.id))!.state).toBe('awaiting_confirmation');
  });

  it('survives restarts: state lives in the entries, so a fresh runner continues where the last stopped', async () => {
    const { repo, add, deps } = await setup();
    await add('a');
    await add('b');
    const r1 = createRunner({ ...deps, lookup: vi.fn().mockResolvedValueOnce([cand('1')]).mockRejectedValue(new OffError('offline', 'x')) });
    await r1.runOnce(); // "tab closed" after the first one
    const r2 = createRunner(deps);
    const res = await r2.runOnce();
    expect(res.processed).toBe(1);
    expect((await repo.listByIndex('state', 'pending')).length).toBe(0);
  });
});
