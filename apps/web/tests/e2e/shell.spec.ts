import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('shows the four main screens and navigates between them', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Today', 'History', 'Progress', 'Settings']);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today');
  for (const name of ['History', 'Progress', 'Settings']) {
    await nav.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  }
});

test('theme choice persists across reloads (IndexedDB)', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByLabel('Dark').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Wait for the IndexedDB write to commit before reloading.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open('fitwell');
            open.onsuccess = () => {
              const get = open.result.transaction('settings').objectStore('settings').get('settings');
              get.onsuccess = () => {
                open.result.close();
                resolve(get.result?.theme);
              };
            };
          }),
      ),
    )
    .toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('Dark')).toBeChecked();
  await page.getByLabel('Device', { exact: true }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('makes no third-party requests and has no CSP violations (NFR-2/3/4)', async ({ page }) => {
  const origins = new Set<string>();
  const problems: string[] = [];
  page.on('request', (r) => origins.add(new URL(r.url()).origin));
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
  });
  const res = await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (const r of ['today', 'history', 'progress', 'settings']) await page.goto(`/#/${r}`);

  expect([...origins]).toEqual(['http://localhost:4173']);
  expect(problems).toEqual([]);
  const csp = res!.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self' https://world.openfoodfacts.org");
  expect(csp.replace("'wasm-unsafe-eval'", '')).not.toMatch(/unsafe-inline|unsafe-eval/); // wasm-only, no eval()
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
});

test('ships a _headers file for static hosts', () => {
  const headers = readFileSync('dist/_headers', 'utf8');
  expect(headers).toContain('Content-Security-Policy');
  expect(headers).toContain('/sw.js');
});

test('works offline after first load (PWA)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Wait until the precache is fully populated.
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.keys()).length > 0) && (await (await caches.open((await caches.keys())[0]!)).keys()).length))
    .toBeGreaterThan(3);
  await page.reload(); // now controlled by the SW
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today');
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('History');
  await context.setOffline(false);
});

test('has an installable manifest', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest).toMatchObject({ name: 'Fitwell', display: 'standalone' });
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
});

test('Chrome considers the app installable (no installability errors)', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'uses the Chrome DevTools protocol');
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});

test('the manifest parses cleanly and every icon loads (what Android reads for the home-screen icon)', async ({ page, context, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'uses the Chrome DevTools protocol');
  await page.goto('/');
  const cdp = await context.newCDPSession(page);
  const m = await cdp.send('Page.getAppManifest');
  expect(m.errors.map((e) => e.message)).toEqual([]);
  const man = JSON.parse(m.data ?? '{}') as { icons: { src: string; purpose?: string }[]; id?: string };
  expect(man.id).toBeTruthy();
  expect(new Set(man.icons.map((i) => i.purpose))).toEqual(new Set(['any', 'maskable', 'monochrome']));
  for (const i of man.icons) {
    const res = await request.get(new URL(i.src, m.url).toString());
    expect(res.status(), i.src).toBe(200);
    expect(res.headers()['content-type'], i.src).toBe('image/png');
  }
  // The page head carries PNG icons too: Android cannot use an SVG favicon for a shortcut.
  await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveCount(2);
});
