import { expect, test, type Page } from '@playwright/test';
import { openAddFood } from '../helpers/addFood';

// Phones are the baseline: smallest common width, touch, no horizontal scroll, reachable primary action.
test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function smallTargets(page: Page, root: string) {
  return page.evaluate((sel) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(`${sel} button, ${sel} a[href], ${sel} select, ${sel} input:not([type=radio]):not([type=checkbox]):not([readonly])`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName} "${(el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  }, root);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('no horizontal scroll on any screen at 320 px', async ({ page }) => {
  for (const name of ['today', 'history', 'progress', 'settings']) {
    await page.goto(`/#/${name}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalScroll(page), name).toBe(true);
  }
});

test('touch targets are at least 44 px on Today and in the add sheet', async ({ page }) => {
  expect(await smallTargets(page, 'body')).toEqual([]);
  await openAddFood(page);
  const d = page.getByRole('dialog');
  await d.getByLabel('Search foods').fill('banana');
  await expect(d.getByRole('button', { name: /^Banana, raw/ })).toBeVisible();
  expect(await smallTargets(page, 'dialog')).toEqual([]);
  await d.getByRole('button', { name: /^Banana, raw/ }).click();
  expect(await smallTargets(page, 'dialog')).toEqual([]);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('primary action stays in the thumb zone, even with a long day', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add', exact: true });
  const vh = 640;
  let box = (await add.boundingBox())!;
  expect(box.y).toBeGreaterThan(vh * 0.6); // empty day: pinned low, not mid-page
  expect(box.y + box.height).toBeLessThanOrEqual(vh);

  for (let i = 0; i < 8; i++) {
    await openAddFood(page);
    const d = page.getByRole('dialog');
    await d.getByLabel('Search foods').fill('banana');
    await d.getByRole('button', { name: /^Banana, raw/ }).first().click();
    await d.getByRole('button', { name: /^Add to/ }).click();
    await d.getByRole('button', { name: 'Done' }).click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  box = (await add.boundingBox())!;
  expect(box.y).toBeGreaterThan(vh * 0.6);
  // and it does not cover the last list row when scrolled to the end
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = (await page.locator('main .row').last().boundingBox())!;
  const bar = (await add.boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y + 1);
});

test('the add sheet keeps a stable height and a reachable Done button', async ({ page }) => {
  await openAddFood(page);
  const d = page.getByRole('dialog');
  const h0 = (await d.boundingBox())!.height;
  await d.getByLabel('Search foods').fill('milk');
  await expect(d.getByRole('button', { name: /^Milk/ }).first()).toBeVisible();
  const h1 = (await d.boundingBox())!;
  expect(Math.abs(h1.height - h0)).toBeLessThan(1);
  const done = (await d.getByRole('button', { name: 'Done' }).boundingBox())!;
  expect(done.y + done.height).toBeLessThanOrEqual(640);
  expect(done.y).toBeGreaterThan(640 * 0.7);
});

test('quick amounts log without opening the keyboard', async ({ page }) => {
  await openAddFood(page);
  const d = page.getByRole('dialog');
  await d.getByLabel('Search foods').fill('banana');
  await d.getByRole('button', { name: /^Banana, raw/ }).first().click();
  await d.getByRole('button', { name: '150', exact: true }).tap();
  await expect(d.getByLabel('Amount')).toHaveValue('150');
  await d.getByRole('button', { name: /^Add to/ }).tap();
  await d.getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('main .row')).toContainText('150 g');
});
