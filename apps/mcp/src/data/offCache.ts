import type { OffClient } from '@fitwell/core/off/client';
import type { Priority } from '@fitwell/core/off/rateLimiter';
import type { Candidate } from '@fitwell/core/schema';

const DAY = 86_400_000;
const TTL_MS = 7 * DAY;
const EMPTY_TTL_MS = DAY;

const normalize = (term: string) => term.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Open Food Facts behind a shared D1 cache (7 days; empty answers 1 day), as in the web app. The cache
 * is not personal: it holds only what OFF returned for a search text or barcode. When OFF fails (it often
 * answers 503 under load), an older cached answer is served instead of the error: product data rarely changes.
 */
export function cachedOff(db: D1Database, client: OffClient, now: () => number = Date.now): OffClient {
  async function cached(key: string, fetchFresh: () => Promise<Candidate[]>): Promise<Candidate[]> {
    const row = await db.prepare('SELECT fetched_at, candidates FROM off_cache WHERE key = ?').bind(key).first<{ fetched_at: number; candidates: string }>();
    const old = row ? (JSON.parse(row.candidates) as Candidate[]) : null;
    if (row && old && now() - row.fetched_at < (old.length ? TTL_MS : EMPTY_TTL_MS)) return old;
    let fresh: Candidate[];
    try {
      fresh = await fetchFresh();
    } catch (e) {
      if (old?.length) return old; // stale but real; an old empty answer is no better than the error
      throw e;
    }
    await db
      .prepare('INSERT INTO off_cache (key, fetched_at, candidates) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, candidates = excluded.candidates')
      .bind(key, now(), JSON.stringify(fresh))
      .run();
    return fresh;
  }
  return {
    search: (term: string, priority?: Priority) => cached(`q:${normalize(term)}`, () => client.search(term, priority)),
    product: async (barcode: string, priority?: Priority) => (await cached(`b:${barcode}`, async () => {
      const c = await client.product(barcode, priority);
      return c ? [c] : [];
    }))[0] ?? null,
  };
}
