// Restaurant estimates (D4): a meal out is logged as a range of calories, the middle is stored and marked as an estimate, the range is shown, and the
// review and progress say how much of the calories were estimates.
import { addDays, weekStart } from '@fitwell/core/domain/dates';
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WeekReview } from '../src/analytics/reviewTypes';
import { todayIn } from '../src/data/time';
import type { User } from '../src/data/users';
import foodHtml from '../src/ui/generated/food';
import reviewHtml from '../src/ui/generated/review';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { fixture } from './support/reviewFixture';
import { closeAll, launch, openView } from './support/viewHost';

const today = todayIn('Europe/Copenhagen');
const RYE = 'frida:413'; // 209 kcal per 100 g
const pasta = { name: 'Pasta carbonara at Luigi\'s', grams: 450, estimate_range: { kcal_low: 600, kcal_high: 900, protein_g: 30, carbs_g: 85, fat_g: 35 } };

let env: Env;
let ana: User;
let client: Client;
beforeEach(async () => {
  env = createTestEnv().env;
  ana = await signedInUser(env, 'ana@example.com');
  client = await connectAs(env, ana);
});
const log = (items: Record<string, unknown>[], day = today) => call(client, 'log_food', { day, items });
type Logged = { logged: { id: string; food: string; grams: number; kcal: number; protein: number; estimated?: boolean; kcalRange?: { low: number; high: number } }[]; totals: { kcal: number } };

describe('logging a meal out', () => {
  it('stores the middle of the range, marks it an estimate and keeps the range', async () => {
    const r = await log([pasta]);
    expect(r.isError, r.text).toBe(false);
    const e = (r.data as unknown as Logged).logged[0]!;
    expect(e).toMatchObject({ food: "Pasta carbonara at Luigi's", grams: 450, kcal: 750, protein: 30, estimated: true, kcalRange: { low: 600, high: 900 } });
    expect((r.data as unknown as Logged).totals.kcal).toBe(750); // every total uses the middle
    const day = (await call(client, 'get_food_log', { day: today })).data as unknown as { entries: Logged['logged'] };
    expect(day.entries[0]).toMatchObject({ kcal: 750, kcalRange: { low: 600, high: 900 }, estimated: true });
  });

  it('refuses a range that is backwards, too wide to be an estimate, or mixed with a food id, and stores nothing', async () => {
    const bad = [
      { ...pasta, estimate_range: { ...pasta.estimate_range, kcal_low: 900, kcal_high: 600 } },
      { ...pasta, estimate_range: { ...pasta.estimate_range, kcal_low: 200, kcal_high: 1500 } },
      { ...pasta, estimate_range: { ...pasta.estimate_range, protein_g: -1 } },
      { food_id: RYE, grams: 100, estimate_range: pasta.estimate_range },
      { estimate_range: pasta.estimate_range, grams: 100 }, // no name
      { name: 'No portion', estimate_range: pasta.estimate_range }, // a guess of the portion is still needed
    ];
    for (const item of bad) expect((await log([item])).isError, JSON.stringify(item).slice(0, 60)).toBe(true);
    expect(((await call(client, 'get_food_log', { day: today })).data as { entries: unknown[] }).entries).toEqual([]);
  });

  it('accepts the widest honest range: the top at most 2.5 times the bottom plus 50', async () => {
    expect((await log([{ ...pasta, estimate_range: { ...pasta.estimate_range, kcal_low: 400, kcal_high: 1050 } }])).isError).toBe(false);
    expect((await log([{ ...pasta, estimate_range: { ...pasta.estimate_range, kcal_low: 400, kcal_high: 1051 } }])).isError).toBe(true);
  });

  it('keeps the range when the meal is logged again from another day', async () => {
    const first = (await log([pasta], addDays(today, -1))).data as unknown as Logged;
    const copy = (await call(client, 'log_food', { day: today, copy_from: { day: addDays(today, -1) } })).data as unknown as Logged;
    expect(copy.logged[0]).toMatchObject({ kcal: 750, kcalRange: { low: 600, high: 900 }, estimated: true });
    expect(first.logged[0]!.kcalRange).toEqual({ low: 600, high: 900 });
  });

  it('scales the range with the amount when the entry has a portion', async () => {
    const r = await log([{ name: 'Burger', grams: 200, estimate_range: { kcal_low: 500, kcal_high: 700, protein_g: 30, carbs_g: 40, fat_g: 30 } }]);
    const id = (r.data as unknown as Logged).logged[0]!.id;
    await call(client, 'edit_food_entry', { id, grams: 100 });
    const e = ((await call(client, 'get_food_log', { day: today })).data as unknown as { entries: Logged['logged'] }).entries[0]!;
    expect(e).toMatchObject({ kcal: 300, kcalRange: { low: 250, high: 350 } });
  });

  it('exports the range with the entry', async () => {
    await log([pasta]);
    const out = (await call(client, 'export_my_data')).data as { foodEntries: { foodName: string; kcalRange?: { low: number; high: number } }[] };
    expect(out.foodEntries[0]).toMatchObject({ kcalRange: { low: 600, high: 900 } });
  });
});

describe('how much was estimated', () => {
  it('progress says the share of the period\'s calories that were estimates, in whole percent, and null with nothing logged', async () => {
    expect(((await call(client, 'get_progress', { days: 7 })).data as { nutrition: { estimatedKcalShare: number | null } }).nutrition.estimatedKcalShare).toBeNull();
    await log([{ food_id: RYE, grams: 500 }]); // 1045 kcal, exact
    await log([pasta]); // 750 kcal, estimated
    expect(((await call(client, 'get_progress', { days: 7 })).data as { nutrition: { estimatedKcalShare: number } }).nutrition.estimatedKcalShare).toBe(42); // 750 of 1795
  });

  it('counts a guessed amount of a database food as an estimate too, and nothing else', async () => {
    await log([{ food_id: RYE, grams: 100 }]); // 209, exact
    await log([{ food_id: RYE, grams: 100, amount_estimated: true }]); // 209, the amount is a guess
    expect(((await call(client, 'get_progress', { days: 7 })).data as { nutrition: { estimatedKcalShare: number } }).nutrition.estimatedKcalShare).toBe(50);
  });

  it('the weekly review carries it', async () => {
    await log([pasta]);
    const review = (await call(client, 'show_weekly_review', { week_start: weekStart(today) })).data as unknown as { review: WeekReview };
    expect(review.review.nutrition.estimatedKcalShare).toBe(100);
  });
});

describe('the views', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);

  it('the food summary shows a meal out with its portion and its range', async () => {
    const data = { day: '2026-10-13', logged: [{ id: 'a', slot: 'dinner', food: "Pasta carbonara at Luigi's", grams: 450, kcal: 750, protein: 30, carbs: 85, fat: 35, estimated: true, kcalRange: { low: 600, high: 900 } }, { id: 'b', slot: 'dinner', food: 'Rye bread, light', grams: 60, kcal: 125, protein: 3, carbs: 22, fat: 1 }], totals: { kcal: 875, protein: 33, carbs: 107, fat: 36 }, extras: {}, extrasIncomplete: [], goals: null };
    const v = await openView(foodHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: data });
    await pwExpect(v.frame.getByText("~Pasta carbonara at Luigi's · 450 g")).toBeVisible();
    await pwExpect(v.frame.getByText('~750 kcal (600 to 900)')).toBeVisible();
    await pwExpect(v.frame.getByText('Rye bread, light · 60 g')).toBeVisible();
    await pwExpect(v.frame.getByText('125 kcal', { exact: true })).toBeVisible();
  }, 30_000);

  it('the review says how much of the calories were estimates, only when some were', async () => {
    const r = (share: number | null): WeekReview => ({ ...fixture({ nutrition: { estimatedKcalShare: share } }), notes: { training: { text: 'A week.', next: null, source: 'auto', lowData: false }, nutrition: { text: 'Food.', next: null, source: 'auto', lowData: false } } });
    const some = await openView(reviewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: r(12) } });
    await some.frame.getByRole('button', { name: /^Food, \d+ of \d+$/ }).click();
    await pwExpect(some.frame.getByText('12 % of calories')).toBeVisible();
    const none = await openView(reviewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: r(0) } });
    await none.frame.getByRole('button', { name: /^Food, \d+ of \d+$/ }).click();
    await pwExpect(none.frame.getByText('Days logged')).toBeVisible();
    await pwExpect(none.frame.getByText('% of calories')).toHaveCount(0);
  }, 30_000);
});
