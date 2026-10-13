import { getDb } from '../db/open';
import { createOffClient } from '@fitwell/core/off/client';
import { createLookup, type LookupCache } from './lookup';
import { RateLimiter } from '@fitwell/core/off/rateLimiter';

const cache: LookupCache = {
  async get(key) {
    return (await (await getDb()).get('offCache', key)) as Awaited<ReturnType<LookupCache['get']>>;
  },
  async put(row) {
    await (await getDb()).put('offCache', row);
  },
};

/** One limiter for the whole app, shared by the background queue and the "Search online" button. */
export const limiter = new RateLimiter();
export const offLookup = createLookup({ client: createOffClient({ limiter }), cache });
