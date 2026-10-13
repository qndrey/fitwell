import { expect, test } from '@playwright/test';
import { seedHistory } from '../helpers/seed';

// NFR-7: a year (and more) of data on a low-end phone. CPU is throttled 4× via the Chrome DevTools protocol.
test.skip(({ browserName }) => browserName !== 'chromium', 'CPU throttling uses the Chrome DevTools protocol');

test('Progress with three years of data renders quickly on a throttled CPU, with small charts', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Log measurements' })).toBeVisible();
  await seedHistory(page, { days: 1095 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  for (const range of ['1 yr', 'All'] as const) {
    await page.evaluate(() => performance.clearMeasures());
    await page.getByRole('link', { name: 'Progress' }).click();
    await page.getByRole('radio', { name: range }).check();
    await expect(page.locator('svg.chart-svg').first()).toBeVisible();
    await page.getByRole('link', { name: 'Today' }).click();
    await page.evaluate(() => (performance.clearMarks(), performance.clearMeasures()));
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.locator('svg.chart-svg').nth(4)).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('progress').length)).toBeGreaterThan(0);
    const ms = await page.evaluate(() => performance.getEntriesByName('progress').at(-1)!.duration);
    console.log('  load (mount → data arrived):', await page.evaluate(() => Math.round(performance.getEntriesByName('progress-load').at(-1)?.duration ?? -1)), 'ms');
    console.log(`Progress (${range}, 3 years of data, 4× CPU throttle): ${Math.round(ms)} ms to ready`);
    // Target for a year of data is 400 ms; "All" here is three years, so it gets more room.
    expect(ms, `${range}: ${ms} ms`).toBeLessThan(range === '1 yr' ? 400 : 700);

    // each chart stays small enough to be cheap to paint and to scroll
    const counts = await page.locator('svg.chart-svg').evaluateAll((els) => els.map((e) => e.querySelectorAll('*').length));
    console.log(`  elements per chart: ${counts.join(', ')}`);
    for (const n of counts) expect(n).toBeLessThanOrEqual(900);
  }

  // History month view too
  await page.getByRole('link', { name: 'History' }).click();
  const t0 = Date.now();
  await expect(page.locator('.cal-day').first()).toBeVisible();
  await expect(page.locator('.cal-marks .mark').first()).toBeVisible();
  console.log(`History calendar: ${Date.now() - t0} ms`);
  expect(Date.now() - t0).toBeLessThan(400);
});
