import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Synthetic products in Open Food Facts' response shape (made-up values; no network is used).
const PRODUCTS = [
  { code: '111', product_name: 'Test oat drink', brands: 'Acme', nutriments: { 'energy-kcal_100g': 46, proteins_100g: 1, carbohydrates_100g: 6.7, fat_100g: 1.5 } },
  { code: '222', product_name: 'Test oat drink barista', brands: 'Other', nutriments: { 'energy-kcal_100g': 57, proteins_100g: 1.1, carbohydrates_100g: 7.5, fat_100g: 2.7 } },
];

interface Reply { status?: number; body?: unknown; wait?: Promise<void>; headers?: Record<string, string> }

/** Intercepts Open Food Facts for a whole browser context (all tabs). Returns the list of requests seen. */
async function mockOff(context: BrowserContext, reply: (n: number, url: URL) => Reply | Promise<Reply> = () => ({})) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  await context.route('https://world.openfoodfacts.org/**', async (route) => {
    const req = route.request();
    calls.push({ url: new URL(req.url()), headers: req.headers() });
    const r = await reply(calls.length, new URL(req.url()));
    await r.wait;
    await route.fulfill({
      status: r.status ?? 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json', ...r.headers },
      body: JSON.stringify(r.body ?? { products: PRODUCTS }),
    });
  });
  return calls;
}

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker, so offline reloads work
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function logPending(page: Page, text: string, grams = '150') {
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Search foods').fill(text);
  await d.getByRole('button', { name: /^Log without nutrition for now/ }).click();
  await d.getByLabel('Amount (g)').fill(grams);
  await d.getByRole('button', { name: /^Add to/ }).click();
  await expect(d.locator('.added')).toContainText('Logged, to look up');
  await d.getByRole('button', { name: 'Done' }).click();
}

const totals = (page: Page) => page.getByRole('region', { name: 'Daily totals' });

test('offline: log without nutrition → survives reload → back online → suggestions → user confirms', async ({ page, context }) => {
  const calls = await mockOff(context);
  await ready(page);
  await context.setOffline(true);
  await logPending(page, 'oat drink');

  const row = page.locator('main .row').filter({ hasText: 'oat drink' });
  await expect(row).toContainText('Pending');
  await expect(row).toContainText('Waiting for a connection');
  await expect(totals(page)).toContainText('+1 pending');
  await expect(totals(page)).toContainText('0 kcal');

  await page.reload(); // still offline, still queued (it is stored on the device)
  await expect(page.locator('main .row').filter({ hasText: 'oat drink' })).toContainText('Pending');
  expect(calls).toHaveLength(0);

  await context.setOffline(false); // fires the browser's "online" event
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url.searchParams.get('search_terms')).toBe('oat drink');

  // Never auto-applied: nothing counted until the user chooses.
  await expect(totals(page)).toContainText('0 kcal');
  await expect(page.locator('main .row').filter({ hasText: 'oat drink' })).toContainText('To confirm');

  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Review' })).toBeVisible();
  const first = page.getByRole('radio', { name: /Test oat drink · Acme/ });
  await expect(first).toBeChecked(); // suggested, not applied
  await expect(page.getByRole('radio', { name: /barista/ })).not.toBeChecked();
  await page.getByRole('radio', { name: /barista/ }).check(); // choose a different candidate
  await page.getByRole('button', { name: 'Use this match' }).click();
  await expect(page.getByText('Nothing to review')).toBeVisible();

  await page.getByRole('link', { name: 'Today' }).click();
  await expect(totals(page)).toContainText('86 kcal'); // 57 kcal/100 g × 150 g = 85.5
  await expect(page.getByText('to confirm')).toHaveCount(0);

  // The chosen food is kept on the device (recents + cache): found offline next time.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Search foods').fill('barista');
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Test oat drink barista/ })).toBeVisible();
  expect(calls).toHaveLength(1); // and nothing was requested again
});

test('no match → "Not found" → enter values by hand', async ({ page, context }) => {
  await mockOff(context, () => ({ body: { products: [] } }));
  await ready(page);
  await logPending(page, 'grandma soup');
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  await expect(page.locator('main .row').filter({ hasText: 'grandma soup' })).toContainText('Not found');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByText('No matches were found')).toBeVisible();
  await page.getByRole('button', { name: 'Enter values' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('kcal').fill('210');
  await d.getByLabel('Protein (g)').fill('9,5');
  await d.getByRole('button', { name: 'Save values' }).click();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(totals(page)).toContainText('210 kcal');
  const row = page.locator('main .row').filter({ hasText: 'grandma soup' });
  await expect(row).toContainText('Entered by hand');
  await row.click(); // editable, removable
  await page.getByRole('dialog').getByLabel('kcal').fill('250');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(totals(page)).toContainText('250 kcal');
});

test('"search myself" finds a food from the database and resolves the entry', async ({ page, context }) => {
  await mockOff(context, () => ({ body: { products: [] } }));
  await ready(page);
  await logPending(page, 'bananna', '100');
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Search myself' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByLabel('Search foods')).toHaveValue('bananna'); // typo-tolerant search finds it
  await d.getByRole('button', { name: /^Banana, raw/ }).first().click();
  await expect(page.getByText('Nothing to review')).toBeVisible();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(totals(page)).toContainText('88 kcal');
});

test('server errors back off and retry on their own; the entry stays pending meanwhile', async ({ page, context }) => {
  await page.clock.install();
  const calls = await mockOff(context, (n) => (n === 1 ? { status: 500, body: {} } : {}));
  await ready(page);
  await logPending(page, 'oat drink');
  await expect.poll(() => calls.length).toBe(1);
  const row = page.locator('main .row').filter({ hasText: 'oat drink' });
  await expect(row).toContainText('Pending');
  await expect(row).toContainText('Will try again soon');
  await page.clock.fastForward(60_000); // past the first backoff (15 s ±20 %)
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  expect(calls).toHaveLength(2);
});

test('RACE: editing the text while a lookup is in flight discards the stale answer', async ({ page, context }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls = await mockOff(context, (n) => (n === 1 ? { wait: gate } : { body: { products: [PRODUCTS[1]] } }));
  await ready(page);
  await logPending(page, 'oat drnk');
  await expect.poll(() => calls.length).toBe(1); // request is in flight and held

  await page.locator('main .row').filter({ hasText: 'oat drnk' }).click(); // pending sheet
  await page.getByRole('dialog').getByLabel('What did you have?').fill('oat drink');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  release(); // the old answer arrives now

  // The old answer must not be applied; the corrected text is looked up instead and shows ITS answer.
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  expect(calls.map((c) => c.url.searchParams.get('search_terms'))).toEqual(['oat drnk', 'oat drink']);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /barista/ })).toBeChecked();
});

test('three identical foods cost one request', async ({ page, context }) => {
  const calls = await mockOff(context);
  await ready(page);
  await context.setOffline(true);
  for (let i = 0; i < 3; i++) await logPending(page, i === 1 ? ' Oat  Drink ' : 'oat drink', '100');
  await context.setOffline(false);
  await expect(page.getByText('3 items to confirm')).toBeVisible();
  expect(calls).toHaveLength(1);
});

test('two tabs: only one runs the queue', async ({ page, context }) => {
  const calls = await mockOff(context);
  await ready(page);
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible();
  await context.setOffline(true);
  await logPending(page, 'oat drink');
  await context.setOffline(false);
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  await expect(other.getByText('1 item to confirm')).toBeVisible(); // the other tab sees the result too
  expect(calls).toHaveLength(1);
});

test('"Search online" is explicit, shows attribution, caches the choice, and sends only the search words', async ({ page, context }) => {
  const calls = await mockOff(context);
  await ready(page);
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Search foods').fill('test oat');
  await page.waitForTimeout(400);
  expect(calls).toHaveLength(0); // typing never calls out
  await d.getByRole('button', { name: 'Search online' }).click();
  await expect(d.getByText(/Food data from Open Food Facts/)).toBeVisible();
  await d.getByRole('button', { name: /^Test oat drink · ?|^Test oat drink Acme|^Test oat drink$/ }).first().click();
  await d.getByRole('button', { name: /^Add to/ }).click();
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(totals(page)).toContainText('46 kcal');

  expect(calls).toHaveLength(1);
  const { url, headers } = calls[0]!;
  expect([...url.searchParams.keys()].sort()).toEqual(['action', 'fields', 'json', 'page_size', 'search_simple', 'search_terms']);
  expect(url.searchParams.get('search_terms')).toBe('test oat');
  expect(headers['cookie']).toBeUndefined();
  expect(headers['referer']).toBeUndefined();
  expect(Object.keys(headers).filter((h) => /^(authorization|x-|content-type)/.test(h))).toEqual([]);
});

test('offline, "Search online" is unavailable but logging without nutrition still works', async ({ page, context }) => {
  await mockOff(context);
  await ready(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Search foods').fill('oat drink');
  await expect(d.getByRole('button', { name: 'Search online' })).toBeDisabled();
  await expect(d.getByText("You're offline right now")).toBeVisible();
  await expect(d.getByRole('button', { name: /^Log without nutrition for now/ })).toBeEnabled();
});

test('online lookup can be switched off: no button, no background requests', async ({ page, context }) => {
  const calls = await mockOff(context);
  await ready(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Look up foods online').uncheck();
  await page.getByRole('link', { name: 'Today' }).click();
  await logPending(page, 'oat drink');
  await page.waitForTimeout(800);
  expect(calls).toHaveLength(0);
  await expect(page.locator('main .row').filter({ hasText: 'oat drink' })).toContainText('Pending');
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Search foods').fill('oat');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Search online' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Look up foods online').check(); // turning it back on resumes the queue
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText('1 item to confirm')).toBeVisible();
  expect(calls).toHaveLength(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`review screen and pending flows are accessible and phone-friendly (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await mockOff(context);
    await ready(page);
    await logPending(page, 'oat drink');
    await expect(page.getByText('1 item to confirm')).toBeVisible();
    const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('radio').first()).toBeVisible();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Enter values' }).click();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}
