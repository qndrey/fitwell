import { createOffClient, type OffClient, type OffFetch } from '@fitwell/core/off/client';
import { RateLimiter } from '@fitwell/core/off/rateLimiter';

// Open Food Facts asks server-side apps to identify themselves: name/version (contact).
const USER_AGENT = 'FitwellMCP/0.1 (+https://github.com/qndrey/fitwell)';

/**
 * The core client is written for browsers (no cookies, no referrer). On a server we send a
 * User-Agent instead and pass only the abort signal: Workers don't implement `credentials`.
 */
const serverFetch: OffFetch = (url, init) => fetch(url, { signal: init.signal, headers: { 'User-Agent': USER_AGENT } });

let client: OffClient | null = null;

/**
 * One limiter per Worker isolate, as polite as the web app (search is limited to 10 req/min/IP by OFF).
 * Isolates are not global, so this is best effort; the OFF lookup cache in D1 (next phase) carries the load.
 */
export function offClient(): OffClient {
  client ??= createOffClient({ limiter: new RateLimiter(), fetch: serverFetch });
  return client;
}
