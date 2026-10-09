import { a11yScan } from '../helpers/a11y';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ean13Modules } from '../helpers/ean';

const CODE = '4006381333931';
const PRODUCT = { status: 1, code: CODE, product: { product_name: 'Test highlighter bar', brands: 'Acme', nutriments: { 'energy-kcal_100g': 120, proteins_100g: 3, carbohydrates_100g: 20, fat_100g: 2 } } };

/** A fake back camera: a canvas stream showing a real, decodable barcode. Optionally hides the native BarcodeDetector to force the WebAssembly path. */
async function fakeCamera(page: Page, opts: { code?: string; deny?: boolean; wasm?: boolean } = {}) {
  const modules = ean13Modules(opts.code ?? CODE);
  await page.addInitScript(
    ({ modules, deny, wasm }) => {
      if (wasm) delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
      const tracks: MediaStreamTrack[] = [];
      (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = tracks;
      navigator.mediaDevices.getUserMedia = async () => {
        if (deny) throw new DOMException('denied', 'NotAllowedError');
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        const draw = () => {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = '#000';
          const scale = 4;
          const x0 = (640 - modules.length * scale) / 2;
          for (let i = 0; i < modules.length; i++) if (modules[i] === '1') ctx.fillRect(x0 + i * scale, 90, scale, 180);
        };
        draw();
        setInterval(draw, 60);
        const stream = canvas.captureStream(15);
        tracks.push(...stream.getTracks());
        return stream;
      };
    },
    { modules, deny: !!opts.deny, wasm: !!opts.wasm },
  );
}

interface Seen { url: URL; headers: Record<string, string> }
async function mockOff(context: BrowserContext, reply: (url: URL, n: number) => { status?: number; body?: unknown } = () => ({ body: PRODUCT })) {
  const calls: Seen[] = [];
  await context.route('https://world.openfoodfacts.org/**', async (route) => {
    const url = new URL(route.request().url());
    calls.push({ url, headers: route.request().headers() });
    const r = reply(url, calls.length);
    await route.fulfill({ status: r.status ?? 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(r.body ?? {}) });
  });
  return calls;
}

async function openScanner(page: Page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('button', { name: 'Scan a barcode' }).click();
  return page.getByRole('dialog').last();
}

for (const wasm of [false, true]) {
  const path = wasm ? 'WebAssembly decoder' : 'built-in reader if the browser has one';

  test(`scan → product found → log it (${path})`, async ({ page, context }) => {
    const calls = await mockOff(context);
    await fakeCamera(page, { wasm });
    const origins = new Set<string>();
    page.on('request', (r) => origins.add(new URL(r.url()).origin));
    await openScanner(page);

    const d = page.getByRole('dialog').last();
    await expect(d.getByRole('heading', { name: 'Test highlighter bar' })).toBeVisible({ timeout: 15_000 });
    await d.getByRole('button', { name: /^Add to/ }).click();
    await d.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('region', { name: 'Daily totals' })).toContainText('120 kcal');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe(`/api/v2/product/${CODE}.json`);
    expect([...calls[0]!.url.searchParams.keys()]).toEqual(['fields']);
    expect(calls[0]!.headers['cookie']).toBeUndefined();
    expect(calls[0]!.headers['referer']).toBeUndefined();
    expect([...origins].sort()).toEqual(['http://localhost:4173', 'https://world.openfoodfacts.org']); // no CDN for the decoder
    const states = await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState));
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((s) => s === 'ended')).toBe(true); // camera released
  });
}

test('closing the scanner releases the camera', async ({ page, context }) => {
  await mockOff(context);
  await fakeCamera(page, { code: '3017620422003' });
  await context.route('https://world.openfoodfacts.org/**', (r) => r.abort());
  const d = await openScanner(page);
  await expect(d.getByText('Hold the barcode inside the frame')).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
  await d.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((t) => t.readyState === 'ended'))).toBe(true);
});

test('UPC-A is looked up as the 13-digit form Open Food Facts stores', async ({ page, context }) => {
  const calls = await mockOff(context, () => ({ body: { ...PRODUCT, code: '0036000291452' } }));
  await fakeCamera(page, { code: '0036000291452', wasm: true });
  await openScanner(page);
  await expect(page.getByRole('dialog').last().getByRole('heading', { name: 'Test highlighter bar' })).toBeVisible({ timeout: 15_000 });
  expect(calls[0]!.url.pathname).toBe('/api/v2/product/0036000291452.json');
});

test('unknown barcode → says so calmly and offers to create your own food', async ({ page, context }) => {
  await mockOff(context, () => ({ body: { status: 0, code: CODE, status_verbose: 'product not found' } }));
  await fakeCamera(page, { wasm: true });
  const d = await openScanner(page);
  await expect(d.getByText(`Barcode ${CODE} isn’t in Open Food Facts yet`)).toBeVisible({ timeout: 15_000 });
  await d.getByRole('button', { name: 'Create custom food' }).click();
  await expect(page.getByRole('dialog').last().getByLabel('Name')).toBeVisible();
});

test('offline: keep the barcode, it joins the queue and is looked up when back online, then confirmed by the user', async ({ page, context }) => {
  const calls = await mockOff(context);
  await fakeCamera(page, { wasm: true });
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('button', { name: 'Scan a barcode' }).click();
  const d = page.getByRole('dialog').last();
  await expect(d.getByText("You're offline")).toBeVisible({ timeout: 15_000 });
  await d.getByRole('button', { name: 'Keep it to look up later' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  const row = page.locator('main .row').filter({ hasText: `Barcode ${CODE}` });
  await expect(row).toContainText('Pending');
  await page.reload();
  await expect(row).toBeVisible();
  expect(calls).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url.pathname).toBe(`/api/v2/product/${CODE}.json`);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('radio', { name: /Test highlighter bar/ })).toBeChecked();
  await page.getByRole('button', { name: 'Use this match' }).click();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('region', { name: 'Daily totals' })).toContainText('120 kcal'); // 100 g default
});

test('Open Food Facts busy (503) → keep it for later instead of failing', async ({ page, context }) => {
  await mockOff(context, () => ({ status: 503, body: {} }));
  await fakeCamera(page, { wasm: true });
  const d = await openScanner(page);
  await expect(d.getByText('Open Food Facts is busy right now')).toBeVisible({ timeout: 15_000 });
  await expect(d.getByRole('button', { name: 'Keep it to look up later' })).toBeVisible();
});

test('camera blocked → calm explanation, typing the number still works (and bad numbers are explained)', async ({ page, context }) => {
  const calls = await mockOff(context);
  await fakeCamera(page, { deny: true });
  const d = await openScanner(page);
  await expect(d.getByText('The camera is blocked for this site')).toBeVisible();
  await d.getByLabel('Or type the number').fill('4006381333930'); // wrong check digit
  await d.getByRole('button', { name: 'Look up barcode' }).click();
  await expect(d.getByText("doesn't look like a valid barcode")).toBeVisible();
  expect(calls).toHaveLength(0);
  await d.getByLabel('Or type the number').fill('4006 3813 33931');
  await d.getByRole('button', { name: 'Look up barcode' }).click();
  await expect(page.getByRole('dialog').last().getByRole('heading', { name: 'Test highlighter bar' })).toBeVisible();
  expect(calls[0]!.url.pathname).toBe(`/api/v2/product/${CODE}.json`);
});

test('no scan button when online lookup is switched off', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByLabel('Look up foods online').uncheck();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scan a barcode' })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`scanner states are accessible and phone-friendly (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 320, height: 640 });
    await mockOff(context, () => ({ body: { status: 0, code: CODE } }));
    await fakeCamera(page, { deny: true });
    const d = await openScanner(page);
    const scan = () => a11yScan(page);
    await expect(d.getByText('The camera is blocked')).toBeVisible();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await d.getByLabel('Or type the number').fill('123');
    await d.getByRole('button', { name: 'Look up barcode' }).click();
    await expect(d.getByText("doesn't look like a valid barcode")).toBeVisible();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const small = await page.evaluate(() => [...document.querySelectorAll('dialog[open]:last-of-type button')].filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent));
    expect(small).toEqual([]);
  });
}
