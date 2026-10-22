// P6: the done state, automatic moves (PagerIntent), superset hand-off, timed and bodyweight sets
// (Specs: After an exercise is done and automatic moves, Timed and bodyweight sets). The built view runs in a real
// Chromium inside an iframe and the test page plays the MCP Apps host; see tests/support/workoutHost.ts.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
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
  press,
  settled,
  set,
  trackOf,
  type Dom,
  type HostOptions,
  type Opened,
} from './support/workoutHost';
import type { PlannedExercise, WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

// ---------- locators (the interface assumptions are listed in the reply) ----------
const LOCK = 700; // out of the 600 ms lock window
const cardOf = (v: Opened, k: number) => cardsOf(v).nth(k + 1);
const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const logBtn = (card: Locator) => btn(card, 'Log set');
const timerOf = (card: Locator) => card.getByRole('timer');
const inc = (card: Locator, what: 'reps' | 'weight' | 'seconds') => btn(card, new RegExp(`^Increase ${what}`, 'i'));
const stripOf = (v: Opened) => v.frame.locator('[data-strip]');
const straightOn = (card: Locator) => card.getByText(/Straight on · no rest/);
const total = (p: WorkoutPlan) => p.exercises.length + p.cardio.length + 2;
/** Waits until the pager shows position `pos` (0 = Overview). */
const expectAt = async (v: Opened, p: WorkoutPlan, pos: number) => {
  await expect.poll(() => counterText(v), { timeout: 5000 }).toBe(`${pos + 1} of ${total(p)}`);
  await settled(v);
};
/** Opens the view, jumps to step `k` (0-based) and waits for the counter. */
async function onStep(p: WorkoutPlan, k: number, o: HostOptions = {}) {
  const v = await openView(p, o);
  await jumpTo(v, k + 1);
  await expectAt(v, p, k + 1);
  return { v, card: cardOf(v, k) };
}
/** Stops the fake clock from running in real time, so only `runFor` moves it. */
const freeze = async (v: Opened) => {
  for (let margin = 20; ; margin *= 4) {
    const now = await v.page.evaluate(() => Date.now());
    try {
      return await v.page.clock.pauseAt(new Date(now + margin));
    } catch (e) {
      if (margin > 2000 || !/past/.test(String(e))) throw e;
    }
  }
};
/** Goes back to step `k` by hand (the done card of the automatic move is only drawn in full while it is current). */
async function backTo(v: Opened, p: WorkoutPlan, k: number) {
  await jumpTo(v, k + 1);
  await expectAt(v, p, k + 1);
}
/** Reads "Reps: 5. Tap to type a value." style labels. */
const valueOf = async (card: Locator, label: 'Reps' | 'Weight kg' | 'Seconds') => {
  const name = await card.getByRole('button', { name: new RegExp(`^${label}: `) }).first().getAttribute('aria-label');
  return Number.parseFloat((name ?? '').slice(label.length + 2));
};

const squat = (sets = [closed('1', { weightKg: 82.5 }), closed('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })], o: Partial<PlannedExercise> = {}) => ex('Squat', sets, o);
const bench = () => ex('Bench Press', [set('1', { weightKg: 60 }), set('2', { weightKg: 60 })]);
const row = () => ex('Row', [set('1', { weightKg: 50 }), set('2', { weightKg: 50 })]);
const done2 = (name: string) => ex(name, [closed('1'), closed('2')]);
/** Superset partner: short rest so the rest end can be reached with the fake clock. */
const partner = (name: string, sets = [set('1', { weightKg: 20 }), set('2', { weightKg: 20 })], o: Partial<PlannedExercise> = {}) =>
  ex(name, sets, { supersetId: 's1', restSec: 5, ...o });
const plank = () =>
  ex('Plank', [set('1', { weightKg: undefined, targetSec: 30, targetReps: 0 }), set('2', { weightKg: undefined, targetSec: 30, targetReps: 0 })], { bodyweight: true, timed: true, equipment: 'bodyweight' });

// ---------- P6.1 Done state ----------
describe('Specs: After an exercise is done, rule 1 (P6.1; FR11, AC6)', () => {
  it('logging the last set shows "<name> done · k of k sets" and "Go to <next>" on that card, and starts no rest', async () => {
    const p = plan([squat(), bench()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2); // the pager has moved on (rule 2)
    await pwExpect(v.frame.getByText(/^Rest \d+:\d\d · /)).toHaveCount(0);
    await backTo(v, p, 0);
    await pwExpect(card).toContainText('Squat done · 3 of 3 sets');
    await pwExpect(btn(card, 'Go to Bench Press')).toHaveCount(1);
    await pwExpect(timerOf(card)).toHaveCount(0);
    await pwExpect(v.frame.getByText(/^Rest \d+:\d\d · /)).toHaveCount(0);
  });

  it('the last set skipped also ends the exercise with no rest', async () => {
    const p = plan([squat(), bench()]);
    const { v, card } = await onStep(p, 0);
    await btn(card, 'Skip set').click();
    await expectAt(v, p, 2);
    await backTo(v, p, 0);
    await pwExpect(btn(card, 'Go to Bench Press')).toHaveCount(1);
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('"Go to" names the next open step: closed steps in between are not offered', async () => {
    const p = plan([done2('Squat'), done2('Bench Press'), row()]);
    const { card } = await onStep(p, 0);
    await pwExpect(card).toContainText('Squat done · 2 of 2 sets');
    await pwExpect(btn(card, 'Go to Row')).toHaveCount(1);
    await pwExpect(btn(card, 'Go to Bench Press')).toHaveCount(0);
  });

  it('with no later open step the button reads "Go to the end of the workout"', async () => {
    const p = plan([squat()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2); // Finish
    await backTo(v, p, 0);
    await pwExpect(btn(card, 'Go to the end of the workout')).toHaveCount(1);
  });

  it('the Go to button moves the pager to its target', async () => {
    const p = plan([done2('Squat'), done2('Bench Press'), row()]);
    const { v, card } = await onStep(p, 0);
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Go to Row').click();
    await expectAt(v, p, 3);
  });

  it('"Go to the end of the workout" moves to the Finish card', async () => {
    const p = plan([done2('Squat'), done2('Bench Press')]);
    const { v, card } = await onStep(p, 0);
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Go to the end of the workout').click();
    await expectAt(v, p, 3);
  });

  it('the done state replaces the set controls: no Log set, no steppers', async () => {
    const p = plan([done2('Squat'), row()]);
    const { card } = await onStep(p, 0);
    await pwExpect(logBtn(card)).toHaveCount(0);
    await pwExpect(inc(card, 'reps')).toHaveCount(0);
  });
});

// ---------- P6.2 Automatic moves ----------
describe('Specs: After an exercise is done, rules 2 and 4 (P6.2; FR11, AC6)', () => {
  it('rule 2: closing the last set moves the pager to the next open step with no rest in between', async () => {
    const p = plan([squat(), bench()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '3', reps: 5, skip: false, weightKg: 82.5 }]);
  });

  it('rule 2: closed steps are passed over', async () => {
    const p = plan([squat(), done2('Bench Press'), row()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 3);
  });

  it('rule 2: when no step is open the pager moves to Finish, and finishing is not done by itself', async () => {
    const p = plan([done2('Bench Press'), squat()]);
    const { v, card } = await onStep(p, 1);
    await logBtn(card).click();
    await expectAt(v, p, 3);
    await v.page.waitForTimeout(500);
    expect(v.calls.map((c) => c.name)).not.toContain('finish_workout');
    expect(v.messages).toEqual([]);
  });

  it('rule 2: the move is forward only: an open step before this one is not the target', async () => {
    const p = plan([bench(), squat()]);
    const { v, card } = await onStep(p, 1);
    await logBtn(card).click();
    await expectAt(v, p, 3);
  });

  it('rule 2: a set that is not the last one does not move the pager', async () => {
    const p = plan([squat([set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 })]), bench()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await v.page.waitForTimeout(1000);
    expect(await counterText(v)).toBe('2 of 4');
  });

  it('rule 2: a person who has moved on after the automatic move is not pulled back', async () => {
    const p = plan([squat(), bench(), row()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await press(v, 'ArrowRight');
    await expectAt(v, p, 3);
    await v.page.waitForTimeout(1000);
    expect(await counterText(v)).toBe('4 of 5');
  });

  it('rule 4: the move is a scroll of the track (the current card follows the scroll position)', async () => {
    const p = plan([squat(), bench()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await expect.poll(() => trackOf(v).evaluate((el) => Math.round(el.scrollLeft / el.clientWidth)), { timeout: 5000 }).toBe(2);
  });

  it('rule 4: the new card is announced once it settles', async () => {
    const p = plan([squat(), bench()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await pwExpect(v.frame.locator('#status')).toContainText('3 of 4', { timeout: 3000 });
  });

  it('rule 4: with reduced motion the automatic move lands at once', async () => {
    const p = plan([squat(), bench()]);
    const { v, card } = await onStep(p, 0, { reducedMotion: true });
    await logBtn(card).click();
    await v.page.waitForTimeout(150);
    expect(await trackOf(v).evaluate((el) => Math.round(el.scrollLeft / el.clientWidth))).toBe(2);
  });
});

// ---------- P6.3 Superset hand-off ----------
describe('Specs: After an exercise is done, rule 3 (P6.3; FR9, AC5)', () => {
  const round = () => plan([partner('Curl'), partner('Pushdown'), row()]);

  it('after a set of a superset exercise the pager moves at once to the partner with no rest, and "Straight on · no rest" shows there', async () => {
    const p = round();
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await pwExpect(straightOn(cardOf(v, 1))).toBeVisible();
    await pwExpect(timerOf(card)).toHaveCount(0);
    await pwExpect(timerOf(cardOf(v, 1))).toHaveCount(0);
    await pwExpect(v.frame.getByText(/^Rest \d+:\d\d · /)).toHaveCount(0);
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 5, skip: false, weightKg: 20 }]);
  });

  it('"Straight on · no rest" goes away at the first stepper tap on the partner card', async () => {
    const p = round();
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    const partnerCard = cardOf(v, 1);
    await pwExpect(straightOn(partnerCard)).toBeVisible();
    await inc(partnerCard, 'reps').click();
    await pwExpect(straightOn(partnerCard)).toHaveCount(0);
  });

  it('"Straight on · no rest" goes away by itself after 5 s', async () => {
    const p = round();
    const { v, card } = await onStep(p, 0, { clock: true });
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await pwExpect(straightOn(cardOf(v, 1))).toBeVisible();
    await v.page.clock.runFor(2000);
    await pwExpect(straightOn(cardOf(v, 1))).toBeVisible();
    await v.page.clock.runFor(3500);
    await pwExpect(straightOn(cardOf(v, 1))).toHaveCount(0);
  });

  it('a set logged on a warm-up of a superset exercise hands off too', async () => {
    const a = partner('Curl', [set('w1', { warmup: true, weightKg: 10 }), set('1', { weightKg: 20 })]);
    const p = plan([a, partner('Pushdown', [set('1', { weightKg: 20 })])]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('a partner whose only open set is a warm-up still counts as having an open set', async () => {
    const b = partner('Pushdown', [set('w1', { warmup: true, weightKg: 10 }), closed('1', { weightKg: 20 })]);
    const p = plan([partner('Curl'), b]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
  });

  it('a partner without an open set is skipped: the pager goes to the next partner that has one', async () => {
    const p = plan([partner('Curl'), partner('Pushdown', [closed('1'), closed('2')]), partner('Dip')]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 3);
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('with unequal set counts, the exercise with one set left still hands off to the partner with more', async () => {
    const p = plan([partner('Curl', [set('1', { weightKg: 20 })]), partner('Pushdown', [set('1', { weightKg: 20 }), set('2', { weightKg: 20 }), set('3', { weightKg: 20 })])]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await pwExpect(timerOf(card)).toHaveCount(0);
  });

  it('a partner done gives a normal rest on the exercise just logged, and the pager stays', async () => {
    const p = plan([partner('Curl'), partner('Pushdown', [closed('1'), closed('2')])]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await pwExpect(timerOf(card).first()).toBeVisible();
    await v.page.waitForTimeout(800);
    expect(await counterText(v)).toBe('2 of 4');
  });

  it('with no later partner open, the rest runs on the last partner\'s card and the pager stays there', async () => {
    const p = round();
    const { v, card } = await onStep(p, 0, { clock: true });
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await v.page.waitForTimeout(LOCK);
    const second = cardOf(v, 1);
    await logBtn(second).click();
    await pwExpect(timerOf(second).first()).toBeVisible();
    await pwExpect(timerOf(card)).toHaveCount(0);
    await v.page.waitForTimeout(800);
    expect(await counterText(v)).toBe('3 of 5');
  });

  it('when that rest ends the pager returns to the first partner that has an open set', async () => {
    const p = round();
    const { v, card } = await onStep(p, 0, { clock: true });
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await v.page.waitForTimeout(LOCK);
    await logBtn(cardOf(v, 1)).click();
    await pwExpect(timerOf(cardOf(v, 1)).first()).toBeVisible();
    await v.page.clock.runFor(5600);
    await expectAt(v, p, 1);
    await pwExpect(logBtn(card)).toBeVisible();
  });

  it('the return goes to the first partner with an open set, passing over a partner that is done', async () => {
    const p = plan([partner('Curl', [closed('1'), closed('2')]), partner('Pushdown', [set('1', { weightKg: 20 }), set('2', { weightKg: 20 })]), partner('Dip', [set('1', { weightKg: 20 }), set('2', { weightKg: 20 })])]);
    const { v, card } = await onStep(p, 1, { clock: true });
    await logBtn(card).click(); // hands off to Dip
    await expectAt(v, p, 3);
    await v.page.waitForTimeout(LOCK);
    await logBtn(cardOf(v, 2)).click(); // no later partner: rest on Dip
    await pwExpect(timerOf(cardOf(v, 2)).first()).toBeVisible();
    await v.page.clock.runFor(5600);
    await expectAt(v, p, 2); // Pushdown, not the finished Curl
  });

  it.each([
    ['an arrow key', async (v: Opened) => press(v, 'ArrowRight'), 4],
    ['the strip', async (v: Opened) => stripOf(v).click(), 1],
  ] as const)('a manual move (%s) during the rest cancels the return when the rest ends', async (_name, move, expected) => {
    const p = round();
    const { v, card } = await onStep(p, 0, { clock: true });
    await logBtn(card).click();
    await expectAt(v, p, 2);
    await v.page.waitForTimeout(LOCK);
    await logBtn(cardOf(v, 1)).click();
    await pwExpect(timerOf(cardOf(v, 1)).first()).toBeVisible();
    await move(v);
    await expectAt(v, p, expected - 1);
    await v.page.clock.runFor(6000);
    await v.page.waitForTimeout(1000);
    expect(await counterText(v)).toBe(`${expected} of 5`);
  });

  it('a non-superset exercise gets a normal rest and no hand-off', async () => {
    const p = plan([squat([set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 })]), bench()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await pwExpect(timerOf(card).first()).toBeVisible();
    await pwExpect(straightOn(cardOf(v, 1))).toHaveCount(0);
    expect(await counterText(v)).toBe('2 of 4');
  });
});

// ---------- A9 Supersets: one round count, the cue as the zone's first line ----------
describe('Specs: Supersets, one round count and the cue in the zone (A9; FR9)', () => {
  const label = (card: Locator) => card.getByText(/^Superset with /);

  it('both partners read the same round, which advances only when every partner has done its set', async () => {
    const p = plan([partner('Curl'), partner('Pushdown'), row()]);
    const { v, card } = await onStep(p, 0);
    await pwExpect(label(card)).toHaveText('Superset with Pushdown · round 1 of 2');
    await pwExpect(label(cardOf(v, 1))).toHaveText('Superset with Curl · round 1 of 2');
    await logBtn(card).click(); // Curl set 1: Pushdown is next, no rest
    await expectAt(v, p, 2);
    await pwExpect(label(cardOf(v, 0))).toHaveText('Superset with Pushdown · round 1 of 2'); // Curl is at its set 2, the group is still in round 1
    await pwExpect(label(cardOf(v, 1))).toHaveText('Superset with Curl · round 1 of 2');
    await v.page.waitForTimeout(LOCK);
    await logBtn(cardOf(v, 1)).click(); // Pushdown set 1: the round is over
    await expect.poll(() => logCalls(v).length).toBe(2);
    await pwExpect(label(cardOf(v, 0))).toHaveText('Superset with Pushdown · round 2 of 2');
    await pwExpect(label(cardOf(v, 1))).toHaveText('Superset with Curl · round 2 of 2');
  });

  it('the total is the largest number of working sets among the partners', async () => {
    const three = [set('1', { weightKg: 20 }), set('2', { weightKg: 20 }), set('3', { weightKg: 20 })];
    const { v, card } = await onStep(plan([partner('Curl', three), partner('Pushdown'), row()]), 0);
    await pwExpect(label(card)).toHaveText('Superset with Pushdown · round 1 of 3');
    await pwExpect(label(cardOf(v, 1))).toHaveText('Superset with Curl · round 1 of 3');
  });

  it('while an exercise is in its warm-ups it reads "Warm-up 1 of 2", not a round', async () => {
    const warm = [set('w1', { warmup: true, weightKg: 10 }), set('w2', { warmup: true, weightKg: 15 }), set('1', { weightKg: 20 }), set('2', { weightKg: 20 })];
    const { v, card } = await onStep(plan([partner('Curl', warm), partner('Pushdown'), row()]), 0);
    await pwExpect(label(card)).toHaveText('Superset with Pushdown · Warm-up 1 of 2');
    await pwExpect(label(cardOf(v, 1))).toHaveText('Superset with Curl · round 1 of 2');
  });

  it('"Straight on · no rest" is the first line of the zone, in normal weight, and its going away moves nothing', async () => {
    const p = plan([partner('Curl'), partner('Pushdown'), row()]);
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expectAt(v, p, 2);
    const partnerCard = cardOf(v, 1);
    await settled(v); // the card is still arriving (it tilts and shrinks while it scrolls in)
    const zone = partnerCard.locator('[data-zone]');
    const cue = zone.getByText('Straight on · no rest');
    await pwExpect(cue).toBeVisible();
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    expect(await y(cue)).toBeLessThan(await y(zone.getByText(/^Set 1 of 2/)));
    expect(await cue.evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).fontWeight)).toBe('400');
    const before = { zone: (await zone.boundingBox())!.height, set: await y(zone.getByText(/^Set 1 of 2/)) };
    await inc(partnerCard, 'reps').click();
    await pwExpect(cue).toHaveCount(0);
    expect(Math.abs((await zone.boundingBox())!.height - before.zone)).toBeLessThanOrEqual(1);
    expect(Math.abs((await y(zone.getByText(/^Set 1 of 2/))) - before.set)).toBeLessThanOrEqual(1);
  });
});

// ---------- P6.4 Timed set zone ----------
describe('Specs: Timed and bodyweight sets, timed (P6.4; FR10, AC13)', () => {
  const START = (s: number) => `Start a ${s} s timer (5 s to get ready)`;
  const getReady = (card: Locator) => card.getByText(/Get ready \d+/);
  const STOP = /^Stop · log \d+:\d\d$/;
  const timedStep = (o: HostOptions = { clock: true }) => onStep(plan([plank(), bench()]), 0, o);

  it('the zone shows the seconds stepper and "Start a <s> s timer (5 s to get ready)", which follows the stepper', async () => {
    const { card } = await timedStep();
    expect(await valueOf(card, 'Seconds')).toBe(30);
    await pwExpect(btn(card, START(30))).toBeVisible();
    await inc(card, 'seconds').click();
    await pwExpect(btn(card, START(35))).toBeVisible();
  });

  it('starting shows "Get ready <n>" counting down, with Start now and Cancel', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await pwExpect(getReady(card)).toBeVisible();
    await pwExpect(btn(card, 'Start now')).toBeVisible();
    await pwExpect(btn(card, 'Cancel')).toBeVisible();
    await pwExpect(btn(card, START(30))).toHaveCount(0);
    await v.page.clock.runFor(2000);
    await expect.poll(async () => Number(/Get ready (\d+)/.exec((await getReady(card).first().textContent()) ?? '')?.[1]), { timeout: 5000 }).toBeLessThanOrEqual(3);
  });

  it('after the 5 s get-ready the hold countdown starts with "Stop the timer"', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await pwExpect(getReady(card)).toBeVisible();
    await v.page.clock.runFor(5600);
    await pwExpect(btn(card, STOP)).toBeVisible();
    await pwExpect(getReady(card)).toHaveCount(0);
  });

  it('Start now skips the get-ready and starts the hold', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Start now').click();
    await pwExpect(btn(card, STOP)).toBeVisible();
    await pwExpect(getReady(card)).toHaveCount(0);
  });

  it('Cancel during the get-ready returns to the Start button and logs nothing', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Cancel').click();
    await pwExpect(btn(card, START(30))).toBeVisible();
    await pwExpect(getReady(card)).toHaveCount(0);
    await v.page.clock.runFor(8000);
    await pwExpect(btn(card, STOP)).toHaveCount(0);
    expect(logCalls(v)).toEqual([]);
  });

  it('Stop · log shows the seconds held so far, live, and logs them when tapped (4 s of a 10 s hold logs 4)', async () => {
    const p = plan([ex('Plank', [set('1', { weightKg: undefined, targetReps: 0, targetSec: 10 })], { timed: true, bodyweight: true, equipment: 'body only' }), bench()]);
    const { v, card } = await onStep(p, 0, { clock: true });
    await freeze(v); // only runFor moves the page's time now, so the seconds held are exact
    await btn(card, 'Start a 10 s timer (5 s to get ready)').click();
    await v.page.clock.runFor(LOCK);
    await btn(card, 'Start now').click();
    await expect.poll(async () => (await btn(card, STOP).textContent())?.trim()).toBe('Stop · log 0:00');
    await v.page.clock.runFor(2000); // 2 s held; the 600 ms lock is over
    await expect.poll(async () => (await btn(card, STOP).textContent())?.trim()).toMatch(/^Stop · log 0:0[12]$/); // the label moves once a second
    await v.page.clock.runFor(2000);
    await btn(card, STOP).click();
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 0, skip: false, seconds: 4 }]);
    await pwExpect(card.locator('[data-set-id="1"]')).toContainText('4 s');
  });

  it('Cancel during the hold stops the timer and logs nothing; the Start button is back', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Start now').click();
    await v.page.clock.runFor(5000);
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Cancel').click();
    await pwExpect(btn(card, STOP)).toHaveCount(0);
    await pwExpect(btn(card, START(30))).toBeVisible();
    await pwExpect(logBtn(card)).toHaveText('Log set · 30 s');
    expect(logCalls(v)).toEqual([]);
  });

  it('while a timer runs the dock holds Cancel and the primary; the zone holds no button of the timer', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await pwExpect(getReady(card)).toBeVisible();
    await pwExpect(card.locator('.dock').getByRole('button', { name: 'Cancel' })).toBeVisible();
    await pwExpect(card.locator('.dock').getByRole('button', { name: 'Start now' })).toBeVisible();
    await pwExpect(card.locator('.dock').getByRole('button', { name: 'Log set' })).toHaveCount(0);
    await pwExpect(card.locator('[data-zone]').getByRole('button', { name: /Cancel|Start now|Stop/ })).toHaveCount(0);
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Start now').click();
    await pwExpect(card.locator('.dock').getByRole('button', { name: STOP })).toBeVisible();
    expect(await btn(card, STOP).evaluate((el) => (el as unknown as { getBoundingClientRect(): { height: number } }).getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  });

  it('when the hold completes the zone reads "Time" and the dock is back to Log set with the full time', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Start now').click();
    await v.page.clock.runFor(31_000);
    await pwExpect(card.locator('[data-zone]').getByText('Time', { exact: true })).toBeVisible();
    await pwExpect(btn(card, STOP)).toHaveCount(0);
    await pwExpect(logBtn(card)).toHaveText('Log set · 30 s');
  });

  it('the zone is the same height in every phase: before the start, Get ready, the hold and Time', async () => {
    const { v, card } = await timedStep();
    const zoneHeight = async () => (await card.locator('[data-zone]').boundingBox())!.height;
    const idle = await zoneHeight();
    await btn(card, START(30)).click();
    await pwExpect(getReady(card)).toBeVisible();
    expect(Math.abs((await zoneHeight()) - idle)).toBeLessThanOrEqual(1);
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Start now').click();
    await pwExpect(card.locator('[data-zone] [role="timer"]')).toBeVisible();
    expect(Math.abs((await zoneHeight()) - idle)).toBeLessThanOrEqual(1);
    await v.page.clock.runFor(31_000);
    await pwExpect(card.locator('[data-zone]').getByText('Time', { exact: true })).toBeVisible();
    expect(Math.abs((await zoneHeight()) - idle)).toBeLessThanOrEqual(1);
  });

  it('at zero the view beeps three times and vibrates [200, 100, 200]', async () => {
    const { v, card } = await timedStep();
    await btn(card, START(30)).click();
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Start now').click();
    await v.page.clock.runFor(30_600);
    await v.page.clock.runFor(1000);
    await expect.poll(async () => (await effects(v)).oscillators, { timeout: 5000 }).toBe(3);
    expect((await effects(v)).vibrations).toContainEqual([200, 100, 200]);
    await pwExpect(btn(card, STOP)).toHaveCount(0);
  });

  it('a hold keeps running when another card is logged: it still beeps at zero', async () => {
    const p = plan([plank(), bench()]);
    const { v, card } = await onStep(p, 0, { clock: true });
    await btn(card, START(30)).click();
    await v.page.waitForTimeout(LOCK);
    await btn(card, 'Start now').click();
    await v.page.waitForTimeout(LOCK);
    await jumpTo(v, 2);
    await expectAt(v, p, 2);
    await v.page.waitForTimeout(LOCK);
    await logBtn(cardOf(v, 1)).click();
    await expect.poll(() => logCalls(v).map((a) => a.setId)).toEqual(['1']);
    await v.page.clock.runFor(30_600);
    await v.page.clock.runFor(1000);
    await expect.poll(async () => (await effects(v)).oscillators, { timeout: 5000 }).toBe(3);
  });

  it('a get-ready keeps running when another card is logged: the hold is on when the person comes back', async () => {
    const p = plan([plank(), bench()]);
    const { v, card } = await onStep(p, 0, { clock: true });
    await btn(card, START(30)).click();
    await pwExpect(getReady(card)).toBeVisible();
    await v.page.waitForTimeout(LOCK);
    await jumpTo(v, 2);
    await expectAt(v, p, 2);
    await v.page.waitForTimeout(LOCK);
    await logBtn(cardOf(v, 1)).click();
    await expect.poll(() => logCalls(v).map((a) => a.setId)).toEqual(['1']);
    await v.page.clock.runFor(5600);
    await jumpTo(v, 1);
    await expectAt(v, p, 1);
    await pwExpect(btn(card, STOP)).toBeVisible();
  });
});

// ---------- P6.5 Bodyweight zone ----------
describe('Specs: Timed and bodyweight sets, bodyweight (P6.5; FR10, AC13)', () => {
  const pushUps = () =>
    ex('Push-up', [set('1', { weightKg: undefined, targetReps: 12 }), set('2', { weightKg: undefined, targetReps: 12 })], { bodyweight: true, equipment: 'bodyweight' });

  it('the zone shows the reps stepper and the text "Bodyweight", and nothing else to set', async () => {
    const { card } = await onStep(plan([pushUps(), bench()]), 0);
    await pwExpect(card).toContainText('Bodyweight');
    await pwExpect(inc(card, 'reps')).toBeVisible();
    expect(await valueOf(card, 'Reps')).toBe(12);
    await pwExpect(inc(card, 'weight')).toHaveCount(0);
    await pwExpect(card.getByRole('button', { name: /^Weight kg/ })).toHaveCount(0);
    await pwExpect(inc(card, 'seconds')).toHaveCount(0);
    await pwExpect(card.getByRole('button', { name: /timer \(5 s to get ready\)/ })).toHaveCount(0);
  });

  it('the log_set call carries reps and no weightKg', async () => {
    const { v, card } = await onStep(plan([pushUps(), bench()]), 0);
    await inc(card, 'reps').click();
    await logBtn(card).click();
    await expect.poll(() => logCalls(v)).toEqual([{ workoutId: 'w1', setId: '1', reps: 13, skip: false, restSec: 90 }]);
  });
});
