import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { a11yScan } from '../helpers/a11y';
import { seedHistory } from '../helpers/seed';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log measurements' })).toBeVisible();
}
const clean = async (page: Page, where: string) => expect((await a11yScan(page)).violations.map((v) => `${where} → ${v.id}: ${v.help}`)).toEqual([]);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('About', () => {
  test('privacy in plain words, data sources with their attribution, every shipped library with its licence text', async ({ page }) => {
    await ready(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'About and data sources' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'About Fitwell' })).toBeVisible();
    await expect(page.getByText(`Fitwell ${pkg.version}`)).toBeVisible();

    await expect(page.getByText(/no accounts, no analytics, no ads and no tracking/)).toBeVisible();
    await expect(page.getByText(/clearing your browser data erases your history/)).toBeVisible();

    // datasets
    await expect(page.getByRole('heading', { name: /Danish Food Composition Database/ })).toBeVisible();
    await expect(page.getByText(/10\.11583\/DTU\.29500682/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'free-exercise-db' })).toBeVisible();
    await expect(page.getByText(/The Unlicense/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open Food Facts' })).toBeVisible();
    await expect(page.getByText(/Open Database License \(ODbL 1\.0\)/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compendium of Physical Activities' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ZXing-C++' })).toBeVisible();

    // software: every library that ships, with the text its licence asks us to include
    const sw = page.getByRole('region', { name: 'Built with' }).or(page.locator('section[aria-labelledby="sw-h"]'));
    for (const name of ['preact', '@preact/signals', 'idb', 'valibot', 'lucide-preact', 'barcode-detector', 'zxing-wasm', '@fontsource-variable/figtree']) {
      await expect(sw.getByText(name, { exact: true }).first()).toBeVisible();
    }
    const first = sw.locator('details').first();
    await first.getByText('Licence text').click();
    await expect(first.locator('.licence')).toContainText(/Permission is hereby granted|SIL OPEN FONT|Permission to use, copy, modify/);
    const apache = sw.locator('li').filter({ hasText: 'ZXing-C++' }).locator('details');
    await apache.getByText('Licence text').click();
    await expect(apache.locator('.licence')).toContainText('Apache License');
    await sw.locator('li').filter({ hasText: '@fontsource-variable/figtree' }).getByText('Licence text').click();
    await expect(sw.locator('li').filter({ hasText: '@fontsource-variable/figtree' }).locator('.licence')).toContainText(/SIL OPEN FONT LICENSE/i);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`About is accessible and fits a phone (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto('/#/about');
      await expect(page.getByRole('heading', { level: 1, name: 'About Fitwell' })).toBeVisible();
      await page.getByText('Licence text').first().click();
      await clean(page, 'about');
      expect(await noOverflow(page)).toBe(true);
    });
  }
});

test.describe('Goals', () => {
  test('optional targets appear as quiet references, can be cleared, and respect habit-only', async ({ page }) => {
    await ready(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    const kcal = page.getByLabel(/^Daily calories \(kcal\)/);
    await kcal.fill('2,5'); // not a whole number
    await kcal.blur();
    await expect(page.getByText(/Enter a whole or decimal number up to 10000/)).toBeVisible();
    await kcal.fill('2000');
    await kcal.blur();
    await page.getByLabel(/^Protein \(g\)/).fill('120');
    await page.getByLabel(/^Protein \(g\)/).blur();
    await page.getByLabel('Workouts per week').fill('3');
    await page.getByLabel('Workouts per week').blur();
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByRole('region', { name: 'Daily totals' })).toContainText('Goal 2,000 kcal');
    await expect(page.getByRole('region', { name: 'Daily totals' })).toContainText('goal 120 g');
    await expect(page.getByText('This week 0 · target 3')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Daily totals' })).not.toContainText(/left|remaining|over|under/i);

    // a logged workout moves the plain count, nothing else
    await page.getByRole('button', { name: 'Add workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cardio or activity', exact: true }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: /^Yoga, hatha/ }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Add workout' }).click();
    await expect(page.getByText('This week 1 · target 3')).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Habit-only mode').check();
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByRole('region', { name: 'Daily totals' })).not.toContainText('2,000');

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Habit-only mode').uncheck();
    await kcal.fill('');
    await kcal.blur();
    await page.getByLabel(/^Protein \(g\)/).fill('');
    await page.getByLabel(/^Protein \(g\)/).blur();
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByRole('region', { name: 'Daily totals' })).not.toContainText('2,000');
    await expect(page.getByRole('region', { name: 'Daily totals' })).not.toContainText('P 120');
  });

  test('targets draw a dashed reference line on the charts', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 90 });
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel(/^Daily calories \(kcal\)/).fill('1800');
    await page.getByLabel(/^Daily calories \(kcal\)/).blur();
    await page.getByLabel('Workouts per week').fill('3');
    await page.getByLabel('Workouts per week').blur();
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByRole('region', { name: 'Calories and macros' }).locator('.chart-rule')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Workouts per week' }).locator('.chart-rule')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Workouts per week' }).locator('svg.chart-svg text', { hasText: 'Your target' })).toHaveCount(1);
  });
});

test.describe('Delete all data', () => {
  test('needs the word typed, offers a backup, and leaves an empty database and no caches', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 30 });
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Dark' }).check();
    await page.getByLabel(/^Daily calories \(kcal\)/).fill('2000');
    await page.getByLabel(/^Daily calories \(kcal\)/).blur();
    await page.reload();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.locator('.cal-day[aria-label*="kcal"]').first()).toBeVisible();
    await page.getByRole('link', { name: 'Settings' }).click();

    await page.getByRole('button', { name: 'Delete all data…' }).click();
    const d = page.getByRole('dialog');
    const confirm = d.getByRole('button', { name: 'Delete everything' });
    await expect(confirm).toBeDisabled();
    const [dl] = await Promise.all([page.waitForEvent('download'), d.getByRole('button', { name: 'Save a copy of current data first' }).click()]);
    expect(dl.suggestedFilename()).toContain('fitwell-backup');
    await d.getByLabel(/^Type “delete”/).fill('delet');
    await expect(confirm).toBeDisabled();
    await d.getByLabel(/^Type “delete”/).fill('Delete');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('All data deleted. You are starting fresh.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('fitwell-theme'))).not.toBe('dark'); // the old choice is gone (the fresh default is re-mirrored)

    // Every store is empty again (measurement types and the install id are re-created for a fresh start).
    const counts = await page.evaluate(
      () =>
        new Promise<Record<string, number>>((resolve) => {
          const open = indexedDB.open('fitwell');
          open.onsuccess = () => {
            const db = open.result;
            const names = [...db.objectStoreNames];
            const tx = db.transaction(names);
            const out: Record<string, number> = {};
            for (const n of names) tx.objectStore(n).count().onsuccess = (e) => (out[n] = (e.target as IDBRequest<number>).result);
            tx.oncomplete = () => (db.close(), resolve(out));
          };
        }),
    );
    const nonEmpty = Object.entries(counts).filter(([k, n]) => n > 0 && !['measurementTypes', 'meta'].includes(k));
    expect(nonEmpty).toEqual([]);
    expect(counts.foodEntries).toBe(0);
    expect(counts.workouts).toBe(0);
    expect(counts.weightEntries).toBe(0);
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames.filter((n) => !/precache/i.test(n))).toEqual([]);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.locator('.cal-day[aria-label*="kcal"]')).toHaveCount(0);
  });

  test('is clear and calm: explains, labels the danger action, fits a phone, accessible', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Delete all data…' }).click();
    const d = page.getByRole('dialog');
    await expect(d.getByText(/cannot be undone/)).toBeVisible();
    await expect(d.getByText(/Your backup files are not touched/)).toBeVisible();
    await clean(page, 'delete sheet');
    expect(await noOverflow(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete all data…' })).toBeFocused(); // focus returns to where you were
  });
});

test.describe('Add to Home Screen', () => {
  test.describe('iPhone', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
    test('a one-time, dismissible hint once there is something to protect', async ({ page }) => {
      await ready(page);
      await expect(page.getByRole('heading', { name: 'Add Fitwell to your Home Screen' })).toHaveCount(0); // nothing logged yet
      await seedHistory(page, { days: 3 });
      await page.reload();
      const hint = page.getByRole('region', { name: 'Add Fitwell to your Home Screen' });
      await expect(hint).toBeVisible();
      await expect(hint).toContainText(/Share button, then “Add to Home Screen”/);
      await hint.getByRole('button', { name: 'Not now' }).click();
      await expect(hint).toBeHidden();
      await page.reload();
      await expect(hint).toBeHidden();
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByRole('region', { name: 'Add Fitwell to your Home Screen' })).toBeVisible(); // still explained in Settings
    });
  });

  test('Android/desktop Chrome: an Install button appears when the browser offers it', async ({ page }) => {
    await ready(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      (window as unknown as { __prompted: boolean }).__prompted = false;
      e.prompt = async () => void ((window as unknown as { __prompted: boolean }).__prompted = true);
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __prompted: boolean }).__prompted)).toBe(true);
    await expect(page.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);
  });
});

test.describe('Every screen, both themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe is clean on all screens with data (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 360, height: 900 });
      await ready(page);
      await seedHistory(page, { days: 120, pendingDaysAgo: 2 });
      await page.reload();
      for (const route of ['today', 'history', 'progress', 'settings', 'about', 'review', 'design']) {
        await page.goto(`/#/${route}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (route === 'progress') await expect(page.locator('svg.chart-svg').first()).toBeVisible();
        await clean(page, `${route} (${scheme})`);
        expect(await noOverflow(page), `${route} overflows`).toBe(true);
      }
    });
  }

  test('keyboard: sheets open from the keyboard, Escape closes them, focus returns to the opener', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari does not Tab to links and buttons unless the system setting is on.');
    await ready(page);
    const add = page.getByRole('button', { name: 'Add', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab'); // first menu item: Add food
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Search foods')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('reduced motion: nothing animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page);
    const durations = await page.evaluate(() => [...document.querySelectorAll('button, a')].map((e) => getComputedStyle(e).transitionDuration));
    expect(durations.every((d) => d === '0s')).toBe(true);
  });
});
