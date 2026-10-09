import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Rows of the Workouts section on Today (not rows inside open sheets). */
const wk = (p: Page) => p.locator('section[aria-labelledby="workouts-h"] .row');

async function setWeight(page: Page, kg: string) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel(/^Your weight/).fill(kg);
  await page.getByLabel(/^Your weight/).blur();
  await page.getByRole('link', { name: 'Today' }).click();
}

async function addWorkout(page: Page) {
  await page.getByRole('button', { name: 'Add workout' }).click();
  return page.getByRole('dialog');
}

async function logCardio(page: Page, activity: string | RegExp, minutes: string, extra?: (d: ReturnType<Page['getByRole']>) => Promise<void>) {
  let d = await addWorkout(page);
  await d.getByRole('button', { name: 'Cardio or activity', exact: true }).click();
  d = page.getByRole('dialog').last();
  await d.getByRole('button', { name: activity }).first().click();
  await d.getByLabel('Duration (minutes)').fill(minutes);
  if (extra) await extra(d);
  await d.getByRole('button', { name: 'Add workout' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function addExercise(page: Page, query: string, name: string | RegExp) {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Search exercises').fill(query);
  await d.getByRole('button', { name }).first().click();
}

/** Inputs of set n, optionally within one exercise's card. */
const setInputs = (page: Page, n: number, exercise?: string | RegExp) => {
  const scope = exercise ? page.getByRole('group', { name: exercise }) : page;
  return { weight: scope.getByLabel(`Set ${n} kg`), reps: scope.getByLabel(`Set ${n} reps`) };
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('cardio: estimate from MET × weight × time, own number overrides, habit-only hides it', async ({ page }) => {
  await logCardio(page, /^Running, about 10 km\/h/, '30', async (d) => {
    await expect(d.getByText(/Add your weight in Settings/)).toBeVisible(); // no weight yet: no guess
    await d.getByLabel('Distance (km)').fill('5,2');
  });
  const row = wk(page).filter({ hasText: 'Running' });
  await expect(row).toContainText('Cardio · 30 min · 5.2 km');
  await expect(row).not.toContainText('kcal');

  await setWeight(page, '70');
  await row.click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Duration (minutes)').fill('30'); // re-save to refresh the estimate
  await expect(d.getByText(/≈ 343 kcal/)).toBeVisible(); // 9.8 × 70 × 0.5
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row).toContainText('≈ 343 kcal');

  await row.click();
  await page.getByRole('dialog').getByLabel(/^Your own number/).fill('400');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row).toContainText('400 kcal');
  await expect(row).not.toContainText('≈');

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Habit-only mode').check();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(row).not.toContainText('kcal');
  await row.click();
  await expect(page.getByRole('dialog').getByLabel(/^Your own number/)).toHaveCount(0);
});

test('cardio: your own activity, repeat last, templates, delete with undo', async ({ page }) => {
  let d = await addWorkout(page);
  await d.getByRole('button', { name: 'Cardio or activity', exact: true }).click();
  d = page.getByRole('dialog').last();
  await d.getByRole('button', { name: 'Create your own activity' }).click();
  await d.getByLabel('Name').fill('Padel');
  await d.getByLabel(/^Effort level/).fill('abc');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d.getByText('Enter a number between 1 and 25.')).toBeVisible();
  await d.getByLabel(/^Effort level/).fill('6,5');
  await d.getByRole('button', { name: 'Save' }).click();
  await d.getByLabel('Duration (minutes)').fill('60');
  await d.getByRole('button', { name: 'Add workout' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(wk(page).filter({ hasText: 'Padel' })).toContainText('60 min');

  // repeat last cardio on the previous day
  await page.getByRole('button', { name: 'Previous day' }).click();
  d = await addWorkout(page);
  await expect(d.getByRole('button', { name: /Repeat last cardio/ })).toContainText('Padel');
  await d.getByRole('button', { name: /Repeat last cardio/ }).click();
  await expect(wk(page).filter({ hasText: 'Padel' })).toContainText('60 min');

  // save as template, start from it on the day before
  await wk(page).filter({ hasText: 'Padel' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save as template' }).click();
  await page.getByRole('dialog').last().getByLabel('Template name').fill('Padel night');
  await page.getByRole('dialog').last().getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Saved as a template.')).toBeVisible();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  d = await addWorkout(page);
  await d.getByRole('button', { name: /^Padel night/ }).click();
  await expect(wk(page).filter({ hasText: 'Padel' })).toBeVisible();

  // delete with undo
  await wk(page).filter({ hasText: 'Padel' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(wk(page).filter({ hasText: 'Padel' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(wk(page).filter({ hasText: 'Padel' })).toHaveCount(1);
});

test('strength: search the library offline, log sets, see "Last time", repeat, warm-up toggle, autosave', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);

  let d = await addWorkout(page);
  await d.getByRole('button', { name: 'Strength workout', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Strength workout', exact: true })).toBeVisible();
  await addExercise(page, 'bench press', /^Barbell Bench Press - Medium Grip/);
  await expect(page.getByRole('heading', { level: 2, name: /Barbell Bench Press/ })).toBeVisible();

  await setInputs(page, 1).weight.fill('60');
  await setInputs(page, 1).reps.fill('8');
  await page.getByRole('button', { name: 'Add set' }).click(); // copies the previous set
  await expect(setInputs(page, 2).weight).toHaveValue('60');
  await expect(setInputs(page, 2).reps).toHaveValue('8');
  await page.getByRole('button', { name: 'Add set' }).click();
  await setInputs(page, 3).reps.fill('6');
  await setInputs(page, 3).weight.fill('62,5');
  await page.getByRole('button', { name: /^Set 1: working set/ }).click(); // mark the first as a warm-up
  await expect(page.getByRole('button', { name: /^Set 1: warm-up/ })).toHaveText('W');
  await expect(page.getByRole('button', { name: /^Set 2: working/ })).toHaveText('1'); // working sets renumber

  // Saved without any "save" button: reload and it's all there.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(setInputs(page, 3).weight).toHaveValue('62.5');
  await expect(page.getByRole('button', { name: /^Set 1: warm-up/ })).toBeVisible();

  await page.getByRole('link', { name: 'Back to today' }).or(page.getByRole('button', { name: 'Back to today' })).first().click();
  const row = wk(page).filter({ hasText: 'Strength' });
  await expect(row).toContainText('1 exercise · 3 sets');

  // Next day: same exercise shows what you did last time, prefilled from it.
  await page.getByRole('button', { name: 'Next day' }).click();
  d = await addWorkout(page);
  await d.getByRole('button', { name: 'Strength workout', exact: true }).click();
  await addExercise(page, 'bench press', /^Barbell Bench Press - Medium Grip/);
  await expect(page.getByText('8 @ 60, 6 @ 62.5 kg')).toBeVisible();
  await expect(page.getByText('Last time')).toBeVisible();
  await expect(setInputs(page, 1).weight).toHaveValue('60');
  await context.setOffline(false);
});

test('strength: filters, instructions, your own exercise, templates and repeat last', async ({ page }) => {
  let d = await addWorkout(page);
  await d.getByRole('button', { name: 'Strength workout', exact: true }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Muscle').selectOption('biceps');
  await d.getByLabel('Equipment').selectOption('dumbbell');
  const results = d.getByRole('region', { name: 'Results' }).getByRole('button');
  await expect(results.first()).toBeVisible();
  for (const name of await results.allInnerTexts()) expect(name.toLowerCase()).toMatch(/biceps|dumbbell/);
  await d.getByLabel('Search exercises').fill('curl');
  await results.first().click();

  await page.getByText('How to').click();
  await expect(page.locator('.howto ol li').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add exercise' }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Search exercises').fill('zzzz moves');
  await expect(d.getByText('No match')).toBeVisible();
  await d.getByRole('button', { name: /Create your own exercise/ }).click();
  await d.getByLabel('Name').fill('Sled push');
  await d.getByLabel('Muscle').selectOption('quadriceps');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Sled push' })).toBeVisible();
  await setInputs(page, 1, /Sled push/).weight.fill('40');
  await setInputs(page, 1, /Sled push/).reps.fill('10');

  await page.getByRole('button', { name: 'Save as template' }).click();
  await page.getByRole('dialog').getByLabel('Template name').fill('Arms and sled');
  await page.getByRole('dialog').getByRole('button', { name: 'Save template' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Back to today' }).click();

  await page.getByRole('button', { name: 'Previous day' }).click();
  d = await addWorkout(page);
  await d.getByRole('button', { name: /^Arms and sled \d/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Sled push' })).toBeVisible();
  await expect(setInputs(page, 1, /Sled push/).weight).toHaveValue('40');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Back to today' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  d = await addWorkout(page);
  await d.getByRole('button', { name: /Repeat last strength workout/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Sled push' })).toBeVisible();
});

test('an empty strength workout is not left behind; units switch to pounds', async ({ page }) => {
  let d = await addWorkout(page);
  await d.getByRole('button', { name: 'Strength workout', exact: true }).click();
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(wk(page).filter({ hasText: 'Strength' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Imperial (lb, mi)' }).check();
  await page.getByRole('link', { name: 'Today' }).click();
  d = await addWorkout(page);
  await d.getByRole('button', { name: 'Strength workout', exact: true }).click();
  await addExercise(page, 'squat', /^Barbell Squat$|^Barbell Full Squat/);
  await expect(page.getByText('lb', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Set 1 lb').fill('135');
  await page.getByLabel('Set 1 reps').fill('5');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByLabel('Set 1 lb')).toHaveValue('135'); // stored in kg, shown back as 135 lb
});

test('workouts are part of backups and restore exactly', async ({ page }) => {
  await logCardio(page, /^Yoga, hatha/, '45');
  const d = await addWorkout(page);
  await d.getByRole('button', { name: 'Strength workout', exact: true }).click();
  await addExercise(page, 'deadlift', /Deadlift/);
  await page.getByLabel('Set 1 kg').fill('100');
  await page.getByLabel('Set 1 reps').fill('5');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Back to today' }).click();

  await page.getByRole('link', { name: 'Settings' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save a backup file' }).click()]);
  const json = readFileSync((await dl.path())!, 'utf8');
  expect(JSON.parse(json).data.workouts).toHaveLength(2);

  await page.getByRole('link', { name: 'Today' }).click();
  for (const name of [/Yoga/, /Strength/]) {
    await wk(page).filter({ hasText: name }).first().click();
    if (name.source === 'Yoga') {
      await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    } else {
      await page.getByRole('button', { name: 'Delete workout' }).click();
    }
  }
  await expect(wk(page)).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Restore from a backup', { exact: true }).last().setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('dialog').getByRole('button', { name: 'Replace everything' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, replace' }).click();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(wk(page).filter({ hasText: 'Yoga' })).toContainText('45 min');
  await expect(wk(page).filter({ hasText: 'Strength' })).toContainText('1 exercise · 1 set');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`workout screens are accessible and phone-friendly (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 320, height: 640 });
    const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const clean = async () => expect((await scan()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    let d = await addWorkout(page);
    await clean();
    await d.getByRole('button', { name: 'Cardio or activity', exact: true }).click();
    await clean();
    await page.getByRole('dialog').last().getByRole('button', { name: /^Yoga, hatha/ }).click();
    await clean();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Close' }).click();

    d = await addWorkout(page);
    await d.getByRole('button', { name: 'Strength workout', exact: true }).click();
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await clean();
    await page.getByRole('dialog').getByLabel('Search exercises').fill('squat');
    await page.getByRole('dialog').getByRole('button', { name: /Squat/ }).first().click();
    await setInputs(page, 1).weight.fill('100');
    await clean();
    await fits();
    const small = await page.evaluate(() => [...document.querySelectorAll('main button, main input:not([readonly])')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5); }).map((b) => `${(b as HTMLElement).tagName} ${(b as HTMLElement).getAttribute('aria-label') ?? b.textContent}`));
    expect(small).toEqual([]);
  });
}
