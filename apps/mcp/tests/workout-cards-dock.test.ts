// A3: the action dock (Specs: Overview, Exercise card, Rest, Cardio card, Finish card). Every card has one dock pinned to its
// bottom: Start on the Overview, Skip set + Log set on an exercise card, the rest controls while resting, "Go to ..." when an
// exercise is done, Skip + Log cardio on a cardio card, Finish on the Finish card. The built view runs in a real Chromium inside
// an iframe and the test page plays the MCP Apps host (tests/support/workoutHost.ts).
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cardio, cardsOf, closed, trackOf, closeBrowser, closeOpened, counterText, ex, jumpTo, launchBrowser, openView, plan, set, settled, skipped, type Dom, type DomNode, type HostOptions } from './support/workoutHost';
import type { PlannedExercise, WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const LOCK = 700; // out of the 600 ms lock window
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const dockOf = (card: Locator) => card.locator('.dock');
const zoneOf = (card: Locator) => card.locator('[data-zone]');
const box = async (l: Locator) => (await l.boundingBox())!;
const bottomOf = async (l: Locator) => {
  const b = await box(l);
  return b.y + b.height;
};
const total = (p: WorkoutPlan) => p.exercises.length + p.cardio.length + 2;
interface Scroller {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  querySelectorAll(selector: string): ArrayLike<DomNode>;
}

/** Opens the view and goes to card `pos` (0 is the Overview); resolves when that card is the current one and the tap lock is over. */
async function onCard(p: WorkoutPlan, pos: number, o: HostOptions = {}) {
  const v = await openView(p, o);
  await jumpTo(v, pos);
  await expect.poll(() => counterText(v)).toBe(`${pos + 1} of ${total(p)}`);
  await settled(v);
  await wait(LOCK);
  return { v, card: cardsOf(v).nth(pos) };
}

/** The dock's bottom edge is the card's bottom edge (to the pixel), and there is one dock. */
async function expectDockAtBottom(card: Locator) {
  await pwExpect(dockOf(card)).toHaveCount(1);
  expect(Math.abs((await bottomOf(dockOf(card))) - (await bottomOf(card)))).toBeLessThanOrEqual(1);
}

const squat = (o: Partial<PlannedExercise> = {}) => ex('Squat', [set('1', { weightKg: 82.5 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })], o);
const bench = () => ex('Bench Press', [set('1', { weightKg: 60 }), set('2', { weightKg: 60 })]);
const fresh = () => plan([squat(), bench()]);

describe('Specs: Overview, the Start button is in the dock (A3; FR4)', () => {
  it('the dock holds the Start button, 44 px or more high, and its bottom is the card\'s bottom', async () => {
    const { card } = await onCard(fresh(), 0);
    await expectDockAtBottom(card);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Start: Squat' })).toBeVisible();
    expect((await box(btn(card, 'Start: Squat'))).height).toBeGreaterThanOrEqual(44);
  });

  it('with a short list the button is still at the bottom, not under the list', async () => {
    const { card } = await onCard(plan([ex('Squat', [set('1')])]), 0);
    await expectDockAtBottom(card);
    const list = card.getByRole('list', { name: 'Workout steps' });
    expect(await bottomOf(list)).toBeLessThan((await box(dockOf(card))).y - 40);
  });

  it('says Continue once something is logged, and "Ask Claude to change the plan." stays in the body, not the dock', async () => {
    const { card } = await onCard(plan([ex('Squat', [closed('1'), set('2')])]), 0);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Continue: Squat' })).toBeVisible();
    await pwExpect(card.getByText('Ask Claude to change the plan.')).toBeVisible();
    await pwExpect(dockOf(card).getByText('Ask Claude to change the plan.')).toHaveCount(0);
  });

  it('Start takes the person to the first step', async () => {
    const p = fresh();
    const { v, card } = await onCard(p, 0);
    await btn(card, 'Start: Squat').click();
    await expect.poll(() => counterText(v)).toBe(`2 of ${total(p)}`);
  });
});

describe('Specs: Exercise card, Skip set and Log set are in the dock (A3; FR8)', () => {
  it('the dock is at the bottom of the card with Skip set (about a third) beside Log set (about two thirds, 52 px)', async () => {
    const { card } = await onCard(fresh(), 1);
    await expectDockAtBottom(card);
    const dock = dockOf(card);
    const skip = await box(dock.getByRole('button', { name: 'Skip set', exact: true }));
    const log = await box(dock.getByRole('button', { name: 'Log set', exact: true }));
    expect(log.width / skip.width).toBeGreaterThan(1.8);
    expect(log.width / skip.width).toBeLessThan(2.2);
    expect(log.height).toBeGreaterThanOrEqual(52);
    expect(skip.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(skip.y - log.y)).toBeLessThanOrEqual(1); // one row
    expect(skip.x).toBeLessThan(log.x);
  });

  it('the zone keeps the set line and the steppers and holds neither Log set nor Skip set', async () => {
    const { card } = await onCard(fresh(), 1);
    const zone = zoneOf(card);
    await pwExpect(zone).toContainText('Set 1 of 3');
    await pwExpect(zone.getByRole('button', { name: /^Increase reps/ })).toBeVisible();
    await pwExpect(zone.getByRole('button', { name: /^Log set/ })).toHaveCount(0);
    await pwExpect(zone.getByRole('button', { name: /^Skip set/ })).toHaveCount(0);
  });

  it('the Log set label follows the steppers', async () => {
    const { card } = await onCard(fresh(), 1);
    await pwExpect(btn(card, 'Log set')).toHaveText('Log set · 5 × 82.5 kg');
    await card.getByRole('button', { name: /^Increase reps/ }).click();
    await pwExpect(dockOf(card).getByRole('button', { name: 'Log set' })).toHaveText('Log set · 6 × 82.5 kg');
  });

  it('a bodyweight and a timed exercise have the same dock', async () => {
    const pushup = ex('Push-up', [set('1', { weightKg: undefined, targetReps: 12 })], { bodyweight: true, equipment: 'bodyweight' });
    const plank = ex('Plank', [set('1', { weightKg: undefined, targetReps: 0, targetSec: 30 })], { bodyweight: true, timed: true, equipment: 'bodyweight' });
    const first = await onCard(plan([pushup, plank]), 1);
    await expectDockAtBottom(first.card);
    await pwExpect(dockOf(first.card).getByRole('button', { name: 'Log set' })).toHaveText('Log set · 12 reps');
    await jumpTo(first.v, 2);
    await settled(first.v);
    const second = cardsOf(first.v).nth(2);
    await expectDockAtBottom(second);
    await pwExpect(dockOf(second).getByRole('button', { name: 'Log set' })).toHaveText('Log set · 30 s');
    await pwExpect(dockOf(second).getByRole('button', { name: 'Skip set', exact: true })).toBeVisible();
  });

  it('a card taller than the minimum grows with its content, the track follows, and the dock stays at its bottom', async () => {
    const many = ex('Squat', Array.from({ length: 14 }, (_, k) => set(String(k + 1), { weightKg: 60 + k })));
    const { v, card } = await onCard(plan([many, bench()]), 1);
    const m = await card.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: (globalThis as unknown as Dom).getComputedStyle(el).overflowY }));
    expect(m.sh).toBe(m.ch); // the card does not scroll by itself: in the Claude iOS app the chat takes up-and-down swipes
    expect(m.oy).toBe('visible');
    expect(m.ch).toBeGreaterThan(440);
    await expectDockAtBottom(card);
    expect(Math.abs((await trackOf(v).evaluate((el) => el.clientHeight)) - m.ch)).toBeLessThanOrEqual(1);
  });

  it('Skip set still skips and the 600 ms tap lock still holds', async () => {
    const { v, card } = await onCard(plan([ex('Squat', [set('1'), set('2'), set('3')], { restSec: 0 }), bench()]), 1);
    const calls = () => v.calls.filter((c) => c.name === 'log_set').map((c) => c.args);
    await btn(card, 'Skip set').click();
    await expect.poll(() => calls()).toEqual([expect.objectContaining({ setId: '1', skip: true })]);
    await btn(card, 'Log set').evaluate((el) => {
      (el as unknown as DomNode).click(); // inside the lock window: ignored
    });
    await wait(100);
    expect(calls()).toHaveLength(1);
    await wait(LOCK);
    await btn(card, 'Log set').click();
    await expect.poll(() => calls().map((a) => a.setId)).toEqual(['1', '2']);
  });
});

describe('Specs: Dock, the tab order, the focus and the accessible names (A3)', () => {
  it('every control of the card content comes before the dock in the tab order', async () => {
    const { card } = await onCard(fresh(), 1);
    const flags = await card.evaluate((el) => Array.from((el as unknown as Scroller).querySelectorAll('button, input, textarea')).map((n) => !!n.closest('.dock')));
    expect(flags.some((f) => f)).toBe(true);
    expect(flags.some((f) => !f)).toBe(true);
    expect(flags).toEqual([...flags].sort((a, b) => Number(a) - Number(b))); // all content first, then the dock
  });

  it('Tab goes from the content to Skip set, then Log set', async () => {
    const { v, card } = await onCard(fresh(), 1);
    await btn(card, 'How to do it').focus();
    await v.page.keyboard.press('Tab');
    const focused = () => v.inView(() => (globalThis as unknown as Dom).document.activeElement?.getAttribute('data-key') ?? '');
    expect(await focused()).toBe('skip');
    await v.page.keyboard.press('Tab');
    expect(await focused()).toBe('log');
  });

  it('after Log set from the keyboard the focus is on Log set again, in the dock (the cards are redrawn)', async () => {
    const { v, card } = await onCard(plan([ex('Squat', [set('1'), set('2'), set('3')], { restSec: 0 }), bench()]), 1);
    await btn(card, 'Log set').focus();
    await v.page.keyboard.press('Enter');
    await pwExpect(card.locator('[data-set-id="1"]')).toContainText('✓');
    expect(await v.inView(() => (globalThis as unknown as Dom).document.activeElement?.getAttribute('data-key'))).toBe('log');
    expect(await v.inView(() => (globalThis as unknown as Dom).document.activeElement?.closest('.dock') != null)).toBe(true);
  });

  it('the Overview button keeps its key, and the cards out of view stay inert', async () => {
    const { v } = await onCard(fresh(), 0);
    expect(await v.inView(() => (globalThis as unknown as Dom).document.querySelector('[data-key="overview-go"]') !== null)).toBe(true);
    const inert = await v.inView(() => Array.from((globalThis as unknown as Dom).document.querySelectorAll('[aria-roledescription="card"]')).map((c) => c.inert));
    expect(inert).toEqual([false, true, true, true]);
  });

  it('Log set is named "Log set" (its text also carries the values)', async () => {
    const { card } = await onCard(fresh(), 1);
    await pwExpect(card.getByRole('button', { name: 'Log set', exact: true })).toHaveAttribute('aria-label', 'Log set');
    await pwExpect(card.getByRole('button', { name: 'Skip set', exact: true })).toHaveCount(1);
  });
});

describe('Specs: Dock, 44 px targets (A3)', () => {
  it('steppers, links, a logged row and the Overview rows are at least 44 px high', async () => {
    const { v, card } = await onCard(plan([ex('Squat', [closed('1'), set('2'), set('3')]), bench()]), 1);
    const targets = [btn(card, /^Increase reps/), btn(card, /^Decrease reps/), btn(card, /^Increase weight/), btn(card, /^Decrease weight/), btn(card, 'Note'), btn(card, 'How to do it'), card.locator('[data-set-id="1"] button')];
    for (const t of targets) expect((await box(t.first())).height).toBeGreaterThanOrEqual(43.5);
    await jumpTo(v, 0);
    await settled(v);
    const rows = cardsOf(v).first().locator('button.ovrow');
    expect(await rows.count()).toBe(2);
    for (let k = 0; k < (await rows.count()); k++) expect((await box(rows.nth(k))).height).toBeGreaterThanOrEqual(43.5);
  });

  it('the rest buttons are at least 44 px high', async () => {
    const { card } = await onCard(fresh(), 1);
    await btn(card, 'Log set').click();
    for (const name of ['−15 s', '+15 s', 'Skip rest']) expect((await box(btn(card, name))).height).toBeGreaterThanOrEqual(43.5);
  });
});

describe('Specs: Rest, the rest bar is the dock\'s rest state (A3; FR8)', () => {
  it('while resting the dock is in the same place and holds the rest controls', async () => {
    const { card } = await onCard(fresh(), 1);
    const before = await bottomOf(dockOf(card));
    await btn(card, 'Log set').click();
    await pwExpect(card.getByRole('group', { name: 'Rest controls' })).toBeVisible();
    await expectDockAtBottom(card);
    expect(before).toBeGreaterThan(0);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Skip rest' })).toBeVisible();
    await pwExpect(dockOf(card).getByRole('button', { name: 'Log set' })).toHaveCount(0);
  });

  it('Change puts Log set in the dock, above the rest controls, and the dock stays at the bottom', async () => {
    const { card } = await onCard(fresh(), 1);
    await btn(card, 'Log set').click();
    await btn(card, 'Change').click();
    await expectDockAtBottom(card);
    const log = btn(dockOf(card), 'Log set');
    await pwExpect(log).toBeVisible();
    await pwExpect(zoneOf(card).getByRole('button', { name: /^Log set/ })).toHaveCount(0);
    expect((await box(log)).y).toBeLessThan((await box(btn(card, 'Skip rest'))).y);
  });

  it('Skip rest brings Skip set and Log set back', async () => {
    const { card } = await onCard(fresh(), 1);
    await btn(card, 'Log set').click();
    await wait(LOCK);
    await btn(card, 'Skip rest').click();
    await pwExpect(dockOf(card).getByRole('button', { name: 'Skip set', exact: true })).toBeVisible();
    await pwExpect(dockOf(card).getByRole('button', { name: 'Log set' })).toBeVisible();
    await expectDockAtBottom(card);
  });
});

describe('Specs: Exercise done, the way on is in the dock (A3)', () => {
  it('"Go to Bench Press" is the dock\'s button and goes there', async () => {
    const p = plan([ex('Squat', [closed('1'), closed('2')]), bench()]);
    const { v, card } = await onCard(p, 1);
    await expectDockAtBottom(card);
    await pwExpect(zoneOf(card).getByRole('button')).toHaveCount(0);
    const go = dockOf(card).getByRole('button', { name: 'Go to Bench Press' });
    await pwExpect(go).toBeVisible();
    await go.click();
    await expect.poll(() => counterText(v)).toBe(`3 of ${total(p)}`);
  });

  it('on the last exercise it goes to the end of the workout', async () => {
    const { card } = await onCard(plan([ex('Squat', [closed('1'), closed('2')])]), 1);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Go to the end of the workout' })).toBeVisible();
  });
});

describe('Specs: Exercise done looks back (A8)', () => {
  const looking = () => plan([ex('Squat', [closed('1'), set('2'), set('3')]), ex('Bench Press', [closed('1'), closed('2')]), ex('Row', [set('1'), set('2')])]);

  it('with an earlier step still open the dock has "Back to Squat · 2 sets left" above the forward button', async () => {
    const { v, card } = await onCard(looking(), 2);
    await expectDockAtBottom(card);
    const back = dockOf(card).getByRole('button', { name: 'Back to Squat · 2 sets left', exact: true });
    const next = dockOf(card).getByRole('button', { name: 'Go to Row', exact: true });
    await pwExpect(back).toBeVisible();
    await pwExpect(next).toBeVisible();
    expect((await box(back)).y + (await box(back)).height).toBeLessThanOrEqual((await box(next)).y + 1);
    expect((await box(back)).height).toBeGreaterThanOrEqual(44);
    await next.focus();
    await back.click();
    await expect.poll(() => counterText(v)).toBe(`2 of ${total(looking())}`);
    await settled(v);
    expect(await v.inView(() => (globalThis as unknown as Dom).document.activeElement?.textContent ?? '')).toContain('Squat');
  });

  it('the tap lock applies, and the forward button is unchanged', async () => {
    const { v, card } = await onCard(looking(), 2);
    await dockOf(card).getByRole('button', { name: /^Back to/ }).evaluate((el) => {
      (el as unknown as DomNode).click();
      (el as unknown as DomNode).click();
    });
    await expect.poll(() => counterText(v)).toBe(`2 of ${total(looking())}`);
    await pwExpect(cardsOf(v).nth(2).getByRole('button', { name: 'Go to Row', exact: true })).toHaveCount(1);
  });

  it('there is no way back when nothing earlier is open', async () => {
    const { card } = await onCard(plan([ex('Squat', [closed('1'), closed('2')]), ex('Bench Press', [closed('1'), closed('2')]), ex('Row', [set('1')])]), 2);
    await pwExpect(dockOf(card).getByRole('button', { name: /^Back to/ })).toHaveCount(0);
    await pwExpect(dockOf(card).getByRole('button')).toHaveCount(1);
  });

  it('a cardio block that is not done is a way back too: "Back to <name> · not done"', async () => {
    const p = plan([ex('Squat', [closed('1')])], [cardio('c1', 'before', { name: 'Row machine' })]);
    const { card } = await onCard(p, 2);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Back to Row machine · not done', exact: true })).toBeVisible();
  });
});

describe('Specs: Cardio card, the dock holds Skip and Log cardio (A3; FR13)', () => {
  const cardioPlan = (c = cardio('c1', 'before', { plannedMin: 20, plannedKm: 3 })) => plan([squat(), bench()], [c]);

  it('Skip this (a third) beside Log cardio (two thirds, 52 px), at the bottom of the card', async () => {
    const { card } = await onCard(cardioPlan(), 1);
    await expectDockAtBottom(card);
    const skip = await box(dockOf(card).getByRole('button', { name: 'Skip this' }));
    const log = await box(dockOf(card).getByRole('button', { name: 'Log cardio' }));
    expect(log.width / skip.width).toBeGreaterThan(1.8);
    expect(log.height).toBeGreaterThanOrEqual(52);
    await pwExpect(card.locator('.zone').getByRole('button', { name: /Log cardio|Skip/ })).toHaveCount(0);
  });

  it('Skip this asks in the dock; Keep brings the pair back', async () => {
    const { card } = await onCard(cardioPlan(), 1);
    await btn(card, 'Skip this').click();
    await expectDockAtBottom(card);
    await pwExpect(dockOf(card).getByText('Skip cardio?')).toBeVisible();
    await btn(card, 'Keep').click();
    await pwExpect(dockOf(card).getByRole('button', { name: 'Log cardio' })).toBeVisible();
    await pwExpect(dockOf(card).getByRole('button', { name: 'Skip this' })).toBeVisible();
  });

  it('a skipped block offers Log cardio alone', async () => {
    const { card } = await onCard(cardioPlan(cardio('c1', 'before', { plannedMin: 20, skipped: true })), 1);
    await expectDockAtBottom(card);
    await pwExpect(dockOf(card).getByRole('button')).toHaveCount(1);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Log cardio' })).toBeVisible();
  });

  it('editing a logged block shows Cancel beside Save', async () => {
    const { card } = await onCard(cardioPlan(cardio('c1', 'before', { plannedMin: 20, done: true, minutes: 18 })), 1);
    await btn(card, 'Edit').click();
    await expectDockAtBottom(card);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Cancel' })).toBeVisible();
    await pwExpect(dockOf(card).getByRole('button', { name: 'Save' })).toBeVisible();
  });
});

describe('Specs: Finish card, the buttons are in the dock (A3; FR14)', () => {
  it('Finish and send to Claude is the dock\'s button when nothing is open', async () => {
    const { card } = await onCard(plan([ex('Squat', [closed('1'), closed('2')])]), 2);
    await expectDockAtBottom(card);
    await pwExpect(dockOf(card).getByRole('button', { name: 'Finish and send to Claude' })).toBeVisible();
  });

  it('Finish early is in the dock, and the confirm pair is stacked at full width: End first, Keep training under it', async () => {
    const { card } = await onCard(plan([ex('Squat', [closed('1'), set('2')]), ex('Bench Press', [skipped('1'), set('2')])]), 3);
    await expectDockAtBottom(card);
    await btn(card, 'Finish early').click();
    await expectDockAtBottom(card);
    await pwExpect(card).toContainText('End the workout now? 2 sets are not done.');
    const dock = await box(dockOf(card));
    const end = await box(dockOf(card).getByRole('button', { name: 'End and send to Claude' }));
    const keep = await box(dockOf(card).getByRole('button', { name: 'Keep training' }));
    expect(end.width).toBeGreaterThan(dock.width - 2);
    expect(keep.width).toBeGreaterThan(dock.width - 2);
    expect(end.y + end.height).toBeLessThanOrEqual(keep.y + 1);
    expect(end.height).toBeGreaterThanOrEqual(44);
    expect(keep.height).toBeGreaterThanOrEqual(44);
  });
});

describe('Specs: a finished workout has no dock (A3)', () => {
  it('no card shows a dock once the workout is finished', async () => {
    const v = await openView(plan([ex('Squat', [closed('1'), closed('2')])], [], { finished: true }));
    await settled(v);
    expect(await v.inView(() => Array.from((globalThis as unknown as Dom).document.querySelectorAll('.dock')).length)).toBe(0);
    for (const pos of [0, 1]) {
      await jumpTo(v, pos);
      await settled(v);
      await pwExpect(dockOf(cardsOf(v).nth(pos))).toHaveCount(0);
    }
  });
});

describe('Specs: Dock, opening a note keeps it at the card\'s bottom (A3; FR12)', () => {
  it('the dock stays at the card\'s bottom and the note field is revealed above it', async () => {
    const { card } = await onCard(fresh(), 1);
    await btn(card, 'Note').click();
    const area = card.getByRole('textbox', { name: 'Note for Squat' });
    await pwExpect(area).toBeVisible();
    await expectDockAtBottom(card);
    await expect.poll(async () => (await bottomOf(area)) <= (await box(dockOf(card))).y + 1).toBe(true);
  });
});

describe('Specs: the exercise name stays at the top of its card (pinned heading)', () => {
  const ramp = () =>
    ex('Squat', [set('w1', { warmup: true, weightKg: 20 }), set('w2', { warmup: true, weightKg: 40 }), set('w3', { warmup: true, weightKg: 60 }), set('w4', { warmup: true, weightKg: 70 }), set('1'), set('2'), set('3')], { restSec: 0 });

  it('after logging warm-ups the name is at the top of the card and Log set and Skip set are in view', async () => {
    for (const width of [375, 398]) {
      const { v, card } = await onCard(plan([ramp(), bench()]), 1, { width });
      for (const id of ['w1', 'w2', 'w3', 'w4']) {
        await btn(card, 'Log set').click();
        await pwExpect(id === 'w4' ? card.locator('[data-key="warmups-toggle"]') : card.locator(`[data-set-id="${id}"]`)).toContainText('✓');
        await wait(LOCK);
      }
      const heading = card.getByRole('heading', { name: 'Squat' });
      const c = await box(card);
      const hb = await box(heading);
      expect(hb.y).toBeGreaterThanOrEqual(c.y - 1);
      await pwExpect(btn(card, 'Log set')).toBeInViewport();
      await pwExpect(btn(card, 'Skip set')).toBeInViewport();
      const zone = await box(zoneOf(card));
      expect(zone.y).toBeGreaterThanOrEqual(hb.y + hb.height - 1);
      expect(zone.y + zone.height).toBeLessThanOrEqual((await box(dockOf(card))).y + 1);
      await v.page.close();
    }
  });

  it('opening a note scrolls it into view below the pinned name and above the dock', async () => {
    const { card } = await onCard(plan([ramp(), bench()]), 1);
    await btn(card, 'Note').click();
    const area = card.getByRole('textbox', { name: 'Note for Squat' });
    await pwExpect(area).toBeVisible();
    await expect.poll(async () => (await box(area)).y >= (await bottomOf(card.getByRole('heading', { name: 'Squat' }))) - 1).toBe(true);
    await expect.poll(async () => (await bottomOf(area)) <= (await box(dockOf(card))).y + 1).toBe(true);
  });

  it('only the name is pinned: it is the heading line of an exercise card, and the Overview heading is not', async () => {
    const { v, card } = await onCard(plan([ramp(), bench()]), 1);
    expect(await card.getByRole('heading', { name: 'Squat' }).evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).position)).toBe('sticky');
    expect(await card.getByText(/^barbell/).first().evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).position)).not.toBe('sticky');
    await jumpTo(v, 0);
    await settled(v);
    expect(await cardsOf(v).first().getByRole('heading', { name: 'Today' }).evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).position)).not.toBe('sticky');
  });
});
