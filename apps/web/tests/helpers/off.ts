import type { BrowserContext } from '@playwright/test';

export const OFF = 'https://world.openfoodfacts.org';

const offline = new WeakMap<BrowserContext, boolean>();

/**
 * Goes offline or back online. WebKit and Firefox do not reliably flip `navigator.onLine` or fire the `online` event
 * under Playwright's offline mode, and their mocked Open Food Facts calls bypass the network layer, so both are done by hand there.
 */
export async function setOffline(context: BrowserContext, value: boolean): Promise<void> {
  offline.set(context, value);
  await context.setOffline(value);
  if (context.browser()?.browserType().name() === 'chromium') return;
  for (const p of context.pages()) await p.evaluate((v) => window.dispatchEvent(new Event(v ? 'offline' : 'online')), value).catch(() => undefined);
}

export interface OffReply {
  status?: number;
  body?: unknown;
  /** Holds the response until this resolves. */
  wait?: Promise<void>;
  headers?: Record<string, string>;
  /** Fail like a dead network. */
  abort?: boolean;
}
export interface OffCall {
  url: URL;
  headers: Record<string, string>;
}

/**
 * Stands in for Open Food Facts for a whole browser context (all tabs) and records every request.
 * Chromium: intercepts the real request, so the headers seen are the ones that would go on the wire.
 * WebKit and Firefox cannot intercept requests from pages a service worker controls, so there the page's `fetch` is wrapped
 * instead; the wrapper reports the headers the browser would add from the request options (credentials, referrer policy).
 * The default `reply` answers every request with `fallback`.
 */
export async function mockOff(context: BrowserContext, reply: (n: number, url: URL) => OffReply | Promise<OffReply>, fallback: unknown): Promise<OffCall[]> {
  const calls: OffCall[] = [];
  const answer = async (url: URL, headers: Record<string, string>) => {
    if (offline.get(context)) return { abort: true, status: 0, headers: {}, body: '' };
    calls.push({ url, headers });
    const r = await reply(calls.length, url);
    await r.wait;
    return { abort: !!r.abort, status: r.status ?? 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json', ...r.headers }, body: JSON.stringify(r.body ?? fallback) };
  };

  if (context.browser()?.browserType().name() === 'chromium') {
    await context.route(`${OFF}/**`, async (route) => {
      const req = route.request();
      const a = await answer(new URL(req.url()), req.headers());
      if (a.abort) return route.abort();
      await route.fulfill({ status: a.status, headers: a.headers, body: a.body });
    });
    return calls;
  }

  await context.exposeFunction('__offMock', (req: { url: string; headers: Record<string, string> }) => answer(new URL(req.url), req.headers));
  await context.addInitScript((origin) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(origin)) return real(input, init);
      // What the browser would put on the request: nothing, unless the options let cookies or a referrer through.
      const headers: Record<string, string> = Object.fromEntries(new Headers(init?.headers).entries());
      if (init?.credentials !== 'omit') headers['cookie'] = 'present';
      if (init?.referrerPolicy !== 'no-referrer') headers['referer'] = location.href;
      const reply = (window as unknown as { __offMock: (r: unknown) => Promise<{ abort: boolean; status: number; headers: Record<string, string>; body: string }> }).__offMock({ url, headers });
      const aborted = new Promise<never>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      const a = await Promise.race([reply, aborted]);
      if (a.abort) throw new TypeError('Failed to fetch');
      return new Response(a.body, { status: a.status, headers: a.headers });
    };
  }, OFF);
  return calls;
}
