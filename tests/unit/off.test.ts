import { describe, expect, it, vi } from 'vitest';
import { toCandidate, toCandidates } from '../../src/off/normalize';
import { RateLimiter } from '../../src/off/rateLimiter';
import { OffError, createOffClient } from '../../src/off/client';
import { createLookup, EMPTY_TTL_MS, TTL_MS, type CacheRow } from '../../src/off/lookup';

// Synthetic products shaped like Open Food Facts' documented response (values are made up for tests).
const product = (over: Record<string, unknown> = {}) => ({
  code: '1234567890123',
  product_name: 'Test oat drink',
  brands: 'Acme, Other',
  serving_quantity: '250',
  nutriments: { 'energy-kcal_100g': 46, proteins_100g: 1, carbohydrates_100g: 6.7, fat_100g: 1.5 },
  ...over,
});

describe('normalize', () => {
  it('maps a product, first brand, serving as a portion', () => {
    expect(toCandidate(product())).toEqual({
      source: 'off', sourceId: '1234567890123', name: 'Test oat drink', brand: 'Acme',
      per100g: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5 }, portions: [{ label: 'serving', grams: 250 }],
    });
  });
  it('falls back to kJ when kcal is missing', () => {
    expect(toCandidate(product({ nutriments: { energy_100g: 418.4, proteins_100g: 1 } }))!.per100g.kcal).toBe(100);
  });
  it('rejects products it cannot trust', () => {
    expect(toCandidate(product({ product_name: '  ' }))).toBeNull();
    expect(toCandidate(product({ code: undefined }))).toBeNull();
    expect(toCandidate(product({ nutriments: {} }))).toBeNull();
    expect(toCandidate(product({ nutriments: { 'energy-kcal_100g': 1200 } }))).toBeNull();
    expect(toCandidate(product({ nutriments: { 'energy-kcal_100g': 300, proteins_100g: 60, carbohydrates_100g: 60, fat_100g: 40 } }))).toBeNull();
    expect(toCandidate(product({ nutriments: { 'energy-kcal_100g': -5 } }))).toBeNull();
    expect(toCandidate(null)).toBeNull();
    expect(toCandidate('x')).toBeNull();
    expect(toCandidate({ code: 1, product_name: 'A', nutriments: 'oops' })).toBeNull();
  });
  it('treats string numbers, ignores absurd servings, dedupes by name + brand', () => {
    const list = toCandidates([product({ nutriments: { 'energy-kcal_100g': '46' }, serving_quantity: 99999 }), product({ code: '2' }), product({ code: '3', brands: 'Zed' })]);
    expect(list.map((c) => c.sourceId)).toEqual(['1234567890123', '3']);
    expect(list[0]!.portions).toEqual([]);
  });
});

function clock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (slept.push(ms), (t += ms)), slept, advance: (ms: number) => (t += ms) };
}

describe('rate limiter', () => {
  it('spaces requests at least 1.5 s apart and never exceeds 6 per minute', async () => {
    const c = clock();
    const lim = new RateLimiter(c, { minGapMs: 1500, perMinute: 6 });
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 14 }, () => lim.schedule(async () => void starts.push(c.now()))));
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(1500);
    for (let i = 0; i < starts.length; i++) {
      const inWindow = starts.filter((s) => s >= starts[i]! && s < starts[i]! + 60_000).length;
      expect(inWindow).toBeLessThanOrEqual(6);
    }
  });

  it('runs interactive jobs before waiting background jobs', async () => {
    const c = clock();
    const lim = new RateLimiter(c);
    const order: string[] = [];
    const jobs = [
      lim.schedule(async () => void order.push('bg1'), 'background'),
      lim.schedule(async () => void order.push('bg2'), 'background'),
      lim.schedule(async () => void order.push('bg3'), 'background'),
      lim.schedule(async () => void order.push('ui'), 'interactive'),
    ];
    await Promise.all(jobs);
    expect(order).toEqual(['bg1', 'ui', 'bg2', 'bg3']); // bg1 had already started
  });

  it('honours a server-requested pause and keeps going after a failing job', async () => {
    const c = clock();
    const lim = new RateLimiter(c);
    const t0 = c.now();
    await expect(lim.schedule(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    lim.pauseFor(45_000);
    let at = 0;
    await lim.schedule(async () => void (at = c.now()));
    expect(at - t0).toBeGreaterThanOrEqual(45_000);
  });
});

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe('OFF client', () => {
  const make = (fetchImpl: typeof fetch) => {
    const c = clock();
    const limiter = new RateLimiter(c, { minGapMs: 0, perMinute: 100 });
    return { limiter, client: createOffClient({ limiter, fetch: fetchImpl }) };
  };

  it('sends only the search text: encoded, no cookies, no referrer, no custom headers', async () => {
    const f = vi.fn(async () => json({ products: [product()] }));
    const { client } = make(f as unknown as typeof fetch);
    const res = await client.search('oat & milk ü');
    expect(res).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://world.openfoodfacts.org/cgi/search.pl?search_terms=oat%20%26%20milk%20%C3%BC');
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(init.headers).toBeUndefined();
    expect(init.method).toBeUndefined(); // plain GET: no CORS preflight
  });

  it('classifies failures', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => { throw new TypeError('Failed to fetch'); }, 'offline'],
      [async () => new Response('', { status: 503, headers: { 'retry-after': '30' } }), 'rate'],
      [async () => new Response('', { status: 429 }), 'rate'],
      [async () => new Response('', { status: 500 }), 'server'],
      [async () => new Response('', { status: 404 }), 'bad'],
      [async () => new Response('<html>maintenance</html>', { status: 200 }), 'bad'],
      [async () => json({ nope: 1 }), 'bad'],
    ];
    for (const [impl, kind] of cases) {
      const { client } = make(vi.fn(impl) as unknown as typeof fetch);
      await expect(client.search('x')).rejects.toMatchObject({ kind });
    }
  });

  it('a 503 pauses the whole limiter for Retry-After', async () => {
    const c = clock();
    const limiter = new RateLimiter(c, { minGapMs: 0, perMinute: 100 });
    const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 503, headers: { 'retry-after': '30' } })).mockResolvedValue(json({ products: [] }));
    const client = createOffClient({ limiter, fetch: f as unknown as typeof fetch });
    const err = await client.search('a').catch((e) => e);
    expect(err).toBeInstanceOf(OffError);
    expect(err.retryAfterMs).toBe(30_000);
    const t = c.now();
    await client.search('b');
    expect(c.now() - t).toBeGreaterThanOrEqual(30_000);
  });
});

describe('lookup cache + de-duplication', () => {
  const store = () => {
    const rows = new Map<string, CacheRow>();
    return { rows, cache: { get: async (k: string) => rows.get(k), put: async (r: CacheRow) => void rows.set(r.key, r) } };
  };
  const cand = toCandidate(product())!;

  it('three identical lookups at once make one request; the next one comes from the cache', async () => {
    const search = vi.fn(async () => [cand]);
    const { cache } = store();
    const lookup = createLookup({ client: { search, product: async () => null }, cache });
    const [a, b, c] = await Promise.all([lookup.search('Oat  Milk'), lookup.search('oat milk'), lookup.search(' OAT MILK ')]);
    expect([a, b, c].every((r) => r.length === 1)).toBe(true);
    await lookup.search('oat milk');
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('oat milk', 'background');
  });

  it('cache expires after 7 days (1 day for empty answers)', async () => {
    let t = 0;
    const search = vi.fn(async () => [cand]);
    const empty = vi.fn(async () => []);
    const l1 = createLookup({ client: { search, product: async () => null }, cache: store().cache, now: () => t });
    await l1.search('a');
    t = TTL_MS - 1;
    await l1.search('a');
    expect(search).toHaveBeenCalledTimes(1);
    t = TTL_MS + 1;
    await l1.search('a');
    expect(search).toHaveBeenCalledTimes(2);

    t = 0;
    const l2 = createLookup({ client: { search: empty, product: async () => null }, cache: store().cache, now: () => t });
    await l2.search('zzz');
    t = EMPTY_TTL_MS + 1;
    await l2.search('zzz');
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures and lets the next call retry', async () => {
    const search = vi.fn().mockRejectedValueOnce(new OffError('server', 'x')).mockResolvedValue([cand]);
    const { rows, cache } = store();
    const lookup = createLookup({ client: { search, product: async () => null }, cache });
    await expect(lookup.search('a')).rejects.toThrow();
    expect(rows.size).toBe(0);
    expect(await lookup.search('a')).toHaveLength(1);
  });
});

describe('barcode product lookup', () => {
  const make = (impl: () => Promise<Response>) => {
    const c = clock();
    const limiter = new RateLimiter(c, { minGapMs: 0, perMinute: 100 });
    const f = vi.fn(impl);
    return { f, client: createOffClient({ limiter, fetch: f as unknown as typeof fetch }) };
  };
  const found = { status: 1, code: '4006381333931', product: { product_name: 'Test highlighter', nutriments: { 'energy-kcal_100g': 120 } } };

  it('fetches /api/v2/product/<code> with only digits and a fields list', async () => {
    const { f, client } = make(async () => json(found));
    const c = await client.product('4006381333931');
    expect(c).toMatchObject({ sourceId: '4006381333931', name: 'Test highlighter', per100g: { kcal: 120 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/4006381333931\.json\?fields=[a-z_,]+$/);
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(init.headers).toBeUndefined();
  });

  it('unknown products are null (status 0 or HTTP 404), not errors', async () => {
    for (const impl of [async () => json({ status: 0, code: '1', status_verbose: 'product not found' }), async () => new Response('{}', { status: 404 })]) {
      expect(await make(impl).client.product('96385074')).toBeNull();
    }
  });

  it('a product without usable nutrition is null; outages are errors', async () => {
    expect(await make(async () => json({ status: 1, code: '96385074', product: { product_name: 'X' } })).client.product('96385074')).toBeNull();
    await expect(make(async () => new Response('', { status: 503 })).client.product('96385074')).rejects.toMatchObject({ kind: 'rate' });
    await expect(make(async () => { throw new TypeError('x'); }).client.product('96385074')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('refuses anything that is not digits (never builds a URL from free text)', async () => {
    const { f, client } = make(async () => json(found));
    await expect(client.product('../../etc')).rejects.toMatchObject({ kind: 'bad' });
    expect(f).not.toHaveBeenCalled();
  });

  it('lookup routes valid barcodes to the product API, normalised and cached separately from text', async () => {
    const cand = toCandidate(product())!;
    const productFn = vi.fn(async (...a: [string, ...unknown[]]) => (void a, cand));
    const search = vi.fn(async () => []);
    const rows = new Map<string, CacheRow>();
    const lookup = createLookup({ client: { search, product: productFn }, cache: { get: async (k) => rows.get(k), put: async (r) => void rows.set(r.key, r) } });
    expect(await lookup.search('4006381333931')).toEqual([cand]);
    await lookup.search(' 4006-3813-33931 ');
    await lookup.search('036000291452'); // UPC-A → EAN-13 with a leading 0
    expect(productFn.mock.calls.map((c) => c[0])).toEqual(['4006381333931', '0036000291452']);
    expect(search).not.toHaveBeenCalled();
    expect([...rows.keys()]).toEqual(['barcode:4006381333931', 'barcode:0036000291452']);
    await lookup.search('4006381333930'); // bad check digit: treated as plain text
    expect(search).toHaveBeenCalledTimes(1);
    productFn.mockResolvedValueOnce(null as never);
    expect(await lookup.search('96385074')).toEqual([]); // unknown barcode → empty (entry becomes "not found")
  });
});
