import { a11yScan } from '../helpers/a11y';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const card = (p: Page) => p.getByRole('region', { name: 'Weight', exact: true });
const weightValue = (p: Page) => p.getByTestId('weight-value');

async function logWeight(page: Page, value: string) {
  await card(page).getByRole('button', { name: /^(Log weight|Update)$/ }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel(/^Weight \(/).fill(value);
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(card(page)).toBeVisible();
});

test('weight: log from Today, replace the same day, start from your last weight, remove', async ({ page }) => {
  await expect(weightValue(page)).toHaveText('No weigh-in yet');
  await logWeight(page, '72,4');
  await expect(weightValue(page)).toContainText('72.4 kg');
  await logWeight(page, '72.1'); // same day: replaced, not duplicated
  await expect(weightValue(page)).toContainText('72.1 kg');

  // The next day starts from yesterday's number; steppers nudge by 0.1.
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(weightValue(page)).toHaveText('No weigh-in yet');
  await card(page).getByRole('button', { name: 'Log weight' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByLabel(/^Weight \(/)).toHaveValue('72.1');
  await expect(d.getByText(/Last 72.1 kg/)).toBeVisible();
  await d.getByRole('button', { name: /^More by 0.1/ }).click();
  await d.getByRole('button', { name: /^More by 0.1/ }).click();
  await d.getByRole('button', { name: /^Less by 0.1/ }).click();
  await expect(d.getByLabel(/^Weight \(/)).toHaveValue('72.2');
  await d.getByLabel(/^Weight \(/).fill('abc');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d.getByText('Enter your weight, like 72.4.')).toBeVisible();
  await d.getByLabel(/^Weight \(/).fill('72.2');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(weightValue(page)).toContainText('72.2 kg');

  await card(page).getByRole('button', { name: 'Update' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(weightValue(page)).toHaveText('No weigh-in yet');
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(weightValue(page)).toContainText('72.1 kg'); // the other day is untouched
});

test('weight is shown in pounds when you choose imperial, and stored without drift', async ({ page }) => {
  await logWeight(page, '72.5');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Imperial (lb, mi)' }).check();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(weightValue(page)).toContainText('159.8 lb');
  await logWeight(page, '159.8');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Metric (kg, km)' }).check();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(weightValue(page)).toContainText('72.5 kg');
});

test('goal weight is direction-neutral and shown as a plain difference', async ({ page }) => {
  await logWeight(page, '80');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel(/^Goal weight/).fill('85'); // a gaining goal
  await page.getByLabel(/^Goal weight/).blur();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(card(page)).toContainText('Goal weight 85 kg · 5 kg away');
  await expect(card(page)).not.toContainText(/behind|ahead|over|under|lost|gained|BMI/i);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel(/^Goal weight/).fill('');
  await page.getByLabel(/^Goal weight/).blur();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(card(page)).not.toContainText('Goal weight');
});

test('logged weight feeds cardio estimates (and beats the Settings fallback)', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel(/^Your weight/).fill('100');
  await page.getByLabel(/^Your weight/).blur();
  await page.getByRole('link', { name: 'Today' }).click();
  await logWeight(page, '70');
  await page.getByRole('button', { name: 'Add workout' }).click();
  await page.getByRole('button', { name: 'Cardio or activity', exact: true }).click();
  const d = page.getByRole('dialog').last();
  await d.getByRole('button', { name: /^Running, about 10 km\/h/ }).click();
  await d.getByLabel('Duration (minutes)').fill('30');
  await expect(d.getByText(/≈ 343 kcal/)).toBeVisible(); // 9.8 × 70 × 0.5, not × 100
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Settings shows the weigh-in that is used, not a second number to keep in sync.
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText(/^70 kg/)).toBeVisible();
  await expect(page.getByText(/from your weigh-in on/)).toBeVisible();
  await expect(page.getByLabel(/^Your weight/)).toHaveCount(0);
});

test('measurements: only enabled types, partial entries, same-day edit, how-to hints, units', async ({ page }) => {
  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  let d = page.getByRole('dialog');
  await expect(d.getByLabel(/^(Waist|Hips|Chest) \(cm\)/)).toHaveCount(3);
  await expect(d.getByLabel(/^Neck/)).toHaveCount(0);
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d.getByText('Enter at least one measurement')).toBeVisible();
  await d.getByText('How to measure').first().click();
  await expect(d.getByText(/narrowest part of your torso/)).toBeVisible();
  await d.getByLabel(/^Waist/).fill('88,5');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Measurements saved.')).toBeVisible();

  // Same day again: previous values are there, and updating replaces them.
  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  d = page.getByRole('dialog');
  await expect(d.getByLabel(/^Waist/)).toHaveValue('88.5');
  await d.getByLabel(/^Hips/).fill('101');
  await d.getByLabel(/^Waist/).fill('88');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  await expect(page.getByRole('dialog').getByLabel(/^Waist/)).toHaveValue('88');
  await expect(page.getByRole('dialog').getByLabel(/^Hips/)).toHaveValue('101');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // Next day: last values show as placeholders; inches follow the units setting.
  await page.getByRole('button', { name: 'Next day' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Imperial (lb, mi)' }).check();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  d = page.getByRole('dialog');
  await expect(d.getByLabel(/^Waist \(in\)/)).toHaveAttribute('placeholder', '34.6'); // 88 cm
  await d.getByLabel(/^Waist \(in\)/).fill('34.5');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Metric (kg, km)' }).check();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  await expect(page.getByRole('dialog').getByLabel(/^Waist \(cm\)/)).toHaveValue('87.6'); // 34.5 in
});

test('manage measurements: switch presets on, body fat is a plain %, add and remove your own', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Manage measurements' }).click();
  let d = page.getByRole('dialog');
  await d.getByRole('checkbox', { name: /^Body fat/ }).check();
  await d.getByRole('checkbox', { name: /^Hips/ }).uncheck();
  await d.getByRole('button', { name: 'Add your own' }).click();
  await d.getByLabel('Name').fill('Wrist');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d.getByText('Write the unit, like cm.')).toBeVisible();
  await d.getByLabel('Unit').fill('mm');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d.getByRole('checkbox', { name: 'Wrist (mm)' })).toBeChecked();
  await d.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('link', { name: 'Today' }).click();

  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  d = page.getByRole('dialog');
  await expect(d.getByLabel(/^Hips/)).toHaveCount(0);
  await d.getByLabel(/^Body fat \(%\)/).fill('140');
  await d.getByLabel(/^Wrist \(mm\)/).fill('165');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d.getByText('Enter a number, like 12 or 12.5.')).toBeVisible();
  await d.getByLabel(/^Body fat/).fill('21,5');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  await expect(page.getByRole('dialog').getByLabel(/^Wrist/)).toHaveValue('165');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // Removing your own type hides it, with an undo.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Manage measurements' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove Wrist' }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: /^Wrist/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: /^Wrist/ })).toBeVisible();
});

test('hide body tracking hides it everywhere, keeps the data, and it comes back', async ({ page }) => {
  await logWeight(page, '72');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Hide body tracking').check();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log measurements' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Hide body tracking').uncheck();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(weightValue(page)).toContainText('72 kg');
});

test('measurement reminder: quiet, snoozable, only after you have measured before', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: '1 wk' }).check();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText(/since you last took measurements/)).toHaveCount(0); // nothing measured yet: no nagging

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('fitwell');
        open.onsuccess = () => {
          const tx = open.result.transaction('measurementEntries', 'readwrite');
          tx.objectStore('measurementEntries').put({ id: 'meas:2020-01-01', day: '2020-01-01', values: { 'mt:waist': 90 }, createdAt: 1, updatedAt: 1, rev: 1 });
          tx.oncomplete = () => (open.result.close(), resolve());
        };
      }),
  );
  await page.reload();
  const note = page.getByText(/since you last took measurements/);
  await expect(note).toBeVisible();
  await card(page).getByRole('button', { name: 'Not now' }).click();
  await expect(note).toBeHidden();
  await page.reload();
  await expect(note).toBeHidden(); // snoozed
});

test('weight and measurements are in backups and restore exactly', async ({ page }) => {
  await logWeight(page, '71.3');
  await card(page).getByRole('button', { name: 'Log measurements' }).click();
  await page.getByRole('dialog').getByLabel(/^Waist/).fill('85');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save a backup file' }).click()]);
  const json = readFileSync((await dl.path())!, 'utf8');
  const parsed = JSON.parse(json);
  expect(parsed.data.weightEntries).toHaveLength(1);
  expect(parsed.data.measurementEntries).toHaveLength(1);
  expect(parsed.data.measurementTypes.length).toBeGreaterThanOrEqual(11);

  await page.getByRole('link', { name: 'Today' }).click();
  await card(page).getByRole('button', { name: 'Update' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(weightValue(page)).toHaveText('No weigh-in yet');

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Restore from a backup', { exact: true }).last().setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('dialog').getByRole('button', { name: 'Replace everything' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, replace' }).click();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(weightValue(page)).toContainText('71.3 kg');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`body screens are accessible and phone-friendly (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // Narrow phone. Tall enough that the pinned "Add food" bar doesn't float over other buttons at scroll position 0
    // (axe counts a partly covered button as a too-small target; scrolling content under a pinned bar is expected).
    await page.setViewportSize({ width: 320, height: 900 });
    const scan = () => a11yScan(page);
    const clean = async () => expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const small = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('dialog[open]:last-of-type button, dialog[open]:last-of-type input:not([readonly]):not([type=checkbox]):not([type=radio]), main > .page button')]
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); })
          .map((b) => `${b.tagName} ${(b as HTMLElement).getAttribute('aria-label') ?? b.textContent}`),
      );

    await clean();
    await fits();
    await card(page).getByRole('button', { name: 'Log weight' }).click();
    await clean();
    expect(await small()).toEqual([]);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await card(page).getByRole('button', { name: 'Log measurements' }).click();
    await page.getByRole('dialog').getByText('How to measure').first().click();
    await clean();
    expect(await small()).toEqual([]);
    await fits();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('link', { name: 'Settings' }).click();
    await clean();
    await page.getByRole('button', { name: 'Manage measurements' }).click();
    await clean();
    expect(await small()).toEqual([]);
  });
}
