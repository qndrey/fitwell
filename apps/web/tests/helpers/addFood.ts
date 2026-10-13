import type { Page } from '@playwright/test';

/** Opens the floating + menu and picks "Add food". */
export async function openAddFood(page: Page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
}
