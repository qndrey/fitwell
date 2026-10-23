// The dashboard on the card shell (contracts/dashboard-cards): same-height cards, label row, no chips, light and dark.
// The built view runs in a real Chromium, fed the progress the server really computes (tests/support/viewHost.ts).
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Progress } from '../src/analytics/types';
import viewHtml from '../src/ui/generated/dashboard';
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

const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const progress = async (days = 90) => ((await call(client, 'get_dashboard_data', { days })).data as unknown as { progress: Progress }).progress;
const LIFTS = ['Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Squat', 'Barbell_Curl', 'Barbell_Deadlift', 'Bent_Over_Barbell_Row', 'Standing_Military_Press', 'Dumbbell_Bicep_Curl', 'Dumbbell_Shoulder_Press', 'Barbell_Shrug', 'Close-Grip_Barbell_Bench_Press'];

/** A person with a year of everything: weigh-ins, food, lifts (10 of them, so Strength is long), sleep and two measurements. */
async function seedRich() {
  await call(client, 'set_goals', { kcal: 2300, protein_g: 140, sleep_h: 8, workouts_per_week: 3 });
  for (let i = 0; i < 120; i += 2) await call(client, 'log_body', { day: addD(today, -i), weight_kg: 84 - (120 - i) * 0.03 + (i % 4) * 0.1 });
  for (let i = 1; i < 100; i += 4) await call(client, 'log_food', { day: addD(today, -i), items: [{ food_id: 'frida:59', grams: 300 }] });
  for (let i = 1; i < 60; i += 3) await call(client, 'log_body', { day: addD(today, -i), sleep_hours: 6.5 + (i % 3) * 0.5, steps: 7000 + i * 50 });
  await call(client, 'log_body', { day: addD(today, -60), measurements: { waist: 90, chest: 100 } });
  await call(client, 'log_body', { day: addD(today, -2), measurements: { waist: 88, chest: 101 } });
  for (const off of [-80, -60, -45, -30, -21, -14, -7, -3]) {
    const sets = (kg: number) => Array.from({ length: 5 }, () => ({ reps: 8, weight_kg: kg + (80 + off) / 10 }));
    await call(client, 'log_past_workout', { day: addD(today, off), exercises: LIFTS.map((id, i) => ({ id: `ex:${id}`, sets: sets(40 + i * 5) })) });
  }
}

const open = (p: Progress, o: { theme?: 'light' | 'dark'; width?: number; tools?: (name: string, args: Record<string, unknown>) => unknown } = {}) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { progress: p } }, o);

/** The numbers the cards are measured by, read in the view. */
const sizes = (v: OpenedView) =>
  v.frame.locator('body').evaluate(() => {
    const d = globalThis as unknown as { document: { querySelector(s: string): { getBoundingClientRect(): { height: number } } | null; querySelectorAll(s: string): Iterable<{ clientHeight: number; scrollHeight: number; getBoundingClientRect(): { height: number } }>; documentElement: { scrollHeight: number; scrollWidth: number } }; innerWidth: number };
    const cards = [...d.document.querySelectorAll('section.pcard')];
    return { track: d.document.querySelector('.track')!.getBoundingClientRect().height, cards: cards.map((c) => Math.round(c.getBoundingClientRect().height)), page: d.document.documentElement.scrollHeight, scrollW: d.document.documentElement.scrollWidth, width: d.innerWidth };
  });

describe('dashboard cards: height (AC1, AC2)', () => {
  for (const width of [398, 375]) {
    it(`at ${width} px every card is as tall as the track, whatever the period, and the track does not change when the card or the period does`, async () => {
      await seedRich();
      const p90 = await progress(90);
      const bySize = new Map<number, Progress>([[30, await progress(30)], [90, p90], [365, await progress(365)]]);
      const v = await open(p90, { width, tools: (name, args) => (name === 'get_dashboard_data' ? { content: [{ type: 'text', text: 'ok' }], structuredContent: { progress: bySize.get(args.days as number) } } : undefined) });
      await v.frame.locator('section.pcard').first().waitFor();
      const first = await sizes(v);
      expect(first.cards).toHaveLength(8);
      expect(new Set(first.cards).size).toBe(1);
      expect(first.cards[0]).toBe(Math.round(first.track));
      expect(first.track).toBe(440);
      for (const [key, name] of [['nutrition', 'Nutrition'], ['training', 'Training'], ['strength', 'Strength'], ['measures', 'Measures'], ['weight', 'Weight']] as const) {
        await showCard(v, key, name);
        for (const days of [30, 365, 90]) {
          await v.frame.getByRole('button', { name: `${days} days`, exact: true }).or(v.frame.getByRole('button', { name: '1 year', exact: true })).first().click();
          await pwExpect(v.frame.locator('.labelrow')).not.toContainText('updating');
          const s = await sizes(v);
          expect(s.track).toBe(440);
          expect(new Set(s.cards).size).toBe(1);
          expect(s.page).toBe(first.page);
        }
      }
    }, 120_000);
  }

  it('Strength and Volume scroll inside their card and the page does not grow', async () => {
    await seedRich();
    const v = await open(await progress(90));
    const before = (await sizes(v)).page;
    for (const [key, name] of [['strength', 'Strength'], ['volume', 'Volume']] as const) {
      const card = await showCard(v, key, name);
      const [client, scroll] = await card.evaluate((el) => [el.clientHeight, el.scrollHeight]);
      expect(scroll).toBeGreaterThan(client!);
      await card.evaluate((el) => (el.scrollTop = 200));
      await pwExpect(card).toHaveAttribute('data-scrolled', '');
      expect((await sizes(v)).page).toBe(before);
    }
  }, 60_000);
});

describe('dashboard cards: structure (AC3, AC5)', () => {
  it('has no chips, no boxed cards and no footer; the label row follows the card; the strip counts the cards', async () => {
    await seedRich();
    const v = await open(await progress(90));
    await v.frame.locator('section.pcard').first().waitFor();
    for (const sel of ['.tabs', 'section.card', 'footer', '.seg']) await pwExpect(v.frame.locator(sel)).toHaveCount(0);
    await pwExpect(v.frame.locator('.sg')).toHaveCount(8);
    for (const b of await v.frame.locator('.sgb').all()) expect((await b.boundingBox())!.width).toBeGreaterThanOrEqual(40);
    await pwExpect(v.frame.locator('.labelrow strong')).toHaveText('Weight');
    await pwExpect(v.frame.locator('.counter')).toHaveText('1 of 8');
    await showCard(v, 'nutrition', 'Nutrition');
    await pwExpect(v.frame.locator('.labelrow strong')).toHaveText('Nutrition');
    await pwExpect(v.frame.locator('.counter')).toHaveText('2 of 8');
    await pwExpect(v.frame.locator('.titlebar strong')).toHaveText('Progress');
    // the period control is text: 44 px, one pressed
    const periods = v.frame.getByRole('group', { name: 'Period' });
    await pwExpect(periods.getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'true');
    for (const b of await periods.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pwExpect(v.frame.getByText('Showing the card')).toHaveCount(0);
  }, 60_000);

  it('Weight: the 7-day average as the number, the sentence, the last weigh-in and the distance to the goal', async () => {
    await seedRich();
    const p = await progress(90);
    await call(client, 'update_profile', { weight_kg: 80 }).catch(() => undefined);
    const v = await open(p);
    const card = v.frame.locator('section.pcard[data-key="weight"]');
    await pwExpect(card.locator('.big')).toHaveText(`${p.weight.trendKg!.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kg`);
    await pwExpect(card.getByText(/^trend, .* kg since \d+ \w+ \(7-day average\)$/)).toBeVisible();
    await pwExpect(card.locator('.hrow', { hasText: 'Last weigh-in' })).toBeVisible();
    await pwExpect(card.locator('h2.sr-only')).toHaveText('Weight');
  }, 60_000);

  it('Nutrition: the average, the target next to protein, and rows for carbs and fat', async () => {
    await seedRich();
    const v = await open(await progress(90));
    const card = await showCard(v, 'nutrition', 'Nutrition');
    await pwExpect(card.locator('.big')).toContainText('kcal');
    await pwExpect(card.getByText(/^average on \d+ logged days, goal 2,300$/)).toBeVisible();
    await pwExpect(card.locator('.hrow', { hasText: 'Protein' }).first()).toContainText('goal 140 g');
    for (const r of ['Carbs', 'Fat']) await pwExpect(card.locator('.hrow', { hasText: r }).first()).toBeVisible();
  }, 60_000);

  it('Measures: a text toggle, the others as rows; Sleep: the goal only when set', async () => {
    await seedRich();
    const v = await open(await progress(90));
    const m = await showCard(v, 'measures', 'Measures');
    await pwExpect(m.getByRole('group', { name: 'Measurement' }).getByRole('button')).toHaveCount(2);
    await pwExpect(m.locator('.hrow')).toHaveCount(1);
    const s = await showCard(v, 'habits', 'Sleep, steps, water');
    await pwExpect(s.getByText(/goal 8 h/).first()).toBeVisible();
  }, 60_000);

  it('a person with no data sees one sentence per core card, no chart, and only six cards', async () => {
    const v = await open(await progress(90));
    await v.frame.locator('section.pcard').first().waitFor();
    await pwExpect(v.frame.locator('.counter')).toHaveText('1 of 6');
    await pwExpect(v.frame.locator('section.pcard[data-key="weight"]')).toContainText('No weigh-ins in this period. Tell Claude your weight to start the chart.');
    await pwExpect(v.frame.locator('section.pcard svg.chart')).toHaveCount(0);
    expect(new Set((await sizes(v)).cards).size).toBe(1);
  }, 60_000);

  it('a failed period change keeps the cards and says so', async () => {
    await seedRich();
    const v = await open(await progress(90), { tools: (name) => (name === 'get_dashboard_data' ? { isError: true, content: [{ type: 'text', text: 'no' }] } : undefined) });
    await v.frame.locator('section.pcard').first().waitFor();
    await v.frame.getByRole('button', { name: '30 days', exact: true }).click();
    await pwExpect(v.frame.getByText('Could not load that period. Try again.')).toBeVisible();
    await pwExpect(v.frame.locator('section.pcard')).toHaveCount(8);
  }, 60_000);
});

describe('dashboard cards: light and dark, no sideways scroll (AC4)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`30, 90 and 365 days in ${theme}`, async () => {
      await seedRich();
      for (const days of [30, 90, 365]) {
        const v = await open(await progress(days), { theme, width: 375 });
        await v.frame.locator('section.pcard').first().waitFor();
        for (const [key, name] of [['weight', 'Weight'], ['nutrition', 'Nutrition'], ['energy', 'Energy'], ['training', 'Training'], ['volume', 'Volume'], ['strength', 'Strength'], ['habits', 'Sleep, steps, water'], ['measures', 'Measures']] as const) {
          await showCard(v, key, name);
          const s = await sizes(v);
          expect(s.scrollW).toBeLessThanOrEqual(s.width);
        }
        await v.page.context().close();
      }
    }, 180_000);
  }
});
