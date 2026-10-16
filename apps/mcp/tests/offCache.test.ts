import { OffError, type OffClient } from '@fitwell/core/off/client';
import type { Candidate } from '@fitwell/core/schema';
import { describe, expect, it } from 'vitest';
import { cachedOff } from '../src/data/offCache';
import { createTestEnv } from './support/env';

const DAY = 86_400_000;
const oats = { id: 'off:123', name: 'Oats' } as unknown as Candidate;

/** An Open Food Facts client that answers from a script: a list of candidates, or an error. */
function scripted(answers: (Candidate[] | Error)[]): OffClient & { calls: number } {
  const c = {
    calls: 0,
    async search() {
      const a = answers[c.calls++];
      if (!a || a instanceof Error) throw a ?? new Error('no more answers');
      return a;
    },
    async product() {
      return null;
    },
  };
  return c;
}

describe('Open Food Facts cache', () => {
  it('serves a fresh cached answer without asking again', async () => {
    const { env } = createTestEnv();
    const off = scripted([[oats]]);
    const cache = cachedOff(env.DB, off, () => 0);
    await cache.search('oats');
    expect(await cache.search(' OATS ')).toEqual([oats]);
    expect(off.calls).toBe(1);
  });

  it('falls back to an older answer when Open Food Facts fails', async () => {
    const { env } = createTestEnv();
    let t = 0;
    const off = scripted([[oats], new OffError('rate', 'HTTP 503', 30_000)]);
    const cache = cachedOff(env.DB, off, () => t);
    await cache.search('oats');
    t = 30 * DAY; // long past the 7 days
    expect(await cache.search('oats')).toEqual([oats]);
    expect(off.calls).toBe(2);
  });

  it('still reports the error when there is nothing useful cached', async () => {
    const { env } = createTestEnv();
    let t = 0;
    const off = scripted([[], new OffError('server', 'HTTP 500')]);
    const cache = cachedOff(env.DB, off, () => t);
    await cache.search('unknown thing');
    t = 2 * DAY;
    await expect(cache.search('unknown thing')).rejects.toThrow('HTTP 500');
    await expect(cachedOff(env.DB, scripted([new OffError('offline', 'down')]), () => 0).search('never seen')).rejects.toThrow('down');
  });
});
