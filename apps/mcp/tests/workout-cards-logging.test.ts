// P5: the exercise card (rows, current-set zone), logging, the 600 ms lock, the stepper, edit and re-open, and rest
// (Specs: Exercise card layout, Logging, skipping, stepper, Edit and re-open, Rest). The built view runs in a real Chromium
// inside an iframe and the test page plays the MCP Apps host; see tests/support/workoutHost.ts.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  calledTools,
  cardsOf,
  trackOf,
  settled,
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
/** Stops the fake clock from running in real time, so only `runFor` moves it (a slow machine must not change what a test sees). */
const freeze = async (v: Opened) => {
  // Aim just past the page's own time (not the runner's), widening the margin when a slow machine already overshot it.
  for (let margin = 20; ; margin *= 4) {
    const now = await v.page.evaluate(() => Date.now());
    try {
      return await v.page.clock.pauseAt(new Date(now + margin));
    } catch (e) {
      if (margin > 2000 || !/past/.test(String(e))) throw e;
    }
  }
};

async function onStep(p: WorkoutPlan, k: number, o: HostOptions = {}) {
  const v = await openView(p, o);
  await jumpTo(v, k + 1);
  await expect.poll(() => counterText(v)).toBe(`${k + 2} of ${p.exercises.length + p.cardio.length + 2}`);
  await settled(v);
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

  it('the zone is as tall as about two fifths of the track and stays so from set to set, and Log set (in the dock) stays where it was', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    const track = (await v.frame.locator('[aria-roledescription="carousel"]').boundingBox())!.height;
    const zone = (await zoneOf(card).boundingBox())!;
    expect(zone.height).toBeGreaterThanOrEqual(track * 0.35);
    expect(zone.height).toBeLessThanOrEqual(track * 0.5);
    // Log set is in the dock, at a fixed distance from the bottom of the card; it does not move with the rows.
    const fromBottom = async () => (await card.boundingBox())!.y + (await card.boundingBox())!.height - ((await logBtn(card).boundingBox())!.y + (await logBtn(card).boundingBox())!.height);
    const before = await fromBottom();
    await logBtn(card).click();
    await v.page.waitForTimeout(700); // out of the 600 ms lock
    await btn(card, 'Skip rest').click();
    await pwExpect(rowOf(card, '1')).toContainText('✓');
    expect(Math.abs((await fromBottom()) - before)).toBeLessThanOrEqual(1);
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
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 5, skip: false, weightKg: 82.5, restSec: 90 }]);
  });

  it('rule 1: a changed value goes into the call (reps +1, weight +2.5 kg)', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0);
    await inc(card, 'reps').click();
    await inc(card, 'weight').click();
    await logBtn(card).click();
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 6, skip: false, weightKg: 85, restSec: 90 }]);
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
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 12, skip: false, restSec: 90 }]);
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
    await freeze(o.v);
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
    await freeze(v);
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
    await expect.poll(() => counterText(v)).toBe('2 of 3');
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
    await expect.poll(() => counterText(v)).toBe('3 of 4');
    const chip = v.frame.getByText(/^Rest \d+:\d\d · Squat/);
    await pwExpect(chip).toBeVisible();
    await v.frame.getByRole('button', { name: 'Go', exact: true }).click();
    await expect.poll(() => counterText(v)).toBe('2 of 4');
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

  it('the pinned bar has the time, -15 s, +15 s and Skip rest, each 40 px high or more', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    for (const name of [MINUS_15, '+15 s', 'Skip rest']) {
      const b = btn(card, name);
      await pwExpect(b).toBeVisible();
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    }
  });

  it('-15 s and +15 s change the remaining time by 15 s', async () => {
    const { v, card } = await onStep(plan([squat3(), bench()]), 0, { clock: true });
    await logBtn(card).click();
    await freeze(v);
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
    await freeze(v);
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
    await v.page.clock.runFor(6200);
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
    await expect.poll(() => counterText(v)).toBe('3 of 4');
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

describe('Specs: Pager and header, exercise card layout (P9; FR1, FR5)', () => {
  it('every card is drawn in full, so the card next to the current one is not empty while it swipes in', async () => {
    const { v } = await onStep(plan([ex('Squat', [closed('1'), set('2')]), ex('Bench Press', [set('1'), set('2')])]), 0);
    const next = cardOf(v, 1);
    await pwExpect(next.getByRole('heading', { name: 'Bench Press', includeHidden: true })).toHaveCount(1);
    await pwExpect(next.locator('[data-zone]')).toHaveCount(1);
    await pwExpect(next.locator('[data-set-id]')).toHaveCount(1); // set 2 is a row, set 1 is the zone
    await pwExpect(next.locator('textarea, .guide, .swapbox')).toHaveCount(0); // the panels belong to the card in view
  });
});

describe('Swipe effect while the track is dragged', () => {
  const tilt = (v: Opened, k: number) =>
    cardsOf(v)
      .nth(k)
      .evaluate((el) => ({ transform: (el as unknown as { style: { transform: string } }).style.transform, opacity: (el as unknown as { style: { opacity: string } }).style.opacity }));
  const dragTo = (v: Opened, frac: number) =>
    trackOf(v).evaluate((el, f) => {
      const t = el as unknown as { scrollLeft: number; clientWidth: number; style: { scrollSnapType: string } };
      t.style.scrollSnapType = 'none';
      t.scrollLeft = t.clientWidth * f;
    }, frac);

  it('the card leaving tilts, shrinks and fades, the card coming in straightens up, and a card at rest has no transform', async () => {
    const { v } = await onStep(plan([ex('Squat', [set('1')]), ex('Bench Press', [set('1')])]), 0);
    await expect.poll(async () => (await tilt(v, 1)).transform).toBe('');
    // Read the cards in the same page turn as the drag: the tilt is cleared a moment after the scrolling stops, and a slow runner can pass that moment between two round trips.
    const dragged = await trackOf(v).evaluate(async (el) => {
      const dom = globalThis as unknown as { requestAnimationFrame: (cb: () => void) => void; document: { querySelectorAll: (s: string) => ArrayLike<{ style: { transform: string; opacity: string } }> } };
      const t = el as unknown as { scrollLeft: number; clientWidth: number; style: { scrollSnapType: string } };
      t.style.scrollSnapType = 'none';
      t.scrollLeft = t.clientWidth * 1.4;
      await new Promise<void>((done) => dom.requestAnimationFrame(() => dom.requestAnimationFrame(() => done())));
      const cards = dom.document.querySelectorAll('[aria-roledescription="card"]');
      return [1, 2].map((k) => ({ transform: cards[k]!.style.transform, opacity: cards[k]!.style.opacity }));
    });
    expect(dragged[0]!.transform).toMatch(/rotate\(-?[\d.]+deg\) scale\(/);
    expect(Number(dragged[0]!.opacity)).toBeLessThan(1);
    expect(Number(dragged[1]!.opacity)).toBeLessThan(1);
    await dragTo(v, 2);
    await expect.poll(async () => (await tilt(v, 2)).transform, { timeout: 5000 }).toBe('');
    await expect.poll(async () => (await tilt(v, 2)).opacity, { timeout: 5000 }).toBe('');
  });

  it('a track left between two cards comes back to the middle of the nearest one, and the tilt never moves the snapping box', async () => {
    const { v } = await onStep(plan([ex('Squat', [set('1')]), ex('Bench Press', [set('1')])]), 0);
    await dragTo(v, 1.3);
    const slideIsPlain = await cardsOf(v).nth(1).evaluate((el) => {
      const slide = (el as unknown as { parentElement: { style: { transform: string }; className: string } }).parentElement;
      return slide.className === 'slide' && slide.style.transform === '';
    });
    expect(slideIsPlain).toBe(true);
    await expect
      .poll(() => trackOf(v).evaluate((el) => { const t = el as unknown as { scrollLeft: number; clientWidth: number }; return Math.round(Math.abs(t.scrollLeft - t.clientWidth)); }), { timeout: 5000 })
      .toBeLessThanOrEqual(2);
    expect(await counterText(v)).toBe('2 of 4');
  });

  it('the strip and the counter move as soon as a jump starts, not when the scroll has finished', async () => {
    const v = await openView(plan([ex('Squat', [set('1')]), ex('Bench Press', [set('1')]), ex('Pullups', [set('1')])]));
    await expect.poll(() => counterText(v)).toBe('1 of 5');
    await v.frame.getByRole('button', { name: /^Pullups,/ }).click();
    const seen = await trackOf(v).evaluate((el) => {
      const t = el as unknown as { scrollLeft: number; clientWidth: number; ownerDocument: { querySelectorAll(s: string): Iterable<{ className: string }> } };
      const segs = Array.from(t.ownerDocument.querySelectorAll('.seg'));
      return { left: t.scrollLeft / t.clientWidth, current: segs.findIndex((x) => x.className.includes('current')) };
    });
    expect(seen.current).toBe(3);
    expect(seen.left).toBeLessThan(3);
    await expect.poll(() => counterText(v)).toBe('4 of 5');
  });

  it('with reduced motion the cards are not transformed while dragging', async () => {
    const { v } = await onStep(plan([ex('Squat', [set('1')]), ex('Bench Press', [set('1')])]), 0, { reducedMotion: true });
    await dragTo(v, 1.4);
    await v.page.waitForTimeout(200);
    expect((await tilt(v, 1)).transform).toBe('');
  });
});

// ---------- A1 Warm-up prefill ----------
describe('Specs: a warm-up starts from its own planned values (A1)', () => {
  const ramp = () =>
    ex('Squat', [set('w1', { warmup: true, targetReps: 8, weightKg: 20 }), set('w2', { warmup: true, targetReps: 5, weightKg: 55 }), set('1', { targetReps: 5, weightKg: 100 }), set('2', { targetReps: 5, weightKg: 100 })], { restSec: 0 });

  it('after warm-up 1 the steppers and the plates show warm-up 2, even when warm-up 1 was changed before logging', async () => {
    const { card } = await onStep(plan([ramp(), bench()]), 0);
    await inc(card, 'reps').click(); // 8 -> 9 for warm-up 1
    await inc(card, 'weight').click(); // 20 -> 22.5 for warm-up 1
    await logBtn(card).click();
    await pwExpect(rowOf(card, 'w1')).toContainText('9 × 22.5 kg');
    expect(await valueOf(card, 'Reps')).toBe(5);
    expect(await valueOf(card, 'Weight kg')).toBe(55);
    await pwExpect(zoneOf(card)).toContainText('Each side: 15 + 2.5 · bar 20 kg'); // the plates are those of 55 kg
    await pwExpect(logBtn(card)).toHaveText('Log set · 5 × 55 kg');
  });

  it('the first working set after the warm-ups starts from its own plan, and the next one carries the logged working set', async () => {
    const { v, card } = await onStep(plan([ramp(), bench()]), 0);
    await logBtn(card).click();
    await v.page.waitForTimeout(700); // out of the 600 ms lock
    await logBtn(card).click();
    await v.page.waitForTimeout(700); // out of the 600 ms lock
    expect(await valueOf(card, 'Reps')).toBe(5);
    expect(await valueOf(card, 'Weight kg')).toBe(100);
    await inc(card, 'weight').click(); // 102.5 for set 1
    await logBtn(card).click();
    await pwExpect(rowOf(card, '1')).toContainText('5 × 102.5 kg');
    await v.page.waitForTimeout(700); // out of the 600 ms lock
    expect(await valueOf(card, 'Weight kg')).toBe(102.5); // set 2: working sets still carry over
  });
});

// ---------- A6 Set zone context ----------
describe('Specs: Set zone context, last time for this set and the progression reason (A6)', () => {
  const reason = 'All sets reached 5 reps at 80 kg; add 2.5 kg.';
  const lifted = (o: Partial<PlannedExercise> = {}) =>
    ex('Squat', [set('w1', { warmup: true, targetReps: 5, weightKg: 40 }), set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })], { lastTime: '5 @ 80, 4 @ 80 (2026-10-09)', note: reason, ...o });

  it('a working set shows "Last time: 4 × 80 kg" for its own place, under the plates, then the reason', async () => {
    const e = lifted();
    e.sets[0]!.done = true;
    e.sets[0]!.reps = 5;
    const { card } = await onStep(plan([e, bench()]), 0);
    const zone = zoneOf(card);
    await pwExpect(zone).toContainText('Last time: 5 × 80 kg');
    await pwExpect(zone).toContainText(reason);
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    expect(await y(zone.getByText(/^Each side/))).toBeLessThan(await y(zone.getByText('Last time: 5 × 80 kg')));
    expect(await y(zone.getByText('Last time: 5 × 80 kg'))).toBeLessThan(await y(zone.getByText(reason)));
  });

  it('the set after the last one of last time shows no "Last time" line, and neither does a lastTime that cannot be read', async () => {
    const e = lifted();
    for (const id of ['w1', '1', '2']) Object.assign(e.sets.find((x) => x.id === id)!, { done: true, reps: 5 });
    const { card } = await onStep(plan([e, bench()]), 0);
    await pwExpect(zoneOf(card)).toContainText('Set 3 of 3');
    await pwExpect(zoneOf(card)).not.toContainText('Last time');
    await pwExpect(zoneOf(card)).toContainText(reason);
    const odd = await onStep(plan([lifted({ lastTime: 'held a while' }), bench()]), 0);
    await pwExpect(zoneOf(odd.card)).not.toContainText('Last time');
  });

  it('a warm-up shows neither the last-time line nor the reason, and the reason is no longer under the set list', async () => {
    const { card } = await onStep(plan([lifted(), bench()]), 0);
    await pwExpect(zoneOf(card)).toContainText('Warm-up 1 of 1');
    await pwExpect(zoneOf(card)).not.toContainText('Last time');
    await pwExpect(zoneOf(card)).not.toContainText(reason);
    await pwExpect(card.getByText(reason)).toHaveCount(0);
  });

  it('the zone is as tall for a warm-up, a working set with context and the rest, at 375 and at 398 px', async () => {
    for (const width of [375, 398]) {
      const e = lifted();
      const { v, card } = await onStep(plan([e, bench()]), 0, { width });
      const warm = (await zoneOf(card).boundingBox())!.height;
      await logBtn(card).click();
      await v.page.waitForTimeout(700);
      await pwExpect(zoneOf(card)).toContainText('Rest');
      expect(Math.abs((await zoneOf(card).boundingBox())!.height - warm)).toBeLessThanOrEqual(1);
      await btn(card, 'Skip rest').click();
      await pwExpect(zoneOf(card)).toContainText('Last time: 5 × 80 kg');
      expect(Math.abs((await zoneOf(card).boundingBox())!.height - warm)).toBeLessThanOrEqual(1);
      await v.page.close();
    }
  });
});

describe('Specs: the weight-steps hint shows once per session (A6)', () => {
  const HINT = /Weight moves in 2\.5 kg steps/;
  const two = () => plan([ex('Squat', [set('1'), set('2')]), ex('Deadlift', [set('1'), set('2')])]);

  it('the first card the person opens shows the hint; the next card carries it as a description of the weight value', async () => {
    const { v, card } = await onStep(two(), 0);
    await pwExpect(card.getByText(HINT)).toBeVisible();
    await jumpTo(v, 2);
    await settled(v);
    const second = cardOf(v, 1);
    await pwExpect(second.getByText(HINT)).toHaveCount(0);
    const weight = second.getByRole('button', { name: /^Weight kg: / });
    expect(await weight.getAttribute('aria-description')).toMatch(HINT);
    await jumpTo(v, 1);
    await settled(v);
    await pwExpect(card.getByText(HINT)).toBeVisible();
    expect(await card.getByRole('button', { name: /^Weight kg: / }).getAttribute('aria-description')).toBeNull();
  });
});

// ---------- A7 Rest ----------
describe('Specs: Rest, one clock, the next plates and the "Rest over" state (A7)', () => {
  const short = () => plan([ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 85 }), set('3', { weightKg: 85 })], { restSec: 5 }), bench()]);

  it('the zone holds the only clock of the rest (64 px); the dock keeps the progress line and the three buttons but no time', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await pwExpect(timerOf(card)).toHaveCount(1);
    await pwExpect(zoneOf(card).getByRole('timer')).toBeVisible();
    expect(await timerOf(card).evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).fontSize)).toBe('64px');
    await pwExpect(card.locator('.dock [data-clock]')).toHaveCount(0);
    await pwExpect(card.locator('.dock [data-restbar]')).toHaveCount(1);
    for (const name of [MINUS_15, '+15 s', 'Skip rest']) await pwExpect(card.locator('.dock').getByRole('button', { name, exact: true })).toBeVisible();
  });

  it('"Next:" gets the plates for the next set: "no change" when the weight is the same, and what to add or take off a side when it differs', async () => {
    const { card } = await onStep(plan([squat3(), bench()]), 0);
    await logBtn(card).click();
    await pwExpect(zoneOf(card)).toContainText('Each side: 25 + 5 + 1.25 · no change');
    await btn(card, 'Change').click();
    await inc(card, 'weight').click(); // 82.5 -> 85: 1.25 more a side
    await pwExpect(zoneOf(card)).toContainText('Each side: 25 + 5 + 2.5 · add 1.25 a side');
    await btn(card, /^Decrease weight/).click();
    await btn(card, /^Decrease weight/).click();
    await pwExpect(zoneOf(card)).toContainText(/Each side: .* · take off 1\.25 a side/);
  });

  it('a dumbbell exercise has no plates line while resting', async () => {
    const { card } = await onStep(plan([ex('Curl', [set('1'), set('2')], { equipment: 'dumbbell' }), bench()]), 0);
    await logBtn(card).click();
    await pwExpect(zoneOf(card)).not.toContainText('Each side');
  });

  it('at 0:00 the zone reads "Rest over" and the dock offers "Start set 2"; the zone height does not change; one announcement', async () => {
    const { v, card } = await onStep(short(), 0, { clock: true });
    await freeze(v);
    await logBtn(card).click();
    await pwExpect(zoneOf(card).getByText('Rest', { exact: true })).toHaveCount(1); // the label stays above the clock while counting down
    const rest = (await zoneOf(card).boundingBox())!.height;
    await v.page.clock.runFor(6200);
    await pwExpect(zoneOf(card)).toContainText('Rest over');
    await pwExpect(zoneOf(card).getByText('Rest', { exact: true })).toHaveCount(0); // no small label above the big words
    await pwExpect(timerOf(card)).toHaveCount(0);
    await pwExpect(card.locator('.dock').getByRole('button', { name: 'Start set 2', exact: true })).toBeVisible();
    await pwExpect(logBtn(card)).toHaveCount(0);
    expect(Math.abs((await zoneOf(card).boundingBox())!.height - rest)).toBeLessThanOrEqual(1);
    await pwExpect(v.frame.locator('#status')).toHaveText('Rest over.');
    expect((await effects(v)).oscillators).toBe(2);
  });

  it('after 3 s the zone shows the set by itself, with Skip set and Log set in the dock', async () => {
    const { v, card } = await onStep(short(), 0, { clock: true });
    await freeze(v);
    await logBtn(card).click();
    await v.page.clock.runFor(6200);
    await pwExpect(zoneOf(card)).toContainText('Rest over');
    await v.page.clock.runFor(3500);
    await pwExpect(zoneOf(card)).toContainText('Set 2 of 3');
    await pwExpect(logBtn(card)).toBeVisible();
    await pwExpect(btn(card, 'Skip set')).toBeVisible();
    await pwExpect(btn(card, 'Start set 2')).toHaveCount(0);
  });

  it('tapping "Start set 2" goes to the set zone at once (the tap lock applies), with the focus on Log set', async () => {
    const { v, card } = await onStep(short(), 0, { clock: true });
    await freeze(v); // only runFor moves the page's time, so the rest and its 3 s of "Rest over" cannot run out while the test (or a slow CI machine) is busy
    await logBtn(card).click();
    await v.page.clock.runFor(5000);
    // The page checks the rest once a second: step until it has ended, so the 600 ms tap lock is still running below.
    for (let i = 0; i < 12 && (await btn(card, 'Start set 2').count()) === 0; i++) await v.page.clock.runFor(100);
    await pwExpect(btn(card, 'Start set 2')).toBeVisible();
    await btn(card, 'Start set 2').evaluate((el) => (el as unknown as DomNode).click()); // inside the 600 ms lock after the rest ended: ignored
    await pwExpect(btn(card, 'Start set 2')).toBeVisible();
    await v.page.clock.runFor(700);
    await btn(card, 'Start set 2').click();
    await pwExpect(zoneOf(card)).toContainText('Set 2 of 3');
    await pwExpect(logBtn(card)).toBeVisible();
    expect(await v.inView(() => (globalThis as unknown as Dom).document.activeElement?.getAttribute('data-key'))).toBe('log');
    expect(logCalls(v)).toHaveLength(1); // starting a set logs nothing
  });

  it('a warm-up rest that ends offers "Start warm-up 2"', async () => {
    const e = ex('Squat', [set('w1', { warmup: true, weightKg: 40 }), set('w2', { warmup: true, weightKg: 60 }), set('1')], { restSec: 5 });
    const { v, card } = await onStep(plan([e, bench()]), 0, { clock: true });
    await freeze(v);
    await logBtn(card).click();
    await v.page.clock.runFor(6200);
    await pwExpect(btn(card, 'Start warm-up 2')).toBeVisible();
  });

  it('a rest that ended while the page was hidden shows the set at once, not another 3 s of "Rest over"', async () => {
    const { v, card } = await onStep(short(), 0, { clock: true });
    await logBtn(card).click();
    await v.page.clock.fastForward(20_000);
    await pwExpect(logBtn(card)).toBeVisible();
    await pwExpect(zoneOf(card)).not.toContainText('Rest over');
  });
});
