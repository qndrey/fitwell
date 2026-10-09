import type { Candidate } from '../db/schema';
import { toCandidates } from './normalize';
import type { Priority, RateLimiter } from './rateLimiter';

export type OffErrorKind = 'offline' | 'rate' | 'server' | 'bad';

export class OffError extends Error {
  constructor(
    readonly kind: OffErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface OffClient {
  search(term: string, priority?: Priority): Promise<Candidate[]>;
}

const FIELDS = 'code,product_name,brands,nutriments,serving_quantity';
export const OFF_ORIGIN = 'https://world.openfoodfacts.org';

function retryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  const n = h === null ? NaN : Number(h);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) * 1000 : undefined;
}

/**
 * The only place that talks to Open Food Facts. Sends nothing but the search text: no cookies, no
 * referrer, no custom headers (so no CORS preflight). Uses the documented legacy full-text search,
 * the one endpoint that returns nutrition; swap the URL/parsing here if OFF moves it.
 */
export function createOffClient(deps: { limiter: RateLimiter; fetch?: typeof fetch; origin?: string; timeoutMs?: number }): OffClient {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const origin = deps.origin ?? OFF_ORIGIN;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  async function request(term: string): Promise<Candidate[]> {
    const url = `${origin}/cgi/search.pl?search_terms=${encodeURIComponent(term.slice(0, 100))}&search_simple=1&action=process&json=1&page_size=10&fields=${FIELDS}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new OffError('server', 'timeout');
      throw new OffError('offline', 'network unreachable'); // fetch rejects with TypeError when offline/blocked
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 || res.status === 503) {
      const wait = retryAfter(res) ?? 60_000;
      deps.limiter.pauseFor(wait);
      throw new OffError('rate', `HTTP ${res.status}`, wait);
    }
    if (res.status >= 500) throw new OffError('server', `HTTP ${res.status}`);
    if (!res.ok) throw new OffError('bad', `HTTP ${res.status}`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new OffError('bad', 'not JSON');
    }
    const products = (json as { products?: unknown }).products;
    if (!Array.isArray(products)) throw new OffError('bad', 'unexpected response');
    return toCandidates(products);
  }

  return { search: (term, priority = 'background') => deps.limiter.schedule(() => request(term), priority) };
}
