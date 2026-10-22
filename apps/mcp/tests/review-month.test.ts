// The month view of the weekly review: four week-aligned weeks against the four before, on the server and in the built view.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WeekReview } from '../src/analytics/reviewTypes';
import viewHtml from '../src/ui/generated/review';
import { monthTitle } from '../ui/review/copy';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView } from './support/viewHost';

let client: Client;
beforeAll(launch, 60_000);
afterAll(closeAll);
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const RYE = 'frida:413'; // 209 kcal per 100 g
const LAST_WEEK = '2026-10-12'; // a Monday; the month is 2026-09-21 to 2026-10-18
const review = async (args: Record<string, unknown>) => ((await call(client, 'show_weekly_review', args)).data as unknown as { review: WeekReview }).review;

async function seed() {
  await call(client, 'set_goals', { kcal: 2000, protein_g: 120, workouts_per_week: 3 });
  for (const d of ['2026-09-22', '2026-10-01', '2026-10-08', '2026-10-15']) await call(client, 'log_food', { day: d, items: [{ food_id: RYE, grams: 1000 }] }); // 2090 kcal
  for (const d of ['2026-08-25', '2026-09-03']) await call(client, 'log_food', { day: d, items: [{ food_id: RYE, grams: 500 }] }); // 1045 kcal, the 4 weeks before
  await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day: '2026-09-30' });
  await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 30, day: '2026-10-14' });
}

describe('review with period month (server)', () => {
  it('counts the four weeks that end with week_start, against the same days four weeks earlier', async () => {
    await seed();
    const r = await review({ week_start: LAST_WEEK, period: 'month' });
    expect(r).toMatchObject({ period: 'month', weekStart: '2026-09-21', weekEnd: '2026-10-18', inProgress: false, daysCounted: 28 });
    expect(r.days).toHaveLength(28);
    expect(r.days[0]!.day).toBe('2026-09-21');
    expect(r.nutrition).toMatchObject({ daysLogged: 4 });
    expect(r.nutrition.average!.kcal).toBe(2090);
    expect(r.nutrition.previousAverage!.kcal).toBe(1045);
    expect(r.training).toMatchObject({ cardio: 2, goalPerWeek: 3 });
    expect(r.plan).toBeNull();
    expect(r.suggestions.join('\n')).toContain('of 12 planned workouts'); // the goal of 3 a week over 4 weeks
  });

  it('keeps the week as the default, and the app-only tool takes the period too', async () => {
    expect((await review({ week_start: LAST_WEEK })).period).toBe('week');
    const data = (await call(client, 'get_review_data', { week_start: LAST_WEEK, period: 'month' })).data as unknown as { review: WeekReview };
    expect(data.review.daysCounted).toBe(28);
    expect((await call(client, 'show_weekly_review', { week_start: '2026-10-12', period: 'year' })).isError).toBe(true);
    expect((await call(client, 'show_weekly_review', { week_start: '2099-01-05', period: 'month' })).isError).toBe(true);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'show_weekly_review')!;
    expect(tool.description).toContain('period month');
  });
});

describe('month titles', () => {
  it('says This month or Last month by the week the month ends with', () => {
    expect(monthTitle('2026-10-19', '2026-10-21')).toBe('This month');
    expect(monthTitle('2026-09-21', '2026-10-21')).toBe('Last month');
    expect(monthTitle('2026-10-12', '2026-10-21')).toBeNull();
  });
});

describe('review view, month', () => {
  let baseReview: WeekReview;

  it('switches Week / Month with 44 px buttons, draws the 4-week strip with a table of 28 days, and words the comparison neutrally', async () => {
    await seed();
    baseReview = await review({ week_start: LAST_WEEK, period: 'month' });
    const weekReview = await review({ week_start: LAST_WEEK });
    const v = await openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: weekReview } }, { tools: (n, a) => (n === 'get_review_data' ? { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: a.period === 'month' ? baseReview : weekReview } } : undefined) });
    const f = v.frame;
    await pwExpect(f.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const b of await f.getByRole('group', { name: 'Period' }).getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await f.getByRole('button', { name: 'Month', exact: true }).click();
    await pwExpect(f.locator('h1')).toHaveText('Monthly review');
    await expect.poll(() => v.calls.at(-1)).toEqual({ name: 'get_review_data', args: { week_start: LAST_WEEK, period: 'month' } });
    await pwExpect(f.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await pwExpect(f.locator('section[aria-label="The 4 weeks"] table.sr-only tbody tr')).toHaveCount(28);
    await pwExpect(f.getByText('vs the 4 weeks before').first()).toBeVisible();
    await pwExpect(f.getByText(/vs last week/)).toHaveCount(0);
    await pwExpect(f.getByRole('button', { name: 'Previous month' })).toBeEnabled();
    await f.getByRole('button', { name: 'Previous month' }).click();
    await expect.poll(() => v.calls.at(-1)).toEqual({ name: 'get_review_data', args: { week_start: '2026-09-14', period: 'month' } }); // 28 days earlier
    await f.getByRole('button', { name: 'This month' }).click();
    await expect.poll(() => v.calls.at(-1)?.args.period).toBe('month');
    await f.getByRole('button', { name: 'Week', exact: true }).click();
    await expect.poll(() => v.calls.at(-1)?.args.period).toBe('week');
  }, 60_000);
});
