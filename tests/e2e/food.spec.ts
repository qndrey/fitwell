import { expect, test, type Page } from '@playwright/test';

async function addFood(page: Page, query: string, pick: string | RegExp, amount?: string) {
  await page.getByRole('button', { name: 'Add food', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search foods').fill(query);
  await dialog.getByRole('button', { name: pick }).first().click();
  if (amount) await dialog.getByLabel('Amount').fill(amount);
  await dialog.getByRole('button', { name: /^Add to/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
});

test('logs foods from the bundled database and shows totals', async ({ page }) => {
  await addFood(page, 'banana', /^Banana, raw/, '120');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.added')).toHaveText('✓ Added: Banana, raw');
  await dialog.getByRole('button', { name: 'Done' }).click();

  const main = page.locator('main');
  await expect(main.getByRole('button', { name: /Banana, raw/ })).toContainText('120 g');
  // Banana raw is 88 kcal/100 g in the dataset: 120 g -> 106 kcal
  await expect(main.getByRole('region', { name: 'Daily totals' })).toContainText('106');
  await page.reload();
  await expect(main.getByRole('button', { name: /Banana, raw/ })).toBeVisible();
});

test('works offline: search, log, edit, delete with undo', async ({ page, context }) => {
  await context.setOffline(true);
  await addFood(page, 'egg', /Eggs?, /, '100');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  const row = page.locator('main').getByRole('button', { name: /^Egg/ }).first();
  await expect(row).toBeVisible();

  await row.click();
  await page.getByRole('dialog').getByLabel('Amount').fill('200');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('200 g');

  await row.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('status').getByText('Removed.')).toBeVisible();
  await expect(row).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row).toBeVisible();
  await context.setOffline(false);
});

test('custom food per serving, favorites, recents and saved meals', async ({ page }) => {
  // Create a custom food: 250 kcal per serving of 50 g -> 500 kcal/100 g
  await page.getByRole('button', { name: 'Add food', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create custom food' }).click();
  await dialog.getByLabel('Name').fill('Granola bar');
  await dialog.getByRole('radio', { name: 'One serving' }).check();
  await dialog.getByLabel('One serving weighs (g)').fill('50');
  await dialog.getByLabel('kcal').fill('250');
  await dialog.getByLabel('Protein').fill('5,5');
  await dialog.getByRole('button', { name: 'Save food' }).click();

  // Lands on quantity step with the serving portion available
  await dialog.getByLabel('Unit').selectOption({ label: 'serving (50 g)' });
  await dialog.getByLabel('Amount').fill('2');
  await expect(dialog.getByText(/^500 kcal/)).toBeVisible();
  await dialog.getByRole('button', { name: /^Favorite/ }).click();
  await dialog.getByRole('button', { name: /^Add to/ }).click();

  // Second item, then save the slot as a meal
  await dialog.getByLabel('Search foods').fill('banana');
  await dialog.getByRole('button', { name: /^Banana, raw/ }).first().click();
  await dialog.getByRole('button', { name: /^Add to/ }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();

  const main = page.locator('main');
  const slotName = await main.locator('section.slot', { has: page.getByRole('button', { name: /Granola bar/ }) }).getByRole('heading').innerText();
  await main.locator('section.slot', { hasText: slotName }).getByRole('button', { name: 'Save as meal' }).click();
  await page.getByRole('dialog').getByLabel('Meal name').fill('My snack');
  await page.getByRole('dialog').getByRole('button', { name: 'Save meal' }).click();

  // Empty search lists favorites, recents and the saved meal
  await page.getByRole('button', { name: 'Add food', exact: true }).first().click();
  const d2 = page.getByRole('dialog');
  await expect(d2.getByRole('region', { name: 'Favorites' }).getByText('Granola bar')).toBeVisible();
  await expect(d2.getByRole('region', { name: 'Recent' })).toBeVisible();
  await d2.getByRole('button', { name: /My snack/ }).click();
  await d2.getByRole('button', { name: /^Add all to/ }).click();
  await d2.getByRole('button', { name: 'Done' }).click();
  await expect(main.getByRole('button', { name: /Granola bar/ })).toHaveCount(2);
});

test('day navigation keeps days separate; habit-only hides numbers', async ({ page }) => {
  await addFood(page, 'banana', /^Banana, raw/, '100');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Yesterday');
  await expect(page.locator('main').getByRole('button', { name: /Banana/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.locator('main').getByRole('button', { name: /Banana/ })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Habit-only mode').check();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('region', { name: 'Daily totals' })).toContainText('1 foods logged');
  await expect(page.locator('main')).not.toContainText('kcal');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Habit-only mode').uncheck();
});

test('a full day can be logged quickly from recents', async ({ page }) => {
  for (const [q, name] of [['banana', /^Banana, raw/], ['egg', /Eggs?, /], ['milk', /^Milk, whole/]] as const) {
    await addFood(page, q, name);
    await expect(page.getByRole('dialog').locator('.added')).toContainText('Added');
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  }
  const start = Date.now();
  // Re-log from the empty search (recents) in a different slot: 3 foods, 2 taps each
  await page.getByRole('button', { name: 'Add food', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('radio', { name: 'Dinner' }).check();
  for (const re of [/Banana, raw/, /Egg/, /Milk, whole/]) {
    await d.getByRole('region', { name: 'Recent' }).getByRole('button', { name: re }).first().click();
    await d.getByRole('button', { name: /^Add to Dinner/ }).click();
  }
  await d.getByRole('button', { name: 'Done' }).click();
  expect(Date.now() - start).toBeLessThan(30_000);
  await expect(page.locator('section.slot', { hasText: 'Dinner' }).locator('.row')).toHaveCount(3);
});
