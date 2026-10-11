import { expect, test, type Page } from '@playwright/test';
import { a11yScan } from '../helpers/a11y';
import { seedHistory } from '../helpers/seed';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // let the app create its measurement types before seeding
  await expect(page.getByRole('button', { name: 'Log measurements' })).toBeVisible();
}
const chart = (page: Page, name: RegExp | string) => page.getByRole('region', { name });
const svgOf = (page: Page, name: RegExp | string) => chart(page, name).locator('svg.chart-svg').first();

test.describe('History', () => {
  test('calendar: marks for logged days, spoken summaries, pending days stand out, tap opens that day', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 40, pendingDaysAgo: 3 });
    await page.reload(); // the app reads what was written behind its back
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();

    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const cells = page.locator('.cal-day');
    await expect(cells.first()).toBeVisible();
    const todayCell = page.locator('.cal-day[aria-current="date"]');
    await expect(todayCell).toHaveCount(1);
    expect(await todayCell.getAttribute('aria-label')).toMatch(/kcal|workout|kg/);

    // The day with something to confirm is marked by a dashed outline AND says so in words.
    const pending = page.locator('.cal-day[data-pending]');
    await expect(pending.first()).toBeVisible();
    await expect(pending.first()).toHaveAttribute('aria-label', /1 to confirm/);

    // Tap a day: a preview with the day and its week; "Open this day" (or a second tap) lands on Today for that day.
    await pending.first().click();
    await expect(pending.first()).toHaveAttribute('aria-pressed', 'true');
    const preview = page.getByRole('region', { name: /^\w+day, / });
    await expect(preview).toContainText(/1 to confirm/);
    await expect(preview).toContainText(/Week of/);
    await preview.getByRole('button', { name: 'Open this day' }).click();
    await expect(page).toHaveURL(new RegExp(`#/(today|today/\\d{4}-\\d{2}-\\d{2})$`));
    await expect(page.getByText('To confirm').first()).toBeVisible();
    void key;
  });

  test('calendar: month navigation, legend, and the list view with "Show earlier months"', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 200 });
    await page.getByRole('link', { name: 'History' }).click();
    const title = page.locator('#cal-h');
    const first = await title.innerText();
    await page.getByRole('button', { name: 'Previous month' }).click();
    expect(await title.innerText()).not.toBe(first);
    await page.getByRole('button', { name: 'Back to this month' }).click();
    expect(await title.innerText()).toBe(first);
    await expect(page.getByRole('list', { name: 'Key' })).toContainText('Something to confirm');

    await page.getByRole('radio', { name: 'List' }).check();
    const months = page.locator('section[aria-label]').filter({ has: page.locator('.row') });
    await expect(months.first()).toBeVisible();
    const before = await page.locator('.row').count();
    await page.getByRole('button', { name: 'Show earlier months' }).click();
    await expect.poll(() => page.locator('.row').count()).toBeGreaterThan(before);
    await expect(page.locator('.row').first()).toContainText(/kcal/);
  });

  test('habit-only hides calories; hidden body tracking hides weight and measurement marks', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 20 });
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Habit-only mode').check();
    await page.getByLabel('Hide body tracking').check();
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('radio', { name: 'List' }).check();
    const first = page.locator('.row').first();
    await expect(first).toBeVisible();
    const text = await first.innerText();
    expect(text).not.toMatch(/kcal| kg/);
    expect(text).toMatch(/food|workout/);
    await page.getByRole('radio', { name: 'Calendar' }).check();
    expect(await page.locator('.cal-day').first().getAttribute('aria-label')).not.toMatch(/kcal| kg/);
    await expect(page.locator('.mark-body')).toHaveCount(0);
  });

  test('empty history is friendly', async ({ page }) => {
    await ready(page);
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('radio', { name: 'List' }).check();
    await expect(page.getByText('Days you log will appear here.')).toBeVisible();
  });
});

test.describe('Progress', () => {
  test('without data every chart shows a friendly hint, not an empty axis', async ({ page }) => {
    await ready(page);
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
    for (const h of ['Weight', 'Calories and macros', 'Workouts per week', 'Strength progress', 'Cardio totals', 'Body measurements']) {
      await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
    }
    await expect(page.locator('svg.chart-svg')).toHaveCount(0);
    await expect(page.getByText(/Log your weight a few times/)).toBeVisible();
    await expect(page.getByText(/Log food on a few days/)).toBeVisible();
    await expect(page.getByText(/Workouts you log will show up here/)).toBeVisible();
    await expect(page.getByText(/Log a strength workout with weights/)).toBeVisible();
    await expect(page.getByText(/Cardio you log will add up here/)).toBeVisible();
    await expect(page.getByText(/Log a measurement at least twice/)).toBeVisible();
  });

  test('all six charts with a year of data; ranges change the period; every chart has a text summary and a table', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 400 });
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.locator('svg.chart-svg').first()).toBeVisible();

    const weight = chart(page, 'Weight');
    await expect(weight.locator('.chart-headline')).toHaveText(/^Trend [−+]\d+(\.\d)? kg over the last 3 months$/);
    await expect(svgOf(page, 'Weight')).toHaveAttribute('aria-label', /7-day average: [\d.]+ → [\d.]+ kg/);
    await page.getByRole('radio', { name: '1 yr' }).check();
    await expect(weight.locator('.chart-headline')).toHaveText(/over the last year$/);
    await page.getByRole('radio', { name: 'All' }).check();
    await expect(weight.locator('.chart-headline')).toHaveText(/since you started$/);
    await page.getByRole('radio', { name: '1 mo' }).check();
    await expect(weight.locator('.chart-headline')).toHaveText(/over the last month$/);

    // Same numbers as a table
    await weight.getByText('View as table').click();
    await expect.poll(() => weight.locator('tbody tr').count()).toBeGreaterThan(20);
    await expect(weight.locator('thead')).toContainText('7-day average');

    // Each chart: an accessible name, and a table
    for (const name of ['Weight', 'Calories and macros', 'Workouts per week', 'Strength progress', 'Cardio totals', 'Body measurements']) {
      const c = chart(page, name);
      await expect(c.locator('svg.chart-svg').first()).toHaveAttribute('role', 'img');
      expect(await c.locator('svg.chart-svg').first().getAttribute('aria-label')).toMatch(/\S{8,}/);
      await expect(c.getByText('View as table')).toBeVisible();
    }
  });

  test('scrub with the keyboard: exact values are read out', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 90 });
    await page.getByRole('link', { name: 'Progress' }).click();
    const svg = svgOf(page, 'Weight');
    await svg.focus();
    await page.keyboard.press('ArrowRight');
    await expect(chart(page, 'Weight').locator('.chart-readout')).toContainText(/\d+(\.\d)? kg/);
    await page.keyboard.press('Escape');
    await expect(chart(page, 'Weight').locator('.chart-readout')).not.toContainText(' kg');
    const bars = svgOf(page, 'Calories and macros');
    await bars.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(chart(page, 'Calories and macros').locator('.chart-readout')).toContainText(/kcal|nothing logged/);
  });

  test('calories and macros: switch metric, weekly averages; daily up to 3 months, weekly beyond', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 300 });
    await page.getByRole('link', { name: 'Progress' }).click();
    const c = chart(page, 'Calories and macros');
    await expect(c.locator('.chart-headline')).toContainText(/Average [\d,]+ kcal a day · \d+ days logged/);
    await expect(c.locator('.legend')).toContainText('Weekly average');
    await c.getByRole('radio', { name: 'Protein' }).check();
    await expect(c.locator('.chart-headline')).toContainText(/Average [\d,]+ g protein a day/);
    await page.getByRole('radio', { name: '1 yr' }).check();
    await expect(c.locator('.chart-svg rect').first()).toBeVisible();
    await expect(c.getByText('Each bar is the average of the days you logged that week.')).toBeVisible();
  });

  test('workouts per week (strength vs cardio with different fills), strength progress with the 1RM formula, cardio filter', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 120 });
    await page.getByRole('link', { name: 'Progress' }).click();
    const w = chart(page, 'Workouts per week');
    await expect(w.locator('.chart-headline')).toHaveText(/\d+ workouts · [\d.]+ per week/);
    await expect(w.locator('.legend')).toContainText('Strength workout');
    await expect(w.locator('.legend')).toContainText('Cardio');
    await expect(w.locator('.chart-svg pattern')).not.toHaveCount(0); // hatched cardio: not colour alone

    const s = chart(page, 'Strength progress');
    await expect(s.getByLabel('Exercise')).toHaveValue(/ex:/);
    await expect(s.locator('.chart-headline')).toContainText(/Best set [\d.]+ kg · Estimated 1RM [\d.]+ kg/);
    await expect(s.getByText(/Epley formula: weight × \(1 \+ reps ÷ 30\)/)).toBeVisible();
    await s.getByLabel('Exercise').selectOption({ label: 'Barbell Full Squat' });
    await expect(s.locator('.chart-headline')).toContainText('Barbell Full Squat');

    const c = chart(page, 'Cardio totals');
    await expect(c.locator('.chart-headline')).toContainText(/\d+ sessions · /);
    const all = await c.locator('.chart-headline').innerText();
    await c.getByLabel('Activity').selectOption({ label: 'Running, about 10 km/h (6 mph)' });
    expect(await c.locator('.chart-headline').innerText()).not.toBe(all);
    await c.getByRole('radio', { name: 'Distance' }).check();
    await expect(c.locator('.legend')).toContainText('Distance (km)');
  });

  test('body measurements: pick several, one chart per unit, change over the period, first vs latest table; goal line on weight', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 120 });
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel(/^Goal weight/).fill('72');
    await page.getByLabel(/^Goal weight/).blur();
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(chart(page, 'Weight').locator('.chart-rule')).toHaveCount(1);
    await expect(chart(page, 'Weight').getByText('Goal weight', { exact: true }).first()).toBeVisible();

    const m = chart(page, 'Body measurements');
    await expect(m.locator('.chart-headline')).toHaveText(/Waist [−+]\d+(\.\d)? cm/);
    await m.getByRole('button', { name: 'Hips' }).click();
    await expect(m.locator('.chart-headline')).toContainText(/Waist .* · Hips [−+]/);
    await expect(m.locator('svg.chart-svg')).toHaveCount(1); // both in cm: one axis
    await expect(m.getByRole('region', { name: 'First and latest' })).toContainText('Waist');
    await expect(m.getByRole('region', { name: 'First and latest' }).locator('tbody tr')).toHaveCount(2);
  });

  test('imperial units are applied to every chart', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 60 });
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Imperial (lb, mi)' }).check();
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(chart(page, 'Weight').locator('.chart-headline')).toContainText(' lb ');
    await expect(chart(page, 'Strength progress').locator('.chart-headline')).toContainText(' lb');
    await expect(chart(page, 'Body measurements').locator('.chart-headline')).toContainText(' in');
    await chart(page, 'Cardio totals').getByRole('radio', { name: 'Distance' }).check();
    await expect(chart(page, 'Cardio totals').locator('.legend')).toContainText('(mi)');
  });

  test('habit-only hides the calorie charts; hidden body tracking hides weight and measurements', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 60 });
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Habit-only mode').check();
    await page.getByLabel('Hide body tracking').check();
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Calories and macros' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Weight' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Body measurements' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Workouts per week' })).toBeVisible();
  });

  test('copy stays neutral: no judgement words next to changes', async ({ page }) => {
    await ready(page);
    await seedHistory(page, { days: 90 });
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.locator('svg.chart-svg').first()).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\b(good|bad|great|poor|failed|behind|ahead|over budget|lost|gained|goal reached|congrat)/i);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`charts are accessible and fit a 320 px phone (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 320, height: 900 });
      await ready(page);
      await seedHistory(page, { days: 150 });
      await page.getByRole('link', { name: 'Progress' }).click();
      await expect(page.locator('svg.chart-svg').first()).toBeVisible();
      expect((await a11yScan(page)).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.getByText('View as table').first().click();
      expect((await a11yScan(page)).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

      await page.getByRole('link', { name: 'History' }).click();
      await expect(page.locator('.cal-day').first()).toBeVisible();
      expect((await a11yScan(page)).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await page.getByRole('radio', { name: 'List' }).check();
      expect((await a11yScan(page)).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      const small = await page.evaluate(() => [...document.querySelectorAll('main .cal-day, main .row, main button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 20); }).map((b) => b.textContent));
      expect(small).toEqual([]);
    });
  }
});
