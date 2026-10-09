import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function logBanana(page: Page, grams: string) {
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Search foods').fill('banana');
  await d.getByRole('button', { name: /^Banana, raw/ }).first().click();
  await d.getByLabel('Amount').fill(grams);
  await d.getByRole('button', { name: /^Add to/ }).click();
  await d.getByRole('button', { name: 'Done' }).click();
}

async function saveBackup(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'Settings' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save a backup file' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^fitwell-backup-\d{4}-\d{2}-\d{2}\.json$/);
  return readFileSync((await dl.path())!, 'utf8');
}

const pickFile = (page: Page, name: string, content: string) =>
  page.getByLabel('Restore from a backup', { exact: true }).last().setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('backup file contains the data, and replace restores exactly that state', async ({ page }) => {
  await logBanana(page, '120');
  const json = await saveBackup(page);
  const parsed = JSON.parse(json);
  expect(parsed).toMatchObject({ app: 'fitwell' });
  expect(parsed.data.foodEntries).toHaveLength(1);
  await expect(page.getByText(/Backup saved/)).toBeVisible();
  await expect(page.locator('.facts')).not.toContainText('Not yet');

  // Change things after the backup, then restore.
  await page.getByRole('link', { name: 'Today' }).click();
  await logBanana(page, '300');
  await expect(page.locator('main .row')).toHaveCount(2);

  await page.getByRole('link', { name: 'Settings' }).click();
  await pickFile(page, 'backup.json', json);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('1 food entries').first()).toBeVisible(); // in the backup
  await expect(sheet.getByText('2 food entries')).toBeVisible(); // on this device now
  await sheet.getByRole('button', { name: 'Replace everything' }).click();
  await expect(sheet.getByText('Replace everything on this device?')).toBeVisible();
  await sheet.getByRole('button', { name: 'Yes, replace' }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();

  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('main .row')).toHaveCount(1);
  await expect(page.locator('main .row')).toContainText('120 g');
});

test('merge keeps both the backup and what is on the device', async ({ page }) => {
  await logBanana(page, '120');
  const json = await saveBackup(page);
  await page.getByRole('link', { name: 'Today' }).click();
  await logBanana(page, '300');
  await page.getByRole('link', { name: 'Settings' }).click();
  await pickFile(page, 'backup.json', json);
  await page.getByRole('dialog').getByRole('button', { name: 'Merge with what is here' }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('main .row')).toHaveCount(2);
});

test('bad files are explained calmly and change nothing', async ({ page }) => {
  await logBanana(page, '120');
  await page.getByRole('link', { name: 'Settings' }).click();

  await pickFile(page, 'x.json', 'not json at all');
  await expect(page.getByRole('alert')).toContainText("couldn't be read");
  await pickFile(page, 'x.json', '{"hello":"world"}');
  await expect(page.getByRole('alert')).toContainText("isn't a Fitwell backup");
  await pickFile(page, 'x.json', JSON.stringify({ app: 'fitwell', schemaVersion: 999, exportedAt: 1, installId: 'x', data: {} }));
  await expect(page.getByRole('alert')).toContainText('newer version');
  await pickFile(page, 'x.json', JSON.stringify({ app: 'fitwell', schemaVersion: 1, exportedAt: 1, installId: 'x', data: { foodEntries: [{ id: 'a' }] } }));
  await expect(page.getByRole('alert')).toContainText('looks damaged');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('main .row')).toHaveCount(1);
});

test('backup reminder appears when stale, can be snoozed, and clears after a backup', async ({ page }) => {
  await logBanana(page, '100');
  const age = (days: number) =>
    page.evaluate(
      (d) =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open('fitwell');
          open.onsuccess = () => {
            const tx = open.result.transaction(['settings', 'foodEntries'], 'readwrite');
            const old = Date.now() - d * 86_400_000;
            tx.objectStore('settings').put({ id: 'settings', units: 'metric', theme: 'system', habitOnly: false, hideBodyTracking: false, backupReminderDays: 14, lastBackupAt: old, updatedAt: Date.now() });
            const entries = tx.objectStore('foodEntries').getAll();
            entries.onsuccess = () => entries.result.forEach((e) => tx.objectStore('foodEntries').put({ ...e, createdAt: old - 1000 }));
            tx.oncomplete = () => (open.result.close(), resolve());
          };
        }),
      days,
    );

  await expect(page.getByRole('region', { name: 'Backup reminder' })).toHaveCount(0); // fresh data: no nagging
  await age(30);
  await page.reload();
  const card = page.getByRole('region', { name: 'Backup reminder' });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(card).toBeHidden(); // snoozed for a week

  await age(30);
  await page.evaluate(() => {
    const open = indexedDB.open('fitwell');
    open.onsuccess = () => {
      const tx = open.result.transaction('settings', 'readwrite');
      const g = tx.objectStore('settings').get('settings');
      g.onsuccess = () => tx.objectStore('settings').put({ ...g.result, backupReminderDismissedAt: undefined });
    };
  });
  await page.reload();
  await expect(card).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Back up now' }).click()]);
  expect(dl.suggestedFilename()).toContain('fitwell-backup');
  await expect(card).toBeHidden();
});

test('a full disk is explained with a way to save a backup', async ({ page }) => {
  await page.evaluate(() => void Promise.reject(new DOMException('full', 'QuotaExceededError')));
  const toast = page.getByRole('status').filter({ hasText: "isn't enough space" });
  await expect(toast).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), toast.getByRole('button', { name: 'Save a backup file' }).click()]);
  expect(dl.suggestedFilename()).toContain('fitwell-backup');
});

test('settings and the restore sheet are accessible and mobile-friendly', async ({ page }) => {
  await logBanana(page, '100');
  const json = await saveBackup(page);
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await pickFile(page, 'b.json', json);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await sheet.getByRole('button', { name: 'Replace everything' }).click();
  expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('dialog button')].filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent),
  );
  expect(small).toEqual([]);
});
