// The rest between sets is stored by the server and resumed when the workout is opened again (Specs: Stored rest).
// The built view runs in a real Chromium inside an iframe and the test page plays the MCP Apps host; see tests/support/workoutHost.ts.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cardsOf, closed, closeBrowser, closeOpened, counterText, ex, jumpTo, launchBrowser, openView, plan, set, settled, type Opened } from './support/workoutHost';
import type { PlannedRest, WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const squat = () => ex('Squat', [closed('1', { weightKg: 80 }), set('2', { weightKg: 82.5 }), set('3', { weightKg: 82.5 })]);
const bench = () => ex('Bench Press', [set('1', { weightKg: 60 })]);
const restCalls = (v: Opened) => v.calls.filter((c) => c.name === 'set_rest').map((c) => c.args);
const secondsLeft = async (card: Locator) => {
  const m = /^(\d+):(\d\d)$/.exec(((await card.getByRole('timer').first().textContent()) ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};

/** A workout with the first set of Squat done, as the server returns it with a stored rest. */
function withRest(rest: Omit<PlannedRest, 'exerciseUid'> | undefined): { p: WorkoutPlan; uid: string } {
  const e = squat();
  return { p: plan([e, bench()], [], rest ? { rest: { ...rest, exerciseUid: e.uid } } : {}), uid: e.uid };
}

describe('Specs: Stored rest', () => {
  it('resumes a rest that is still running: on the card that holds it, with the time the server says is left and the next set', async () => {
    const { p } = withRest({ remainingMs: 45_000, totalMs: 90_000 });
    const v = await openView(p);
    await expect.poll(() => counterText(v)).toBe('2 of 4');
    const card = cardsOf(v).nth(1);
    const left = await secondsLeft(card);
    expect(left).toBeGreaterThanOrEqual(43);
    expect(left).toBeLessThanOrEqual(45);
    await pwExpect(card.locator('.next p')).toContainText('set 2 of 3');
    await pwExpect(btn(card, 'Skip rest')).toBeVisible();
  });

  it('a rest that ended under 3 s ago shows "Rest over" with Start set; without a rest the set zone shows at once', async () => {
    const { p } = withRest({ remainingMs: -1_000, totalMs: 90_000 });
    const v = await openView(p);
    const card = cardsOf(v).nth(1);
    await pwExpect(card.getByText('Rest over')).toBeVisible();
    await pwExpect(btn(card, 'Start set 2')).toBeVisible();
    await pwExpect(card.getByText('Rest over')).toBeHidden({ timeout: 4000 }); // the 3 s count started when it ended

    const none = await openView(withRest(undefined).p);
    const c2 = cardsOf(none).nth(1);
    await pwExpect(btn(c2, 'Log set')).toBeVisible();
    await pwExpect(c2.getByText('Rest over')).toHaveCount(0);
    expect(await c2.getByRole('timer').count()).toBe(0);
  });

  it('ignores a stored rest of an exercise with nothing left to do', async () => {
    const e = ex('Squat', [closed('1', { weightKg: 80 })]);
    const v = await openView(plan([e, bench()], [], { rest: { exerciseUid: e.uid, remainingMs: 30_000, totalMs: 90_000 } }));
    await pwExpect(v.frame.getByRole('timer')).toHaveCount(0);
  });

  it('Skip rest and Start set tell the server (restSec 0), and +15 s sends the time left', async () => {
    const { p } = withRest({ remainingMs: 60_000, totalMs: 90_000 });
    const v = await openView(p);
    const card = cardsOf(v).nth(1);
    await btn(card, '+15 s').click();
    await expect.poll(() => restCalls(v).length).toBe(1);
    expect(restCalls(v)[0]!.restSec as number).toBeGreaterThanOrEqual(74);
    expect(restCalls(v)[0]!.restSec as number).toBeLessThanOrEqual(75);
    expect(restCalls(v)[0]!.totalSec).toBe(105);
    await v.page.waitForTimeout(700);
    await btn(card, 'Skip rest').click();
    await expect.poll(() => restCalls(v).at(-1)?.restSec).toBe(0);
  });

  it('logging a set sends the rest it starts with it (restSec), and the last set (no rest follows, none running) sends none', async () => {
    const e = ex('Squat', [set('1', { weightKg: 80 }), set('2', { weightKg: 80 })], { restSec: 90 });
    const v = await openView(plan([e]));
    await jumpTo(v, 1);
    await settled(v);
    const card = cardsOf(v).nth(1);
    await btn(card, 'Log set').click();
    await expect.poll(() => v.calls.filter((c) => c.name === 'log_set').length).toBe(1);
    expect(v.calls.find((c) => c.name === 'log_set')!.args.restSec).toBe(90);
    await v.page.waitForTimeout(700);
    await btn(card, 'Skip rest').click();
    await v.page.waitForTimeout(700);
    await btn(card, 'Log set').click();
    await expect.poll(() => v.calls.filter((c) => c.name === 'log_set').length).toBe(2);
    expect(v.calls.filter((c) => c.name === 'log_set')[1]!.args).not.toHaveProperty('restSec');
  });
});
