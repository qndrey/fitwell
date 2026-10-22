// The optional "How hard?" tap after a logged working set (Specs: Effort). The built view runs in a real Chromium inside an
// iframe and the test page plays the MCP Apps host; see tests/support/workoutHost.ts.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cardsOf, closed, closeBrowser, closeOpened, counterText, ex, jumpTo, launchBrowser, logCalls, openView, plan, set, settled, type Opened } from './support/workoutHost';
import type { PlannedExercise, WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const cardOf = (v: Opened, k: number) => cardsOf(v).nth(k + 1);
const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const group = (card: Locator) => card.getByRole('group', { name: /^How hard was/ });
const squat = (o: Partial<PlannedExercise> = {}) => ex('Squat', [set('w1', { warmup: true, weightKg: 40 }), set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 })], o);

async function onStep(p: WorkoutPlan, k = 0) {
  const v = await openView(p);
  await jumpTo(v, k + 1);
  await expect.poll(() => counterText(v)).toBe(`${k + 2} of ${p.exercises.length + p.cardio.length + 2}`);
  await settled(v);
  return { v, card: cardOf(v, k) };
}
/** Logs the current set and waits out the 600 ms lock. */
const log = async (v: Opened, card: Locator) => {
  await btn(card, 'Log set').click();
  await v.page.waitForTimeout(700);
};

describe('Specs: Effort tap', () => {
  it('is offered after a logged working set with four text buttons of at least 44 px, and not before', async () => {
    const { v, card } = await onStep(plan([squat()]));
    await pwExpect(group(card)).toHaveCount(0);
    await log(v, card); // the warm-up
    await btn(card, 'Skip rest').click();
    await v.page.waitForTimeout(700);
    await pwExpect(group(card)).toHaveCount(0);
    await log(v, card); // working set 1
    const g = group(card);
    await pwExpect(g).toBeVisible();
    await pwExpect(g.getByRole('button')).toHaveText(['Easy', 'Solid', 'Hard', 'Max']);
    for (const b of await g.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  it('is not offered after a skipped set, and logging nothing extra when ignored', async () => {
    const { v, card } = await onStep(plan([squat()]));
    await btn(card, 'Skip set').click();
    await v.page.waitForTimeout(700);
    await pwExpect(group(card)).toHaveCount(0);
    await btn(card, 'Skip set').click();
    await v.page.waitForTimeout(700);
    await btn(card, 'Log set').click(); // ignoring the tap and going on
    await v.page.waitForTimeout(100);
    expect(logCalls(v).every((c) => c.effort === undefined)).toBe(true);
  });

  it('a tap saves the effort with the set, marks the button pressed, announces it once and moves neither the dock nor the rest', async () => {
    const e = ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 })]);
    const { v, card } = await onStep(plan([e]));
    await log(v, card);
    const dockY = async () => (await btn(card, 'Skip rest').boundingBox())!.y;
    const before = await dockY();
    await btn(card, 'Hard').click();
    await pwExpect(btn(card, 'Hard')).toHaveAttribute('aria-pressed', 'true');
    await pwExpect(btn(card, 'Easy')).toHaveAttribute('aria-pressed', 'false');
    expect(Math.abs((await dockY()) - before)).toBeLessThanOrEqual(1);
    await pwExpect(card.getByRole('timer').first()).toBeVisible(); // the rest runs on
    await pwExpect(v.frame.getByRole('status')).toHaveText('Hard noted for set 1 of 2.');
    await expect.poll(() => logCalls(v).filter((c) => c.setId === '1').map((c) => c.effort)).toEqual([undefined, 3]);
  });

  it('the offer goes when the next set is logged; a logged row can still be given an effort in its editor', async () => {
    const e = ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })]);
    const { v, card } = await onStep(plan([e]));
    await log(v, card);
    await btn(card, 'Skip rest').click();
    await v.page.waitForTimeout(700);
    await log(v, card);
    await pwExpect(group(card)).toHaveCount(1);
    await pwExpect(group(card)).toHaveAttribute('aria-label', 'How hard was set 2 of 3?');
    await btn(card, 'Skip rest').click();
    await card.locator('[data-set-id="1"] button.rowbtn').click();
    await pwExpect(group(card)).toHaveCount(2); // the editor of set 1 and the offer for set 2
    await card.locator('li.editor').getByRole('button', { name: 'Max' }).click();
    await expect.poll(() => logCalls(v).filter((c) => c.setId === '1').pop()?.effort).toBe(4);
  });

  it('shows a saved effort on a resumed workout only in the editor, and not at all on a finished workout', async () => {
    const e = ex('Squat', [closed('1', { weightKg: 80, effort: 3 }), set('2', { weightKg: 80 })]);
    const { card } = await onStep(plan([e]));
    await pwExpect(group(card)).toHaveCount(0);
    await card.locator('[data-set-id="1"] button.rowbtn').click();
    await pwExpect(btn(card, 'Hard')).toHaveAttribute('aria-pressed', 'true');
  });
});
