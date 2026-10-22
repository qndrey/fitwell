// Finished warm-ups fold into one row (Specs: Warm-ups). The built view runs in a real Chromium inside an iframe and the test
// page plays the MCP Apps host; see tests/support/workoutHost.ts.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cardsOf, closed, closeBrowser, closeOpened, counterText, ex, jumpTo, launchBrowser, openView, plan, set, settled, skipped, type Opened } from './support/workoutHost';
import type { PlannedSet, WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const cardOf = (v: Opened, k: number) => cardsOf(v).nth(k + 1);
const toggle = (card: Locator) => card.locator('[data-key="warmups-toggle"]');
const setRows = (card: Locator) => card.locator('li.srow.logged[data-set-id]');
const warm = (id: string, o: Partial<PlannedSet> = {}) => closed(id, { warmup: true, weightKg: 40, ...o });
const squat = (warmups: PlannedSet[]) => ex('Squat', [...warmups, set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 })]);

async function onStep(p: WorkoutPlan, k = 0) {
  const v = await openView(p);
  await jumpTo(v, k + 1);
  await expect.poll(() => counterText(v)).toBe(`${k + 2} of ${p.exercises.length + p.cardio.length + 2}`);
  await settled(v);
  return { v, card: cardOf(v, k) };
}

describe('Specs: Warm-ups fold', () => {
  it('shows finished warm-ups as one 44 px button "Warm-ups ✓✓✓✓ 4 done", collapsed, instead of four rows', async () => {
    const { card } = await onStep(plan([squat([warm('w1'), warm('w2'), warm('w3'), warm('w4')])]));
    const t = toggle(card);
    await pwExpect(t).toHaveText(/Warm-ups\s*✓✓✓✓\s*4 done/);
    await pwExpect(t).toHaveAttribute('aria-expanded', 'false');
    expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pwExpect(setRows(card)).toHaveCount(0);
    await pwExpect(card.getByRole('button', { name: 'Log set' })).toBeVisible();
    await pwExpect(card.getByRole('heading', { name: 'Squat' })).toBeVisible();
  });

  it('a tap expands to the individual rows and a second tap folds them again; the set zone moves back up', async () => {
    const { v, card } = await onStep(plan([squat([warm('w1'), warm('w2'), warm('w3'), warm('w4')])]));
    const zone = card.locator('[data-zone]');
    const folded = (await zone.boundingBox())!.y;
    await toggle(card).click();
    await pwExpect(toggle(card)).toHaveAttribute('aria-expanded', 'true');
    await pwExpect(setRows(card)).toHaveCount(4);
    expect((await zone.boundingBox())!.y).toBeGreaterThan(folded + 100);
    await v.page.waitForTimeout(100);
    await toggle(card).click();
    await pwExpect(toggle(card)).toHaveAttribute('aria-expanded', 'false');
    await pwExpect(setRows(card)).toHaveCount(0);
    expect((await zone.boundingBox())!.y).toBeCloseTo(folded, 0);
  });

  it('counts skipped warm-ups separately, and does not fold while one is still open', async () => {
    const a = await onStep(plan([squat([warm('w1'), warm('w2'), skipped('w3', { warmup: true })])]));
    await pwExpect(toggle(a.card)).toHaveText(/✓✓–\s*2 done, 1 skipped/);
    await closeOpened();
    const b = await onStep(plan([squat([warm('w1'), set('w2', { warmup: true, weightKg: 60 })])]));
    await pwExpect(toggle(b.card)).toHaveCount(0);
    await pwExpect(setRows(b.card)).toHaveCount(1); // the logged warm-up; the open one is the set zone
  });

  it('is a real button in the tab order before the set zone, and keeps focus after a tap', async () => {
    const { card } = await onStep(plan([squat([warm('w1'), warm('w2')])]));
    await toggle(card).focus();
    await card.page().keyboard.press('Enter');
    await pwExpect(toggle(card)).toHaveAttribute('aria-expanded', 'true');
    await pwExpect(toggle(card)).toBeFocused();
    const order = await card.locator('button, input').evaluateAll((els) => els.map((e) => e.getAttribute('data-key') ?? e.textContent));
    expect(order.indexOf('warmups-toggle')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('warmups-toggle')).toBeLessThan(order.indexOf('log'));
  });
});
