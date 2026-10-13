import type { Candidate } from '@fitwell/core/schema';
import { normalizeQuery } from '../queue/machine';
import { looksLikeBarcode, normalizeBarcode } from '@fitwell/core/ean';
import type { OffClient } from '@fitwell/core/off/client';
import type { Priority } from '@fitwell/core/off/rateLimiter';

export interface CacheRow {
  key: string;
  fetchedAt: number;
  candidates: Candidate[];
}

export interface LookupCache {
  get(key: string): Promise<CacheRow | undefined>;
  put(row: CacheRow): Promise<void>;
}

const DAY = 86_400_000;
export const TTL_MS = 7 * DAY;
export const EMPTY_TTL_MS = 1 * DAY;

/**
 * Text → candidates with a persistent cache (7 days; empty answers 1 day) and in-flight de-duplication,
 * so the same text typed three times is one request, even across reloads.
 */
export function createLookup(deps: { client: OffClient; cache: LookupCache; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, Promise<Candidate[]>>();

  return {
    async search(term: string, priority: Priority = 'background'): Promise<Candidate[]> {
      // Digits that are a valid barcode go to the exact product lookup; everything else is a text search.
      const barcode = looksLikeBarcode(term) ? normalizeBarcode(term) : null;
      const key = barcode ? `barcode:${barcode}` : normalizeQuery(term);
      const hit = await deps.cache.get(key);
      if (hit && now() - hit.fetchedAt < (hit.candidates.length ? TTL_MS : EMPTY_TTL_MS)) return hit.candidates;
      let p = inflight.get(key);
      if (!p) {
        const request = barcode ? deps.client.product(barcode, priority).then((c) => (c ? [c] : [])) : deps.client.search(key, priority);
        p = request
          .then(async (candidates) => {
            await deps.cache.put({ key, fetchedAt: now(), candidates });
            return candidates;
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      return p;
    },
  };
}
