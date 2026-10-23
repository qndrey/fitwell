// The weekly and monthly review on the card shell (contracts/review-cards): same-height cards, the dock, label row, light and dark.
// The built view runs in a real Chromium, fed the review the server really computes (tests/support/viewHost.ts).
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WeekReview } from '../src/analytics/reviewTypes';
import viewHtml from '../src/ui/generated/review';
import { addDays, mondayOf } from '../ui/review/copy';
import { showCard } from './support/cards';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView, type OpenedView } from './support/viewHost';

let client: Client;
beforeAll(launch, 60_000);
afterAll(closeAll);
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const today = new Date().toISOString().slice(0, 10);
const THIS_WEEK = mondayOf(today);
const LAST_WEEK = addDays(THIS_WEEK, -7);
const review = async (args: Record<string, unknown>) => ((await call(client, 'show_weekly_review', args)).data as unknown as { review: WeekReview }).review;
const keys = (period: 'week' | 'month') => [['week', period === 'week' ? 'The week' : 'The 4 weeks'], ['food', 'Food'], ['training', 'Training'], ['body', 'Body'], ['energy', 'Energy'], ['consider', 'To consider']] as const;

/** Six weeks of food, weigh-ins, lifts that set records, sleep, steps and water. */
async function seed() {
  await call(client, 'set_goals', { kcal: 2300, protein_g: 140, workouts_per_week: 3, sleep_h: 8 });
  for (let i = 1; i < 45; i += 1) if (i % 7 !== 0) await call(client, 'log_food', { day: addD(-i), items: [{ food_id: 'frida:59', grams: 250 + (i % 5) * 20 }] });
  for (let i = 0; i < 45; i += 2) await call(client, 'log_body', { day: addD(-i), weight_kg: 82 - (45 - i) * 0.04 });
  for (let i = 0; i < 30; i += 1) await call(client, 'log_body', { day: addD(-i), sleep_hours: 6.5 + (i % 3) * 0.5, steps: 6000 + i * 100, add_water_ml: 1500 });
  for (const off of [-30, -23, -16, -9, -7, -5, -2]) await call(client, 'log_past_workout', { day: addD(off), exercises: [{ id: 'ex:Barbell_Squat', sets: [{ reps: 5, weight_kg: 80 + (off + 30) }] }, { id: 'ex:Barbell_Bench_Press_-_Medium_Grip', sets: [{ reps: 5, weight_kg: 60 + (off + 30) / 2 }] }] });
  await call(client, 'log_cardio', { activity_id: 'act:run-10', duration_min: 35, day: addD(-3) });
}
const addD = (n: number) => addDays(today, n);

/** A host that answers the paging calls with real reviews for the weeks asked for, else with the opened one. */
function host(reviews: Map<string, WeekReview>, fallback: WeekReview) {
  return (name: string, args: Record<string, unknown>) => (name === 'get_review_data' ? { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: reviews.get(`${args.period}:${args.week_start}`) ?? fallback } } : undefined);
}
const open = (r: WeekReview, o: { theme?: 'light' | 'dark'; width?: number; reviews?: Map<string, WeekReview> } = {}) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: r } }, { theme: o.theme, width: o.width, tools: host(o.reviews ?? new Map(), r) });

const sizes = (v: OpenedView) =>
  v.frame.locator('body').evaluate(() => {
    const d = globalThis as unknown as { document: { querySelector(s: string): { getBoundingClientRect(): { height: number; bottom: number } } | null; querySelectorAll(s: string): Iterable<{ getBoundingClientRect(): { height: number; bottom: number } }>; documentElement: { scrollHeight: number; scrollWidth: number } }; innerWidth: number };
    return { track: d.document.querySelector('.track')!.getBoundingClientRect().height, cards: [...d.document.querySelectorAll('section.pcard')].map((c) => Math.round(c.getBoundingClientRect().height)), page: d.document.documentElement.scrollHeight, scrollW: d.document.documentElement.scrollWidth, width: d.innerWidth };
  });
/** The dock's bottom edge minus the card's, for the card in view. */
const dockGap = (v: OpenedView) =>
  v.frame.locator('section.pcard:not([inert])').evaluate((card) => {
    const dock = card.querySelector('.dock')!;
    return Math.round((dock.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom) * 10) / 10;
  });

describe('review cards: height and dock (AC1, AC2)', () => {
  for (const [period, width] of [['week', 398], ['month', 398], ['week', 375], ['month', 375]] as const) {
    it(`${period} at ${width} px: every card is as tall as the track and its dock is flush with the bottom`, async () => {
      await seed();
      const r = await review({ week_start: period === 'week' ? LAST_WEEK : addDays(THIS_WEEK, -7), period });
      const v = await open(r, { width });
      await v.frame.locator('section.pcard').first().waitFor();
      const first = await sizes(v);
      expect(first.cards).toHaveLength(6);
      expect(new Set(first.cards).size).toBe(1);
      expect(first.track).toBe(440);
      for (const [key, name] of keys(period)) {
        await showCard(v, key, name);
        const s = await sizes(v);
        expect(s.track).toBe(440);
        expect(s.page).toBe(first.page);
        expect({ key, gap: await dockGap(v) }).toEqual({ key, gap: 0 });
      }
    }, 120_000);
  }

  it('a long card scrolls inside, the dock stays flush and the page does not grow', async () => {
    await seed();
    const r = await review({ week_start: LAST_WEEK });
    const long: WeekReview = { ...r, suggestions: Array.from({ length: 12 }, (_, i) => `Suggestion ${i + 1}: one option you could think about, written as a full sentence of some length so that it takes two lines.`) };
    const v = await open(long);
    const before = (await sizes(v)).page;
    const card = await showCard(v, 'consider', 'To consider');
    const [client, scroll] = await card.evaluate((el) => [el.clientHeight, el.scrollHeight]);
    expect(scroll).toBeGreaterThan(client!);
    await card.evaluate((el) => (el.scrollTop = 150));
    await pwExpect(card).toHaveAttribute('data-scrolled', '');
    expect(await dockGap(v)).toBe(0);
    expect((await sizes(v)).page).toBe(before);
  }, 60_000);
});

describe('review cards: paging (AC3)', () => {
  it('the dock pages by week: This week is disabled on this week and Next on a running one', async () => {
    await seed();
    const current = await review({});
    const v = await open(current);
    const here = v.frame.locator('section.pcard:not([inert])');
    expect(current.weekStart === THIS_WEEK || current.weekStart === LAST_WEEK).toBe(true);
    await showCard(v, 'food', 'Food');
    await pwExpect(here.getByRole('button', { name: 'Previous week' })).not.toHaveAttribute('aria-disabled', 'true');
    if (current.inProgress) {
      await pwExpect(here.getByRole('button', { name: 'This week' })).toHaveAttribute('aria-disabled', 'true');
      await pwExpect(here.getByRole('button', { name: 'Next week' })).toHaveAttribute('aria-disabled', 'true');
      await here.getByRole('button', { name: 'Next week' }).click({ force: true });
      await v.page.waitForTimeout(200);
      expect(v.calls.filter((c) => c.name === 'get_review_data')).toHaveLength(0);
    }
    await here.getByRole('button', { name: 'Previous week' }).click();
    await expect.poll(() => v.calls.at(-1)).toEqual({ name: 'get_review_data', args: { week_start: addDays(current.weekStart, -7), period: 'week' } });
  }, 60_000);

  it('last week: This week and Next are live; they go to this week and one week on, and the card is kept', async () => {
    await seed();
    const last = await review({ week_start: addDays(LAST_WEEK, -7) }); // two weeks ago: neither this week nor running
    const v = await open(last);
    const here = v.frame.locator('section.pcard:not([inert])');
    await showCard(v, 'training', 'Training');
    await pwExpect(here.getByRole('button', { name: 'This week' })).not.toHaveAttribute('aria-disabled', 'true');
    await here.getByRole('button', { name: 'Next week' }).click();
    await expect.poll(() => v.calls.at(-1)).toEqual({ name: 'get_review_data', args: { week_start: LAST_WEEK, period: 'week' } });
    await pwExpect(v.frame.locator('.labelrow strong')).toHaveText('Training');
    await here.getByRole('button', { name: 'This week' }).click();
    await expect.poll(() => v.calls.at(-1)).toEqual({ name: 'get_review_data', args: { week_start: THIS_WEEK, period: 'week' } });
  }, 60_000);

  it('month: the dock says month and pages 28 days', async () => {
    await seed();
    const m = await review({ week_start: addDays(LAST_WEEK, -28), period: 'month' }); // a month that has ended
    const v = await open(m);
    const here = v.frame.locator('section.pcard:not([inert])');
    for (const label of ['Previous month', 'This month', 'Next month']) await pwExpect(here.getByRole('button', { name: label })).toBeVisible();
    await pwExpect(v.frame.locator('.titlebar strong')).toHaveText('Monthly review');
    await here.getByRole('button', { name: 'Next month' }).click();
    await expect.poll(() => v.calls.at(-1)).toEqual({ name: 'get_review_data', args: { week_start: addDays(m.weekStart, 21 + 28), period: 'month' } });
  }, 60_000);

  it('while a period loads the cards stay and the buttons are off; a failed load keeps the cards and says so', async () => {
    await seed();
    const r = await review({ week_start: addDays(LAST_WEEK, -7) });
    const v = await openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: r } }, { tools: (name) => (name === 'get_review_data' ? { isError: true, content: [{ type: 'text', text: 'no' }] } : undefined) });
    await v.frame.locator('section.pcard').first().waitFor();
    await v.frame.locator('section.pcard:not([inert])').getByRole('button', { name: 'Previous week' }).click();
    await pwExpect(v.frame.getByText('Could not load that week. Try again.')).toBeVisible();
    await pwExpect(v.frame.locator('section.pcard')).toHaveCount(6);
    await pwExpect(v.frame.getByRole('button', { name: 'Week', exact: true })).toBeEnabled();
  }, 60_000);
});

describe('review cards: structure (AC4)', () => {
  it('has no tiles, tabs, boxed cards or footer; Body holds the habits; the label row follows the card', async () => {
    await seed();
    const r = await review({ week_start: LAST_WEEK });
    const v = await open(r);
    await v.frame.locator('section.pcard').first().waitFor();
    for (const sel of ['.tiles', '.tabs', 'section.card', 'footer', '.nav']) await pwExpect(v.frame.locator(sel)).toHaveCount(0);
    await pwExpect(v.frame.locator('.counter')).toHaveText('1 of 6');
    await pwExpect(v.frame.locator('section.pcard[data-key="week"] svg.chart')).toHaveCount(1);
    await pwExpect(v.frame.locator('.labelrow strong')).toHaveText('The week');
    await pwExpect(v.frame.locator('.labelrow')).toContainText('Last week');
    const body = await showCard(v, 'body', 'Body');
    await pwExpect(v.frame.locator('.labelrow strong')).toHaveText('Body');
    await pwExpect(v.frame.locator('.labelrow')).toContainText('vs last week');
    for (const row of ['Weigh-ins', 'Sleep', 'Steps', 'Water']) await pwExpect(body.locator('.hrow', { hasText: row })).toBeVisible();
    await pwExpect(body.locator('.big')).toContainText('kg');
    const food = await showCard(v, 'food', 'Food');
    await pwExpect(food.locator('.big')).toContainText('kcal');
    await pwExpect(food.getByText(/^a day · goal 2,300/)).toBeVisible();
    await pwExpect(food.locator('.hrow', { hasText: 'Days logged' })).toContainText(/\d of 7/);
    const training = await showCard(v, 'training', 'Training');
    await pwExpect(training.getByText(/strength · \d+ cardio/)).toBeVisible();
    const energy = await showCard(v, 'energy', 'Energy');
    await pwExpect(energy.locator('.big')).toHaveText(/kcal|–/);
    // no colour carries a meaning: changes are plain text
    await pwExpect(food.locator('.delta, .up, .down')).toHaveCount(0);
  }, 90_000);

  it('says "so far" while the week runs, and names an empty week in a sentence', async () => {
    const empty = await review({});
    const v = await open(empty);
    await v.frame.locator('section.pcard').first().waitFor();
    await pwExpect(v.frame.locator('section.pcard[data-key="food"]')).toContainText('No food logged this week. Tell Claude what you eat to fill this card.');
    await pwExpect(v.frame.locator('section.pcard[data-key="training"]')).toContainText('No workouts logged this week.');
    await pwExpect(v.frame.locator('section.pcard[data-key="body"] .big')).toHaveText('–');
    await pwExpect(v.frame.locator('section.pcard[data-key="body"]')).toContainText('The average needs 3 weigh-ins in a week.');
    if (empty.inProgress) await pwExpect(v.frame.locator('.labelrow')).toContainText(/\d of 7 days/);
  }, 60_000);
});

describe('review cards: light and dark, no sideways scroll (AC5)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`week and month in ${theme}`, async () => {
      await seed();
      for (const period of ['week', 'month'] as const) {
        const v = await open(await review({ week_start: LAST_WEEK, period }), { theme, width: 375 });
        await v.frame.locator('section.pcard').first().waitFor();
        for (const [key, name] of keys(period)) {
          await showCard(v, key, name);
          const s = await sizes(v);
          expect(s.scrollW).toBeLessThanOrEqual(s.width);
        }
        await v.page.context().close();
      }
    }, 180_000);
  }
});
