// P5: the exercise card (rows, current-set zone), logging, the 600 ms lock, the stepper, edit and re-open, and rest
// (Specs: Exercise card layout, Logging, skipping, stepper, Edit and re-open, Rest). The built view runs in a real Chromium
// inside an iframe and the test page plays the MCP Apps host; see tests/support/workoutHost.ts.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  calledTools,
  cardsOf,
  closed,
  closeBrowser,
  closeOpened,
  counterText,
  effects,
  ex,
  jumpTo,
  launchBrowser,
  logCalls,
  openView,
  plan,
  set,
  skipped,
  type Dom,
  type DomNode,
  type HostOptions,
  type Opened,
} from './support/workoutHost';
import type { PlannedExercise, WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

// ---------- locators (the interface assumptions are listed in the reply) ----------
/** Card of exercise step `k` (0-based): position k + 1 after the Overview. */
const cardOf = (v: Opened, k: number) => cardsOf(v).nth(k + 1);
const rowOf = (card: Locator, id: string) => card.locator(`[data-set-id="${id}"]`);
const zoneOf = (card: Locator) => card.locator('[data-zone]');
const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const logBtn = (card: Locator) => btn(card, 'Log set');
const skipBtn = (card: Locator) => btn(card, 'Skip set');
const timerOf = (card: Locator) => card.getByRole('timer');
const inc = (card: Locator, what: 'reps' | 'weight') => btn(card, new RegExp(`^Increase ${what}`, 'i'));
const MINUS_15 = '−15 s';

async function onStep(p: WorkoutPlan, k: number, o: HostOptions = {}) {
  const v = await openView(p, o);
  await jumpTo(v, k + 1);
  await expect.poll(() => counterText(v)).toBe(`${k + 2} / ${p.exercises.length + p.cardio.length + 2}`);
  return { v, card: cardOf(v, k) };
}
/** Reads "Reps: 5. Tap to type a value." style labels. */
const valueOf = async (card: Locator, label: 'Reps' | 'Weight kg' | 'Seconds') => {
  const name = await card.getByRole('button', { name: new RegExp(`^${label}: `) }).first().getAttribute('aria-label');
  return Number.parseFloat((name ?? '').slice(label.length + 2));
};
/** "m:ss" of the running rest on a card, as seconds. */
const restSeconds = async (card: Locator) => {
  const text = ((await timerOf(card).first().textContent()) ?? '').trim();
  const m = /^(\d+):(\d\d)$/.exec(text);
  if (!m) throw new Error(`not a clock: ${text}`);
  return Number(m[1]) * 60 + Number(m[2]);
};
const squat3 = (o: Partial<PlannedExercise> = {}) => ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })], { lastTime: '5 @ 80, 5 @ 80 (2026-10-09)', ...o });
const bench = () => ex('Bench Press', [set('1', { weightKg: 60 }), set('2', { weightKg: 60 })]);
const twoClicks = (b: Locator) =>
  b.evaluate((el) => {
    const n = el as unknown as DomNode;
    n.click();
    n.click();
  });

// ---------- P5.1 Exercise card layout ----------
describe('Specs: Exercise card layout (P5.1)', () => {
  it('top to bottom: the heading with the exercise name, one "Last time" line, then the set rows', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0);
    const heading = card.getByRole('heading', { name: /Squat/ });
    await pwExpect(heading).toBeVisible();
    const last = card.getByText(/Last time/).first();
    await pwExpect(last).toBeVisible();
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    expect(await y(heading)).toBeLessThan(await y(last));
    expect(await y(last)).toBeLessThan(await y(rowOf(card, '2')));
  });

  it('the sets list shows warm-ups first, then the working sets', async () => {
    const e = ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 }), set('w1', { warmup: true, weightKg: 40 }), set('w2', { warmup: true, weightKg: 60 })]);
    const { card } = await onStep(plan([e]), 0);
    const ids = await card.locator('[data-set-id], [data-zone]').evaluateAll((els) => els.map((el) => el.getAttribute('data-set-id') ?? 'zone'));
    // The zone stands in for the first open row, which is the first warm-up.
    expect(ids).toEqual(['zone', 'w2', '1', '2']);
  });

  it('the current-set zone sits in place of the first open row: logged rows above it, open rows below it', async () => {
    const e = ex('Squat', [closed('1', { weightKg: 80 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 }), set('4', { weightKg: 82.5 })]);
    const { card } = await onStep(plan([e]), 0);
    const ids = await card.locator('[data-set-id], [data-zone]').evaluateAll((els) => els.map((el) => el.getAttribute('data-set-id') ?? 'zone'));
    expect(ids).toEqual(['1', 'zone', '3', '4']);
  });

  it('a logged row shows a check mark and the logged values, a skipped row a dash, an open row its target', async () => {
    const e = ex('Squat', [closed('1', { reps: 6, weightKg: 85 }), skipped('2'), set('3', { weightKg: 82.5 }), set('4', { weightKg: 82.5, targetReps: 8 })]);
    const { card } = await onStep(plan([e]), 0);
    await pwExpect(rowOf(card, '1')).toContainText('✓');
    await pwExpect(rowOf(card, '1')).toContainText('6 × 85 kg');
    await pwExpect(rowOf(card, '2')).toContainText('–');
    await pwExpect(rowOf(card, '2')).not.toContainText('✓');
    await pwExpect(rowOf(card, '4')).toContainText('8 × 82.5 kg');
    await pwExpect(rowOf(card, '4')).not.toContainText('✓');
  });

  it('the zone is as tall as about half the track and Log set stays where it was from set to set', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    const track = (await v.frame.locator('[aria-roledescription="carousel"]').boundingBox())!.height;
    const zone = (await zoneOf(card).boundingBox())!;
    expect(zone.height).toBeGreaterThanOrEqual(track * 0.4);
    expect(zone.height).toBeLessThanOrEqual(track * 0.6);
    // Log set keeps its place inside the zone (the zone itself moves down by the logged row that appears above it).
    const offset = async () => (await logBtn(card).boundingBox())!.y - (await zoneOf(card).boundingBox())!.y;
    const before = await offset();
    await logBtn(card).click();
    await v.page.waitForTimeout(700); // out of the 600 ms lock
    await btn(card, 'Skip rest').click();
    await pwExpect(rowOf(card, '1')).toContainText('✓');
    expect(Math.abs((await offset()) - before)).toBeLessThanOrEqual(1);
    expect(Math.abs((await zoneOf(card).boundingBox())!.height - zone.height)).toBeLessThanOrEqual(1);
  });
});

// ---------- P5.2 Log and skip ----------
describe('Specs: Logging, skipping, stepper rules 1 and 4 (P5.2)', () => {
  it('rule 1: Log set calls log_set with workoutId, setId, reps, skip false and weightKg, and the row turns logged at once', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await pwExpect(rowOf(card, '1')).toContainText('✓');
    await pwExpect(rowOf(card, '1')).toContainText('5 × 82.5 kg');
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 5, skip: false, weightKg: 82.5 }]);
  });

  it('rule 1: a changed value goes into the call (reps +1, weight +2.5 kg)', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await inc(card, 'reps').click();
    await inc(card, 'weight').click();
    await logBtn(card).click();
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 6, skip: false, weightKg: 85 }]);
    await pwExpect(rowOf(card, '1')).toContainText('6 × 85 kg');
  });

  it('rule 1: the zone advances, so the next Log set logs the next set', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await v.page.waitForTimeout(700); // out of the 600 ms lock
    await btn(card, 'Skip rest').click();
    await v.page.waitForTimeout(700);
    await logBtn(card).click();
    await expect.poll(() => logCalls(v).map((a) => a.setId)).toEqual(['1', '2']);
  });

  it('rule 1: Skip set calls log_set with skip true, shows a dash and starts no rest', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await skipBtn(card).click();
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 0, skip: true }]);
    await pwExpect(rowOf(card, '1')).toContainText('–');
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('rule 4: a bodyweight exercise sends no weightKg and shows "Bodyweight" instead of the weight stepper', async () => {
    const e = ex('Push-up', [set('1', { weightKg: undefined, targetReps: 12 }), set('2', { weightKg: undefined, targetReps: 12 })], { bodyweight: true, equipment: 'bodyweight' });
    const { v, card } = await onStep(plan([e]), 0);
    await pwExpect(card).toContainText('Bodyweight');
    await pwExpect(inc(card, 'weight')).toHaveCount(0);
    await logBtn(card).click();
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 12, skip: false }]);
  });

  it('rule 4: a timed exercise shows a seconds stepper (step 5) and sends seconds', async () => {
    const e = ex('Plank', [set('1', { weightKg: undefined, targetSec: 30, targetReps: 0 })], { bodyweight: true, timed: true, equipment: 'bodyweight' });
    const { v, card } = await onStep(plan([e]), 0);
    expect(await valueOf(card, 'Seconds')).toBe(30);
    await btn(card, /^Increase seconds/i).click();
    expect(await valueOf(card, 'Seconds')).toBe(35);
    await logBtn(card).click();
    await expect.poll(() => logCalls(v)[0]).toMatchObject({ workoutId: 'w1', setId: '1', skip: false, seconds: 35 });
    expect(logCalls(v)[0]).not.toHaveProperty('weightKg');
  });

  it('rule 4: the weight step follows the equipment (barbell 2.5 kg)', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0);
    await pwExpect(card.getByRole('button', { name: 'Increase weight by 2.5 kg' })).toBeVisible();
    const w = await valueOf(card, 'Weight kg');
    await inc(card, 'weight').click();
    expect(await valueOf(card, 'Weight kg')).toBe(w + 2.5);
  });
});

// ---------- P5.3 Lock ----------
describe('Specs: Logging, skipping, stepper rule 2 (600 ms lock; AC17)', () => {
  it('two taps on Log set within 300 ms log one set', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await twoClicks(logBtn(card));
    await v.page.waitForTimeout(500);
    expect(logCalls(v)).toHaveLength(1);
  });

  it('Skip set right after Log set is ignored, and a tap after 600 ms works', async () => {
    // No rest (restSec 0), so the set controls stay in the zone and Skip set is on screen right after Log set.
    const { v, card } = await onStep(plan([squat3({ restSec: 0 }), bench()]), 0);
    await logBtn(card).click();
    await skipBtn(card).evaluate((el) => (el as unknown as DomNode).click());
    await v.page.waitForTimeout(300);
    expect(logCalls(v)).toHaveLength(1);
    await v.page.waitForTimeout(500);
    await skipBtn(card).click();
    await expect.poll(() => logCalls(v)).toEqual([
      { workoutId: 'w1', setId: '1', reps: 5, skip: false, weightKg: 82.5 },
      { workoutId: 'w1', setId: '2', reps: 0, skip: true },
    ]);
  });

  it('Skip rest right after Log set is ignored: the rest keeps running', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await btn(card, 'Skip rest').evaluate((el) => (el as unknown as DomNode).click());
    await v.page.waitForTimeout(300);
    await pwExpect(timerOf(card).first()).toBeVisible();
    await v.page.waitForTimeout(500);
    await btn(card, 'Skip rest').click();
    await pwExpect(timerOf(card)).toHaveCount(0);
  });
});

// ---------- P5.4 Stepper ----------
describe('Specs: Logging, skipping, stepper rule 3 (AC4)', () => {
  const stepper = async () => {
    const o = await onStep(plan([squat3(), bench()]), 0, { clock: true });
    const button = inc(o.card, 'reps');
    const box = (await button.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    return { ...o, button, at, reps: () => valueOf(o.card, 'Reps') };
  };

  it('a quick tap changes the value by one step', async () => {
    const { reps, button } = await stepper();
    expect(await reps()).toBe(5);
    await button.click();
    expect(await reps()).toBe(6);
  });

  it('pressing and moving 20 px sideways changes no value', async () => {
    const { v, reps, at } = await stepper();
    await v.page.mouse.move(at.x, at.y);
    await v.page.mouse.down();
    await v.page.mouse.move(at.x + 20, at.y);
    await v.page.mouse.up();
    expect(await reps()).toBe(5);
  });

  it('a pointercancel after the press changes no value', async () => {
    const { v, card, reps, at } = await stepper();
    await v.page.mouse.move(at.x, at.y);
    await v.page.mouse.down();
    await inc(card, 'reps').evaluate((el) => {
      const d = globalThis as unknown as Dom;
      (el as unknown as DomNode).dispatchEvent(new d.PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    });
    await v.page.mouse.up();
    expect(await reps()).toBe(5);
  });

  it('holding 450 ms starts repeating every 90 ms; lifting stops it', async () => {
    const { v, reps, at } = await stepper();
    await v.page.mouse.move(at.x, at.y);
    await v.page.mouse.down();
    await v.page.clock.runFor(300);
    expect(await reps()).toBe(5);
    await v.page.clock.runFor(150 + 90 * 4 + 20);
    await expect.poll(async () => (await reps()) - 5).toBeGreaterThanOrEqual(4);
    expect((await reps()) - 5).toBeLessThanOrEqual(7);
    await v.page.mouse.up();
    const after = await reps();
    await v.page.clock.runFor(1000);
    expect(await reps()).toBe(after);
  });

  it('repeating stops by itself within 4000 ms', async () => {
    const { v, reps, at } = await stepper();
    await v.page.mouse.move(at.x, at.y);
    await v.page.mouse.down();
    await v.page.clock.runFor(4600);
    const at4600 = await reps();
    await v.page.clock.runFor(1500);
    expect(await reps()).toBe(at4600);
    expect(at4600 - 5).toBeGreaterThan(20);
    expect(at4600 - 5).toBeLessThanOrEqual(45);
    await v.page.mouse.up();
  });

  it('moving over 10 px while repeating stops it', async () => {
    const { v, reps, at } = await stepper();
    await v.page.mouse.move(at.x, at.y);
    await v.page.mouse.down();
    await v.page.clock.runFor(450 + 90 * 3);
    await v.page.mouse.move(at.x + 30, at.y);
    const moved = await reps();
    await v.page.clock.runFor(1000);
    expect(await reps()).toBe(moved);
    await v.page.mouse.up();
  });

  it('window blur stops repeating', async () => {
    const { v, reps, at } = await stepper();
    await v.page.mouse.move(at.x, at.y);
    await v.page.mouse.down();
    await v.page.clock.runFor(450 + 90 * 3);
    await v.inView(() => {
      const d = globalThis as unknown as Dom;
      d.window.dispatchEvent(new d.Event('blur'));
    });
    const stopped = await reps();
    await v.page.clock.runFor(1000);
    expect(await reps()).toBe(stopped);
    await v.page.mouse.up();
  });

  it('visibilitychange stops repeating', async () => {
    const { v, reps, at } = await stepper();
    await v.page.mouse.move(at.x, at.y);
    await v.page.mouse.down();
    await v.page.clock.runFor(450 + 90 * 3);
    await v.inView(() => {
      const d = globalThis as unknown as Dom;
      Object.defineProperty(d.document, 'hidden', { value: true, configurable: true });
      d.document.dispatchEvent(new d.Event('visibilitychange'));
    });
    const stopped = await reps();
    await v.page.clock.runFor(1000);
    expect(await reps()).toBe(stopped);
    await v.page.mouse.up();
  });

  it('a keyboard click steps once', async () => {
    const { button, reps } = await stepper();
    await button.focus();
    await button.press('Enter');
    expect(await reps()).toBe(6);
    await button.press('Space');
    expect(await reps()).toBe(7);
  });

  it('typing a value stays possible and is applied before the step', async () => {
    const { card, reps } = await stepper();
    await card.getByRole('button', { name: /^Reps: 5\./ }).click();
    const field = card.getByRole('textbox', { name: 'Reps' });
    await field.fill('9');
    await inc(card, 'reps').click();
    expect(await reps()).toBe(10);
  });
});

// ---------- P5.5 Edit and re-open ----------
describe('Specs: Edit and re-open (P5.5; AC3)', () => {
  const resumed = () => plan([ex('Squat', [closed('1', { reps: 5, weightKg: 82.5 }), closed('2', { reps: 5, weightKg: 82.5 }), set('3', { weightKg: 82.5 })]), bench()]);
  const saveBtn = (card: Locator) => btn(card, 'Save changes');
  /** Set 1 is closed and sets 2 and 3 are open, so logging set 2 is not the last set and starts a rest. */
  const midway = () => plan([ex('Squat', [closed('1', { reps: 5, weightKg: 82.5 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })]), bench()]);

  it('tapping a logged row opens an editor with Save changes, Cancel and Mark as not done', async () => {
    const { card } = await onStep(resumed(), 0);
    await rowOf(card, '1').click();
    await pwExpect(saveBtn(card)).toBeVisible();
    await pwExpect(btn(card, 'Cancel')).toBeVisible();
    await pwExpect(btn(card, 'Mark as not done')).toBeVisible();
    await pwExpect(inc(card, 'reps').first()).toBeVisible();
  });

  it('the editor opens under the tapped row and only one editor is open at a time', async () => {
    const { card } = await onStep(resumed(), 0);
    await rowOf(card, '1').click();
    await rowOf(card, '2').click();
    await pwExpect(saveBtn(card)).toHaveCount(1);
    const row2 = (await rowOf(card, '2').boundingBox())!;
    const save = (await saveBtn(card).boundingBox())!;
    expect(save.y).toBeGreaterThan(row2.y);
  });

  it('Cancel closes the editor and sends nothing', async () => {
    const { v, card } = await onStep(resumed(), 0);
    await rowOf(card, '1').click();
    await btn(card, 'Cancel').click();
    await pwExpect(saveBtn(card)).toHaveCount(0);
    expect(logCalls(v)).toEqual([]);
  });

  it('Save changes updates the row and sends log_set for the same set without starting a rest', async () => {
    const { v, card } = await onStep(resumed(), 0);
    await rowOf(card, '1').click();
    await inc(card, 'reps').first().click();
    await saveBtn(card).click();
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 6, skip: false, weightKg: 82.5 }]);
    await pwExpect(rowOf(card, '1')).toContainText('6 × 82.5 kg');
    await pwExpect(saveBtn(card)).toHaveCount(0);
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('Save changes leaves a running rest unchanged', async () => {
    const { v, card } = await onStep(midway(), 0, { clock: true });
    await logBtn(card).click();
    await v.page.clock.runFor(20_000);
    const before = await restSeconds(card);
    await rowOf(card, '1').click();
    await inc(card, 'reps').first().click();
    await saveBtn(card).click();
    expect(Math.abs((await restSeconds(card)) - before)).toBeLessThanOrEqual(2);
  });

  it('Mark as not done sends log_set with reopen, makes that set the current one and cancels a running rest', async () => {
    const { v, card } = await onStep(midway(), 0);
    await logBtn(card).click();
    await pwExpect(timerOf(card).first()).toBeVisible();
    await v.page.waitForTimeout(700);
    await rowOf(card, '1').click();
    await btn(card, 'Mark as not done').click();
    await expect.poll(() => logCalls(v).at(-1)).toMatchObject({ workoutId: 'w1', setId: '1', reps: 0, reopen: true });
    await pwExpect(timerOf(card)).toHaveCount(0);
    await pwExpect(rowOf(card, '1')).toHaveCount(0); // set 1 is the first open set again: the zone stands in for its row
    // Set 1 is the first open set now, so Log set logs it again.
    await v.page.waitForTimeout(700);
    await logBtn(card).click();
    await expect.poll(() => logCalls(v).at(-1)).toMatchObject({ setId: '1', skip: false });
  });

  it('a skipped row shows Undo skip, which re-opens the set', async () => {
    const e = ex('Squat', [skipped('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 })]);
    const { v, card } = await onStep(plan([e, bench()]), 0);
    await pwExpect(rowOf(card, '1')).toContainText('–');
    await btn(card, 'Undo skip').click();
    await expect.poll(() => logCalls(v).at(-1)).toMatchObject({ workoutId: 'w1', setId: '1', reps: 0, reopen: true });
    await pwExpect(btn(card, 'Undo skip')).toHaveCount(0);
    // Set 1 is the first open set again, so the zone stands in for its row.
    await pwExpect(rowOf(card, '1')).toHaveCount(0);
    await pwExpect(zoneOf(card)).toBeVisible();
    await v.page.waitForTimeout(700);
    await logBtn(card).click();
    await expect.poll(() => logCalls(v).at(-1)).toMatchObject({ setId: '1', skip: false });
  });

  it('rows stay editable until the workout is finished; after that there is no editor, no stepper, no Log set', async () => {
    const e = ex('Squat', [closed('1', { weightKg: 82.5 }), closed('2', { weightKg: 82.5 })]);
    const open = await onStep(plan([e], [], { finished: false }), 0);
    await open.card.locator('[data-set-id="1"]').click();
    await pwExpect(saveBtn(open.card)).toBeVisible();

    const v = await openView(plan([e], [], { finished: true }));
    await jumpTo(v, 1);
    await expect.poll(() => counterText(v)).toBe('2 / 3');
    const card = cardOf(v, 0);
    await rowOf(card, '1').click({ force: true });
    await pwExpect(saveBtn(card)).toHaveCount(0);
    await pwExpect(btn(card, 'Mark as not done')).toHaveCount(0);
    await pwExpect(logBtn(card)).toHaveCount(0);
    await pwExpect(inc(card, 'reps')).toHaveCount(0);
    expect(logCalls(v)).toEqual([]);
  });
});

// ---------- P5.6 / P5.7 / P5.8 Rest ----------
describe('Specs: Rest rule 1 (P5.6; AC2)', () => {
  it('a logged set that is not the last starts the rest for the exercise (restSec)', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0, { clock: true });
    await logBtn(card).click();
    expect(await restSeconds(card)).toBeGreaterThanOrEqual(89);
    expect(await restSeconds(card)).toBeLessThanOrEqual(90);
  });

  it('a warm-up rest is capped at 60 s', async () => {
    const e = ex('Squat', [set('w1', { warmup: true, weightKg: 40 }), set('w2', { warmup: true, weightKg: 60 }), set('1', { weightKg: 82.5 })], { restSec: 180 });
    const { card } = await onStep(plan([e]), 0, { clock: true });
    await logBtn(card).click();
    expect(await restSeconds(card)).toBeLessThanOrEqual(60);
    expect(await restSeconds(card)).toBeGreaterThanOrEqual(59);
  });

  it('a working-set rest longer than 60 s is not capped', async () => {
    const e = ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 })], { restSec: 180 });
    const { card } = await onStep(plan([e]), 0, { clock: true });
    await logBtn(card).click();
    expect(await restSeconds(card)).toBeGreaterThan(170);
  });

  it('restSec 0 starts no rest', async () => {
    const e = ex('Squat', [set('1'), set('2')], { restSec: 0 });
    const { card } = await onStep(plan([e]), 0);
    await logBtn(card).click();
    await pwExpect(rowOf(card, '1')).toContainText('✓');
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('the last set of an exercise starts no rest', async () => {
    const e = ex('Squat', [closed('1'), set('2')]);
    const { card } = await onStep(plan([e]), 0);
    await logBtn(card).click();
    await pwExpect(rowOf(card, '2')).toContainText('✓');
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('a new rest replaces the running one and the time follows absolute timestamps', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0, { clock: true });
    await logBtn(card).click();
    // One jump of the clock, however few timer ticks fire: the display still follows the real elapsed time.
    await v.page.clock.fastForward(30_000);
    await expect.poll(() => restSeconds(card)).toBeLessThanOrEqual(60);
    expect(await restSeconds(card)).toBeGreaterThanOrEqual(58);
    await btn(card, 'Change').click();
    await v.page.clock.fastForward(1000);
    await logBtn(card).click();
    await expect.poll(() => restSeconds(card)).toBeGreaterThanOrEqual(88);
    await expect.poll(() => logCalls(v).map((a) => a.setId)).toEqual(['1', '2']);
    await pwExpect(timerOf(card).first()).toBeVisible();
  });

  it('swiping to another card shows the header rest chip, and tapping Go returns to the resting card', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await jumpTo(v, 2);
    await expect.poll(() => counterText(v)).toBe('3 / 4');
    const chip = v.frame.getByText(/^Rest \d+:\d\d · Squat/);
    await pwExpect(chip).toBeVisible();
    await v.frame.getByRole('button', { name: 'Go', exact: true }).click();
    await expect.poll(() => counterText(v)).toBe('2 / 4');
  });
});

describe('Specs: Rest rules 2 and 3 (P5.7; AC2, AC20)', () => {
  it('the rest zone shows "Rest", the time as a timer, and "Next:" with the next set and its values', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await pwExpect(zoneOf(card)).toContainText('Rest');
    await pwExpect(timerOf(card).first()).toHaveText(/^\d+:\d\d$/);
    await pwExpect(zoneOf(card)).toContainText(/Next: .*5 × 82\.5 kg/);
    expect(await timerOf(card).first().getAttribute('aria-live')).toBeNull();
  });

  it('Change shows the next set\'s steppers in the zone while the timer keeps running', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0, { clock: true });
    await logBtn(card).click();
    await btn(card, 'Change').click();
    await pwExpect(inc(card, 'reps').first()).toBeVisible();
    await pwExpect(logBtn(card)).toBeVisible();
    const before = await restSeconds(card);
    await v.page.clock.runFor(5000);
    await expect.poll(() => restSeconds(card)).toBeLessThanOrEqual(before - 4);
  });

  it('the pinned bar has the time, -15 s, +15 s and Skip rest, each 44 px high or more', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    for (const name of [MINUS_15, '+15 s', 'Skip rest']) {
      const b = btn(card, name);
      await pwExpect(b).toBeVisible();
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  it('-15 s and +15 s change the remaining time by 15 s', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0, { clock: true });
    await logBtn(card).click();
    const start = await restSeconds(card);
    await btn(card, MINUS_15).click();
    await expect.poll(() => restSeconds(card)).toBeLessThanOrEqual(start - 14);
    expect(await restSeconds(card)).toBeGreaterThanOrEqual(start - 16);
    await btn(card, '+15 s').click();
    await expect.poll(() => restSeconds(card)).toBeGreaterThanOrEqual(start - 1);
  });

  it('-15 s never takes the remaining time below 1 s, and the rest has not ended', async () => {
    const e = ex('Squat', [set('1'), set('2')], { restSec: 10 });
    const { v, card } = await onStep(plan([e]), 0, { clock: true });
    await logBtn(card).click();
    await btn(card, MINUS_15).click();
    await expect.poll(() => restSeconds(card)).toBeLessThanOrEqual(1);
    expect(await restSeconds(card)).toBeGreaterThanOrEqual(0);
    await pwExpect(timerOf(card).first()).toBeVisible();
    await v.page.clock.runFor(500);
    await pwExpect(timerOf(card).first()).toBeVisible();
    // The +15 s that follows is relative to the clamped remaining time (about 1 s), not to the old one.
    await btn(card, '+15 s').click();
    expect(await restSeconds(card)).toBeLessThanOrEqual(17);
  });

  it('Skip rest clears the rest and the zone shows the next set', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await v.page.waitForTimeout(700); // out of the 600 ms lock
    await btn(card, 'Skip rest').click();
    await pwExpect(timerOf(card)).toHaveCount(0);
    await pwExpect(logBtn(card)).toBeVisible();
    await pwExpect(v.frame.getByText(/^Rest \d+:\d\d · /)).toHaveCount(0);
  });
});

describe('Specs: Rest rules 4 and 5 (P5.8; AC20)', () => {
  const short = () => plan([ex('Squat', [set('1'), set('2'), set('3')], { restSec: 5 }), bench()]);

  it('at zero the rest clears, the view beeps twice, vibrates 200 ms and announces "Rest over."', async () => {
    const { v, card } = await onStep(short(), 0, { clock: true });
    await logBtn(card).click();
    await pwExpect(timerOf(card).first()).toBeVisible();
    await v.page.clock.runFor(5600);
    await pwExpect(timerOf(card)).toHaveCount(0);
    await expect.poll(async () => (await effects(v)).oscillators).toBe(2);
    expect((await effects(v)).vibrations).toContain(200);
    await v.page.clock.runFor(200);
    await pwExpect(v.frame.locator('#status')).toHaveText('Rest over.');
    await pwExpect(logBtn(card)).toBeVisible();
  });

  it('a rest that ended while the page was in the background shows its end state when the page is visible again', async () => {
    const { v, card } = await onStep(short(), 0, { clock: true });
    await logBtn(card).click();
    await v.inView(() => {
      const d = globalThis as unknown as Dom;
      Object.defineProperty(d.document, 'hidden', { value: true, configurable: true });
    });
    await v.page.clock.fastForward(30_000);
    await v.inView(() => {
      const d = globalThis as unknown as Dom;
      Object.defineProperty(d.document, 'hidden', { value: false, configurable: true });
      d.document.dispatchEvent(new d.Event('visibilitychange'));
    });
    await pwExpect(timerOf(card)).toHaveCount(0);
    await pwExpect(logBtn(card)).toBeVisible();
  });

  it('the one-second tick updates every [data-clock] node together (clocks are text nodes, not live regions)', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0, { clock: true });
    await logBtn(card).click();
    await jumpTo(v, 2);
    await expect.poll(() => counterText(v)).toBe('3 / 4');
    const read = () =>
      v.inView(() => {
        const d = globalThis as unknown as Dom;
        return [...d.document.querySelectorAll('[data-clock]')].map((n) => ({ text: n.textContent, live: !!n.closest('[aria-live], [role="status"], [role="alert"]') }));
      });
    const before = await read();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((c) => !c.live)).toBe(true);
    await v.page.clock.runFor(3000);
    const after = await read();
    expect(after.map((c) => c.text)).not.toEqual(before.map((c) => c.text));
  });

  it('the tool calls of a whole rest are just the log', async () => {
    const { v, card } = await onStep(short(), 0, { clock: true });
    await logBtn(card).click();
    await v.page.clock.runFor(6000);
    expect(calledTools(v).filter((n) => n !== 'get_workout')).toEqual(['log_set']);
  });
});
