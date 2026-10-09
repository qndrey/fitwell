import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`style guide is accessible and complete (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/#/design');
    await expect(page.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible();
    for (const h of ['Principles', 'Colour', 'Typography', 'Spacing, shape and size', 'Icons', 'Buttons', 'Form controls', 'Cards, lists and numbers', 'Feedback']) {
      await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
    }
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test(`every documented contrast pair passes in the browser (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/#/design');
    const pairs = page.getByRole('listitem').filter({ hasText: /:1 [✓✗]/ });
    await expect(pairs.first()).toBeVisible();
    const texts = await pairs.allInnerTexts();
    expect(texts.length).toBeGreaterThanOrEqual(8);
    for (const t of texts) expect(t, t).toContain('✓');
  });
}

test('theme preview switch changes tokens and persists', async ({ page }) => {
  await page.goto('/#/design');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(23, 21, 18)'); // --bg in dark
  await page.getByRole('radio', { name: 'System' }).check();
});

test('uses the self-hosted typeface with tabular numerals', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Figtree Variable"'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontVariantNumeric)).toContain('tabular-nums');
  expect(requests.filter((u) => /woff2/.test(u)).every((u) => u.startsWith('http://localhost'))).toBe(true);
});

test('style guide has no horizontal scroll at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/design');
  await expect(page.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
