// The food summary as a person sees it: the built view in a real Chromium, fed what log_food returns.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import viewHtml from '../src/ui/generated/food';
import { closeAll, launch, openView } from './support/viewHost';

beforeAll(launch, 60_000);
afterAll(closeAll);

const logged = (goals: Record<string, number | null> | null, extras: Record<string, number> = { satFat: 1.2, transFat: 0, sugar: 4.2, addedSugar: 0, fiber: 16.2, salt: 1.8 }) => ({
  day: '2026-10-13',
  logged: [
    { id: 'a', slot: 'lunch', food: 'Oats, rolled', grams: 80, kcal: 298, protein: 10, carbs: 50, fat: 5 },
    { id: 'b', slot: 'lunch', food: 'Rye bread, light', grams: 120, kcal: 251, protein: 8, carbs: 45, fat: 2 },
  ],
  totals: { kcal: 549, protein: 18, carbs: 95, fat: 7 },
  extras,
  extrasIncomplete: [],
  goals,
});
const open = (data: unknown) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: data });

describe('food summary', () => {
  it('has no ring: calories are a number, a thin meter and what is left, under a heading with a check icon', async () => {
    const v = await open(logged({ kcal: 2300, proteinG: 150, carbsG: 256, fatG: 75, fiberG: 30, satFatG: 20, addedSugarG: 25 }));
    const f = v.frame;
    await pwExpect(f.getByRole('heading', { name: 'Meal logged' }).locator('svg.icon')).toHaveCount(1);
    await pwExpect(f.getByText('1,751 kcal left')).toBeVisible();
    await pwExpect(f.getByRole('img', { name: '24 % of the calorie goal' })).toBeVisible();
    await pwExpect(f.locator('svg[role="img"]')).toHaveCount(0); // the ring is gone
    await pwExpect(f.locator('.cal svg')).toHaveCount(0);
    // Sentence case, not capitals: the labels are said as they are written.
    const transform = await f.locator('.macro .name').first().evaluate((e) => (globalThis as unknown as { getComputedStyle(el: unknown): { textTransform: string } }).getComputedStyle(e).textTransform);
    expect(transform).toBe('none');
    await pwExpect(f.locator('.stats .stat')).toHaveCount(6);
    await pwExpect(f.locator('.stats .stat .bar')).toHaveCount(3); // a meter only where there is a goal: sat. fat, added sugar, fibre
    await pwExpect(f.getByText('limit 20 g')).toBeVisible();
    await pwExpect(f.getByText('No goal set for trans fat, sugar and salt.')).toBeVisible(); // once, not once per stat
    await pwExpect(f.getByText('no goal set', { exact: true })).toHaveCount(0);
  }, 60_000);

  it('leaves the calorie line without a meter when there is no goal, and says so for the extras in one line', async () => {
    const v = await open(logged({ kcal: null, proteinG: null, carbsG: null, fatG: null }));
    const f = v.frame;
    await pwExpect(f.getByText('Calories today')).toBeVisible();
    await pwExpect(f.getByRole('img', { name: /calorie goal/ })).toHaveCount(0);
    await pwExpect(f.getByText('No limits set. Ask Claude to set fibre or sugar goals.')).toBeVisible();
  }, 60_000);
});
