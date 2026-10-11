import { a11yScan } from '../helpers/a11y';
import { expect, test } from '@playwright/test';
import { openAddFood } from '../helpers/addFood';

for (const scheme of ['light', 'dark'] as const) {
  for (const screen of ['today', 'history', 'progress', 'settings']) {
    test(`axe: ${screen} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/#/${screen}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const { violations } = await a11yScan(page);
      expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }
}

test('main flow is keyboard reachable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  // From the document start: skip link, Today, History.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'History' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('History');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: add-food sheet steps (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await openAddFood(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Search foods').fill('banana');
    await expect(dialog.getByRole('button', { name: /^Banana, raw/ })).toBeVisible();
    const scan = () => a11yScan(page);
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await dialog.getByRole('button', { name: /^Banana, raw/ }).first().click();
    await dialog.getByLabel('Amount').fill('0');
    await dialog.getByRole('button', { name: /^Add to/ }).click();
    await expect(dialog.getByText('Enter an amount greater than zero.')).toBeVisible();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByRole('button', { name: 'Create custom food' }).click();
    await dialog.getByLabel('Name').fill('');
    await dialog.getByRole('button', { name: 'Save food' }).click();
    await expect(dialog.getByText('Give it a name so you can find it later.')).toBeVisible();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}
