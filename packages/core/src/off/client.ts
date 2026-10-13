import type { Candidate } from '../schema';
import { toCandidate, toCandidates } from './normalize';
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
  /** One product by barcode: the candidate, or null when Open Food Facts doesn't know it. */
  product(barcode: string, priority?: Priority): Promise<Candidate | null>;
}

// OFF's 503s are often short-lived load shedding, so don't punish the user with a long default pause.
const DEFAULT_PAUSE_MS = 30_000;
const FIELDS = 'code,product_name,brands,nutriments,serving_quantity,allergens_tags,traces_tags';
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
/** What the client passes to `fetch`. Declared here so the client does not depend on one platform's fetch typings. */
export interface OffRequestInit {
  credentials: 'omit';
  referrerPolicy: 'no-referrer';
  signal: AbortSignal;
}
export type OffFetch = (url: string, init: OffRequestInit) => Promise<Response>;

export function createOffClient(deps: { limiter: RateLimiter; fetch?: OffFetch; origin?: string; timeoutMs?: number }): OffClient {
  // Browsers: no cookies, no referrer. Servers inject their own fetch (Workers don't implement `credentials`).
  const doFetch: OffFetch = deps.fetch ?? ((url, init) => fetch(url, init as RequestInit));
  const origin = deps.origin ?? OFF_ORIGIN;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  /** Shared transport: timeout, error classification, JSON parsing. */
  async function get(url: string, { allow404 = false } = {}): Promise<unknown | null> {
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
      const wait = retryAfter(res) ?? DEFAULT_PAUSE_MS;
      deps.limiter.pauseFor(wait);
      throw new OffError('rate', `HTTP ${res.status}`, wait);
    }
    if (res.status >= 500) throw new OffError('server', `HTTP ${res.status}`);
    if (res.status === 404 && allow404) return null;
    if (!res.ok) throw new OffError('bad', `HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new OffError('bad', 'not JSON');
    }
  }

  async function search(term: string): Promise<Candidate[]> {
    const json = await get(`${origin}/cgi/search.pl?search_terms=${encodeURIComponent(term.slice(0, 100))}&search_simple=1&action=process&json=1&page_size=10&fields=${FIELDS}`);
    const products = (json as { products?: unknown } | null)?.products;
    if (!Array.isArray(products)) throw new OffError('bad', 'unexpected response');
    return toCandidates(products);
  }

  async function product(barcode: string): Promise<Candidate | null> {
    if (!/^\d{8,14}$/.test(barcode)) throw new OffError('bad', 'not a barcode');
    const json = (await get(`${origin}/api/v2/product/${barcode}.json?fields=${FIELDS}`, { allow404: true })) as { status?: unknown; product?: unknown; code?: unknown } | null;
    if (!json || json.status === 0 || typeof json.product !== 'object' || json.product === null) return null; // not in the database
    return toCandidate({ ...(json.product as object), code: json.code ?? barcode });
  }

  return {
    search: (term, priority = 'background') => deps.limiter.schedule(() => search(term), priority),
    product: (barcode, priority = 'background') => deps.limiter.schedule(() => product(barcode), priority),
  };
}
