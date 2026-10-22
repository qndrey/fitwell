// P7: secondary content (notes, swap, "How to do it") and the cardio card
// (Specs: Secondary content, Cardio card). The built view runs in a real Chromium inside an iframe and the test page
// plays the MCP Apps host; see tests/support/workoutHost.ts. The host answers get_substitutes, swap_exercise and
// get_exercise_guide through the `tools` option of openView.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  cardio,
  cardsOf,
  closed,
  closeBrowser,
  closeOpened,
  counterText,
  ex,
  jumpTo,
  launchBrowser,
  openView,
  plan,
  set,
  skipped,
  type HostOptions,
  type Opened,
} from './support/workoutHost';
import { motionFor } from '../src/exercises/motion';
import type { PlannedExercise, WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

// ---------- locators (the interface assumptions are listed in the reply) ----------
const LOCK = 700; // out of the 600 ms lock window
const cardOf = (v: Opened, k: number) => cardsOf(v).nth(k + 1);
const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const total = (p: WorkoutPlan) => p.exercises.length + p.cardio.length + 2;
const expectAt = async (v: Opened, p: WorkoutPlan, pos: number) => {
  await expect.poll(() => counterText(v), { timeout: 5000 }).toBe(`${pos + 1} of ${total(p)}`);
};
/** Opens the view, jumps to step `k` (0-based) and waits for the counter. */
async function onStep(p: WorkoutPlan, k: number, o: HostOptions = {}) {
  const v = await openView(p, o);
  await jumpTo(v, k + 1);
  await expectAt(v, p, k + 1);
  return { v, card: cardOf(v, k) };
}
async function backTo(v: Opened, p: WorkoutPlan, k: number) {
  await jumpTo(v, k + 1);
  await expectAt(v, p, k + 1);
}
const wait = (v: Opened, ms: number) => v.page.waitForTimeout(ms);
const callsOf = (v: Opened, name: string) => v.calls.filter((c) => c.name === name).map((c) => c.args);
const ok = (structuredContent: Record<string, unknown>) => ({ content: [{ type: 'text', text: 'ok' }], structuredContent });
const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
const valueOf = async (card: Locator, label: 'Reps' | 'Weight kg' | 'Minutes' | 'Distance km') => {
  const name = await card.getByRole('button', { name: new RegExp(`^${label}: `) }).first().getAttribute('aria-label');
  const n = Number.parseFloat((name ?? '').slice(label.length + 2));
  return Number.isNaN(n) ? 0 : n; // an empty distance reads "–"
};

// Page-side shapes (the workspace has no DOM lib).
interface Box {
  top: number;
  bottom: number;
  scrollTop: number;
  querySelector(selector: string): Box | null;
  querySelectorAll(selector: string): ArrayLike<unknown>;
  getBoundingClientRect(): { top: number; bottom: number };
}
/** Top of the first set row (from the top of the card's content) and how far Log set, in the dock, is above the card's bottom edge. */
const layoutOf = (card: Locator) =>
  card.evaluate((el) => {
    const root = el as unknown as Box;
    // A row is measured in the card's content (it must not move when a panel opens); Log set is in the dock, pinned to the bottom of
    // the card, so it is measured where it is seen: its distance from the card's bottom edge must not change.
    const rel = (n: Box | null) => (n ? Math.round(n.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop) : -1);
    const log = Array.from(root.querySelectorAll('button') as ArrayLike<Box & { textContent: string | null; getAttribute(n: string): string | null }>).find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '').startsWith('Log set')) ?? null;
    return { row: rel(root.querySelector('[data-set-id]')), log: log ? Math.round(root.getBoundingClientRect().bottom - log.getBoundingClientRect().bottom) : -1 };
  });
/** Waits until `target` lies inside the card's visible box (the card scrolled to reveal it). */
async function expectRevealed(card: Locator, target: Locator) {
  await expect
    .poll(
      async () => {
        const c = await card.boundingBox();
        const t = await target.boundingBox();
        if (!c || !t) return false;
        // A panel taller than the card (the guide) is revealed when its top is at the top of the card.
        return t.height + 8 > c.height ? t.y >= c.y - 1 && t.y <= c.y + 40 : t.y >= c.y - 1 && t.y + t.height <= c.y + c.height + 1;
      },
      { timeout: 5000 },
    )
    .toBe(true);
}

// ---------- fixtures ----------
const squat = (o: Partial<PlannedExercise> = {}) => ex('Squat', [set('1', { weightKg: 100 }), set('2', { weightKg: 100 }), set('3', { weightKg: 100 })], { id: 'ex:Squat', ...o });
const bench = () => ex('Bench Press', [set('1', { weightKg: 60 }), set('2', { weightKg: 60 })]);

// ---------- P7.1 Notes ----------
describe('Specs: Secondary content, rule 1 (P7.1; FR12)', () => {
  const noteBtn = (card: Locator) => btn(card, /^(Edit note|Note)$/);
  const area = (card: Locator, name = 'Squat') => card.getByRole('textbox', { name: `Note for ${name}` });

  it('a textarea exists only while the note is being edited', async () => {
    const { card } = await onStep(plan([squat(), bench()]), 0);
    await pwExpect(area(card)).toHaveCount(0);
    await noteBtn(card).click();
    await pwExpect(area(card)).toBeVisible();
    await noteBtn(card).click();
    await pwExpect(area(card)).toHaveCount(0);
  });

  it('typing updates the note and Save note sends set_exercise_note with workoutId, exerciseId (uid) and notes', async () => {
    const squatEx = squat();
    const { v, card } = await onStep(plan([squatEx, bench()]), 0);
    await noteBtn(card).click();
    await area(card).fill('seat 4, slow down');
    await btn(card, 'Save note').click();
    // Specs rule 1: Save note and blur both enqueue (key note:<uid>), so the host may see the same call twice.
    const expected = { workoutId: 'w1', exerciseId: squatEx.uid, notes: 'seat 4, slow down' };
    await expect.poll(() => callsOf(v, 'set_exercise_note').length).toBeGreaterThan(0);
    const calls = await callsOf(v, 'set_exercise_note');
    expect(calls.at(-1)).toEqual(expected);
    expect(calls.every((c) => JSON.stringify(c) === JSON.stringify(expected))).toBe(true);
  });

  it('after Save note the editor closes and "· saved" shows next to the note', async () => {
    const { card } = await onStep(plan([squat(), bench()]), 0);
    await noteBtn(card).click();
    await area(card).fill('tempo 3-1-1');
    await btn(card, 'Save note').click();
    await pwExpect(area(card)).toHaveCount(0);
    await pwExpect(card.getByText('tempo 3-1-1')).toBeVisible();
    await pwExpect(card.getByText(/· saved/)).toBeVisible();
  });

  it('leaving the field (blur) with a changed note saves it too', async () => {
    const squatEx = squat();
    const { v, card } = await onStep(plan([squatEx, bench()]), 0);
    await noteBtn(card).click();
    await area(card).fill('belt on');
    await area(card).blur();
    await expect.poll(() => callsOf(v, 'set_exercise_note')).toEqual([{ workoutId: 'w1', exerciseId: squatEx.uid, notes: 'belt on' }]);
  });

  it('an existing note is shown, offered as "Edit note" and prefilled in the editor', async () => {
    const { card } = await onStep(plan([squat({ notes: 'seat 4' }), bench()]), 0);
    await pwExpect(card.getByText(/seat 4/)).toBeVisible();
    await btn(card, 'Edit note').click();
    await pwExpect(area(card)).toHaveValue('seat 4');
  });

  it('a note edit does not call any other tool and a failed save does not lose the typed text', async () => {
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools: (name) => (name === 'set_exercise_note' ? fail('nope') : undefined) });
    await noteBtn(card).click();
    await area(card).fill('keep me');
    await btn(card, 'Save note').click();
    await expect.poll(() => callsOf(v, 'set_exercise_note').length).toBeGreaterThan(0);
    await pwExpect(card.getByText(/keep me/)).toBeVisible();
    expect(v.calls.map((c) => c.name).filter((n) => n !== 'set_exercise_note' && n !== 'get_workout')).toEqual([]);
  });
});

// ---------- P7.2 Swap ----------
const SUBS = [
  { id: 'ex:goblet', name: 'Goblet Squat', equipment: 'dumbbell' },
  { id: 'ex:legpress', name: 'Leg Press', equipment: 'machine' },
  { id: 'ex:hack', name: 'Hack Squat', equipment: 'machine' },
  { id: 'ex:lunge', name: 'Walking Lunge', equipment: 'bodyweight' },
  { id: 'ex:stepup', name: 'Step Up', equipment: 'dumbbell' },
  { id: 'ex:box', name: 'Box Squat', equipment: 'barbell' },
];
/** A host for the swap tools: what get_substitutes returns and whether swap_exercise works can be changed during the test. */
function swapHost(original: WorkoutPlan, uid: string) {
  const ctl = { subs: SUBS as typeof SUBS | 'fail', swap: 'ok' as 'ok' | 'fail' };
  const originalEx = original.exercises.find((e) => e.uid === uid)!;
  const withExercise = (e: PlannedExercise): WorkoutPlan => ({ ...original, exercises: original.exercises.map((x) => (x.uid === uid ? e : x)) });
  const tools: NonNullable<HostOptions['tools']> = (name, args) => {
    if (name === 'get_substitutes') return ctl.subs === 'fail' ? fail('boom') : ok({ substitutes: ctl.subs });
    if (name === 'swap_exercise') {
      if (ctl.swap === 'fail') return fail('refused');
      if (args.newId === originalEx.id) return ok({ workout: withExercise(originalEx) });
      const to = SUBS.find((s) => s.id === args.newId);
      const swapped = ex(to?.name ?? 'Unknown', [set('1', { weightKg: 20, targetReps: 8 }), set('2', { weightKg: 20, targetReps: 8 })], { id: String(args.newId), uid, equipment: to?.equipment ?? 'dumbbell' });
      return ok({ workout: withExercise(swapped) });
    }
    return undefined;
  };
  return { ctl, tools };
}
async function swapView(p: WorkoutPlan, uid: string) {
  const host = swapHost(p, uid);
  const r = await onStep(p, 0, { tools: host.tools });
  return { ...r, ...host };
}

describe('Specs: Secondary content, rule 2 (P7.2; FR12, AC14)', () => {
  it('Swap is offered while no set of the exercise is closed', async () => {
    const e = squat();
    const { card } = await swapView(plan([e, bench()]), e.uid);
    await pwExpect(btn(card, 'Swap')).toBeVisible();
  });

  it.each([
    ['a logged working set', [closed('1', { weightKg: 100 }), set('2'), set('3')]],
    ['a skipped set', [skipped('1'), set('2'), set('3')]],
    ['a logged warm-up', [closed('w', { warmup: true, weightKg: 40 }), set('1'), set('2')]],
  ])('Swap is not offered once %s is closed', async (_n, sets) => {
    const e = ex('Squat', sets, { id: 'ex:Squat' });
    const { card } = await onStep(plan([e, bench()]), 0);
    await pwExpect(btn(card, 'Swap')).toHaveCount(0);
  });

  it('opening Swap calls get_substitutes for that exercise and lists up to 4 alternatives with "Show N more"', async () => {
    const e = squat();
    const { v, card } = await swapView(plan([e, bench()]), e.uid);
    await btn(card, 'Swap').click();
    await pwExpect(btn(card, /^Goblet Squat/)).toBeVisible();
    expect(callsOf(v, 'get_substitutes')).toEqual([{ workoutId: 'w1', exerciseId: e.uid }]);
    for (const name of ['Goblet Squat', 'Leg Press', 'Hack Squat', 'Walking Lunge']) await pwExpect(btn(card, new RegExp(`^${name}`))).toBeVisible();
    await pwExpect(btn(card, /^Step Up/)).toHaveCount(0);
    await pwExpect(btn(card, /^Box Squat/)).toHaveCount(0);
    await btn(card, 'Show 2 more').click();
    await pwExpect(btn(card, /^Step Up/)).toBeVisible();
    await pwExpect(btn(card, /^Box Squat/)).toBeVisible();
    await pwExpect(btn(card, /^Show \d+ more/)).toHaveCount(0);
  });

  it('with 4 or fewer alternatives there is no "Show N more"', async () => {
    const e = squat();
    const { ctl, card } = await swapView(plan([e, bench()]), e.uid);
    ctl.subs = SUBS.slice(0, 4);
    await btn(card, 'Swap').click();
    await pwExpect(btn(card, /^Walking Lunge/)).toBeVisible();
    await pwExpect(btn(card, /^Show \d+ more/)).toHaveCount(0);
  });

  it('no alternatives shows "No similar exercise fits your equipment."', async () => {
    const e = squat();
    const { ctl, card } = await swapView(plan([e, bench()]), e.uid);
    ctl.subs = [];
    await btn(card, 'Swap').click();
    await pwExpect(card.getByText('No similar exercise fits your equipment.')).toBeVisible();
  });

  it('a failing get_substitutes shows "Could not load alternatives." with Try again, which asks again', async () => {
    const e = squat();
    const { v, ctl, card } = await swapView(plan([e, bench()]), e.uid);
    ctl.subs = 'fail';
    await btn(card, 'Swap').click();
    await pwExpect(card.getByText(/Could not load alternatives\./)).toBeVisible();
    ctl.subs = SUBS;
    await btn(card, 'Try again').click();
    await pwExpect(btn(card, /^Goblet Squat/)).toBeVisible();
    expect(callsOf(v, 'get_substitutes')).toHaveLength(2);
  });

  it('choosing an alternative calls swap_exercise and rebuilds the card from the returned plan, with a fresh draft', async () => {
    const e = squat();
    const { v, card } = await swapView(plan([e, bench()]), e.uid);
    expect(await valueOf(card, 'Weight kg')).toBe(100);
    expect(await valueOf(card, 'Reps')).toBe(5);
    await btn(card, 'Swap').click();
    await btn(card, /^Goblet Squat/).click();
    await expect.poll(() => callsOf(v, 'swap_exercise')).toEqual([{ workoutId: 'w1', exerciseId: e.uid, newId: 'ex:goblet' }]);
    await pwExpect(card.getByRole('heading', { name: /Goblet Squat/ })).toBeVisible();
    await expect.poll(() => valueOf(card, 'Weight kg')).toBe(20);
    expect(await valueOf(card, 'Reps')).toBe(8);
    // two sets in the returned plan: the first stands in the zone, one row remains
    await pwExpect(card.locator('[data-set-id]')).toHaveCount(1);
    await pwExpect(card.locator('[data-set-id="3"]')).toHaveCount(0);
  });

  it('after a swap "Swapped from <name> · Undo" shows and Undo swaps back to the original exercise', async () => {
    const e = squat();
    const { v, card } = await swapView(plan([e, bench()]), e.uid);
    await btn(card, 'Swap').click();
    await btn(card, /^Goblet Squat/).click();
    await pwExpect(card.getByText(/Swapped from Squat/)).toBeVisible();
    await btn(card, 'Undo').click();
    await expect.poll(() => callsOf(v, 'swap_exercise').at(-1)).toEqual({ workoutId: 'w1', exerciseId: e.uid, newId: 'ex:Squat' });
    await pwExpect(card.getByRole('heading', { name: /^Squat/ })).toBeVisible();
    await pwExpect(card.getByText(/Swapped from/)).toHaveCount(0);
    await expect.poll(() => valueOf(card, 'Weight kg')).toBe(100);
  });

  it('Undo and Swap disappear once the first set of the swapped exercise is logged', async () => {
    const e = squat();
    const { v, card } = await swapView(plan([e, bench()]), e.uid);
    await btn(card, 'Swap').click();
    await btn(card, /^Goblet Squat/).click();
    await pwExpect(card.getByText(/Swapped from Squat/)).toBeVisible();
    await wait(v, LOCK);
    await btn(card, 'Log set').click();
    await pwExpect(card.getByText(/Swapped from/)).toHaveCount(0);
    await pwExpect(btn(card, 'Swap')).toHaveCount(0);
    await pwExpect(btn(card, 'Undo')).toHaveCount(0);
  });

  it('a failing swap_exercise shows "Could not swap the exercise." with Try again, which retries the swap', async () => {
    const e = squat();
    const { v, ctl, card } = await swapView(plan([e, bench()]), e.uid);
    ctl.swap = 'fail';
    await btn(card, 'Swap').click();
    await btn(card, /^Goblet Squat/).click();
    await pwExpect(card.getByText(/Could not swap the exercise\./)).toBeVisible();
    await pwExpect(card.getByRole('heading', { name: /^Squat/ })).toBeVisible();
    ctl.swap = 'ok';
    await btn(card, 'Try again').click();
    await pwExpect(card.getByRole('heading', { name: /Goblet Squat/ })).toBeVisible();
    expect(callsOf(v, 'swap_exercise')).toHaveLength(2);
  });
});

// ---------- P7.3 Guide ----------
const guideOf = (name: string, instruction: string) => ({
  ref: `ex:${name}`,
  name,
  equipment: 'barbell',
  primary: ['quadriceps'],
  secondary: ['glutes'],
  instructions: [instruction],
  machine: null,
  motion: motionFor('Barbell Squat'),
  demoUrl: 'https://example.test/demo',
});
function guideHost(o: { failFirst?: boolean } = {}) {
  const ctl = { fail: !!o.failFirst };
  const tools: NonNullable<HostOptions['tools']> = (name, args) => {
    if (name !== 'get_exercise_guide') return undefined;
    if (ctl.fail) return fail('boom');
    return ok({ guide: guideOf(String(args.id).replace(/^ex:/, '').replace(/_/g, ' '), `Do the ${String(args.id)} carefully`) });
  };
  return { ctl, tools };
}
interface RafWindow {
  __raf?: number;
  requestAnimationFrame(cb: (t: number) => void): number;
}
/** How many animation frames the view requested in `ms` (a running MotionPlayer requests one per frame; a stopped one none). */
async function frames(v: Opened, ms: number) {
  await v.inView(() => {
    const w = globalThis as unknown as RafWindow;
    if (w.__raf === undefined) {
      w.__raf = 0;
      const orig = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (cb) => {
        w.__raf = (w.__raf ?? 0) + 1;
        return orig(cb);
      };
    }
    w.__raf = 0;
  });
  await wait(v, ms);
  return v.inView(() => (globalThis as unknown as RafWindow).__raf ?? 0);
}
const canvases = (v: Opened) => v.frame.locator('canvas');
const hasWebGl = (v: Opened) =>
  v.inView(() => {
    const d = globalThis as unknown as { document: { createElement(t: string): { getContext(k: string): unknown } } };
    return !!d.document.createElement('canvas').getContext('webgl');
  });

describe('Specs: Secondary content, rule 3 (P7.3; FR12, AC14)', () => {
  const guideBtn = (card: Locator) => btn(card, 'How to do it');

  it('"How to do it" calls get_exercise_guide with the exercise id on first open and renders the guide in the card', async () => {
    const e = squat();
    const { tools } = guideHost();
    const { v, card } = await onStep(plan([e, bench()]), 0, { tools });
    await guideBtn(card).click();
    await pwExpect(card.getByRole('region', { name: 'How to do Squat' })).toBeVisible();
    await pwExpect(card.getByText('Do the ex:Squat carefully')).toBeVisible();
    expect(callsOf(v, 'get_exercise_guide')).toEqual([{ id: 'ex:Squat' }]);
  });

  it('closing and opening the guide again does not fetch it a second time', async () => {
    const { tools } = guideHost();
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools });
    await guideBtn(card).click();
    await pwExpect(card.getByRole('region', { name: 'How to do Squat' })).toBeVisible();
    await btn(card, /^Close the guide/).click();
    await pwExpect(card.getByRole('region', { name: 'How to do Squat' })).toHaveCount(0);
    await guideBtn(card).click();
    await pwExpect(card.getByRole('region', { name: 'How to do Squat' })).toBeVisible();
    expect(callsOf(v, 'get_exercise_guide')).toHaveLength(1);
  });

  it('a failing guide shows "Could not load the guide." with Try again, which asks again', async () => {
    const host = guideHost({ failFirst: true });
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools: host.tools });
    await guideBtn(card).click();
    await pwExpect(card.getByText(/Could not load the guide\./)).toBeVisible();
    host.ctl.fail = false;
    await btn(card, 'Try again').click();
    await pwExpect(card.getByRole('region', { name: 'How to do Squat' })).toBeVisible();
    expect(callsOf(v, 'get_exercise_guide')).toHaveLength(2);
  });

  const showAnimation = (card: Locator) => btn(card, 'Show the animation').click();

  it('opens with the written steps and no animation: no canvas is created until "Show the animation" is tapped', async () => {
    const { tools } = guideHost();
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools });
    await guideBtn(card).click();
    const region = card.getByRole('region', { name: 'How to do Squat' });
    await pwExpect(region.getByText('Do the ex:Squat carefully')).toBeVisible();
    await pwExpect(card.locator('canvas')).toHaveCount(0);
    await pwExpect(canvases(v)).toHaveCount(0);
    const show = btn(card, 'Show the animation');
    await pwExpect(show).toHaveAttribute('aria-expanded', 'false');
    expect((await show.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const steps = (await region.getByText('Do the ex:Squat carefully').boundingBox())!.y;
    expect((await show.boundingBox())!.y).toBeGreaterThan(steps);
  });

  it('"Show the animation" brings the figure and turns into "Hide the animation", which removes it again', async (ctx) => {
    const { tools } = guideHost();
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools });
    if (!(await hasWebGl(v))) ctx.skip();
    await guideBtn(card).click();
    await showAnimation(card);
    await pwExpect(card.locator('canvas')).toHaveCount(1);
    await pwExpect(btn(card, 'Hide the animation')).toHaveAttribute('aria-expanded', 'true');
    await btn(card, 'Hide the animation').click();
    await pwExpect(card.locator('canvas')).toHaveCount(0);
    await pwExpect(btn(card, 'Show the animation')).toBeVisible();
  });

  it('"Open the full guide in the chat" asks Claude for show_exercise and leaves the player as it is', async () => {
    const { tools } = guideHost();
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools });
    await guideBtn(card).click();
    await btn(card, 'Open the full guide in the chat').click();
    await expect.poll(() => v.messages.length).toBe(1);
    expect(v.messages[0]).toContain('show_exercise');
    expect(v.messages[0]).toContain('Squat');
    await pwExpect(card.getByRole('region', { name: 'How to do Squat' })).toBeVisible();
  });

  it('opening the guide puts the one animation in that card and it runs', async (ctx) => {
    const { tools } = guideHost();
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools });
    if (!(await hasWebGl(v))) ctx.skip();
    await guideBtn(card).click();
    await showAnimation(card);
    await pwExpect(card.locator('canvas')).toHaveCount(1);
    await pwExpect(canvases(v)).toHaveCount(1);
    expect(await frames(v, 400)).toBeGreaterThan(2);
  });

  it('closing the guide removes the animation from the card and stops it', async (ctx) => {
    const { tools } = guideHost();
    const { v, card } = await onStep(plan([squat(), bench()]), 0, { tools });
    if (!(await hasWebGl(v))) ctx.skip();
    await guideBtn(card).click();
    await showAnimation(card);
    await pwExpect(card.locator('canvas')).toHaveCount(1);
    await btn(card, /^Close the guide/).click();
    await pwExpect(card.locator('canvas')).toHaveCount(0);
    await wait(v, 200);
    expect(await frames(v, 400)).toBeLessThanOrEqual(1);
  });

  it('swiping to another card stops the animation', async (ctx) => {
    const p = plan([squat(), bench()]);
    const { tools } = guideHost();
    const { v, card } = await onStep(p, 0, { tools });
    if (!(await hasWebGl(v))) ctx.skip();
    await guideBtn(card).click();
    await showAnimation(card);
    await pwExpect(card.locator('canvas')).toHaveCount(1);
    await jumpTo(v, 2);
    await expectAt(v, p, 2);
    await wait(v, 300);
    expect(await frames(v, 400)).toBeLessThanOrEqual(1);
  });

  it('there is one MotionPlayer: opening a guide on a second card moves the same canvas there', async (ctx) => {
    const p = plan([squat(), bench()]);
    const { tools } = guideHost();
    const { v, card } = await onStep(p, 0, { tools });
    if (!(await hasWebGl(v))) ctx.skip();
    await guideBtn(card).click();
    await showAnimation(card);
    await pwExpect(card.locator('canvas')).toHaveCount(1);
    await backTo(v, p, 1);
    const second = cardOf(v, 1);
    await guideBtn(second).click();
    await showAnimation(second);
    await pwExpect(second.locator('canvas')).toHaveCount(1);
    await pwExpect(canvases(v)).toHaveCount(1);
    await pwExpect(card.locator('canvas')).toHaveCount(0);
  });
});

// ---------- P7.4 Opening secondary content keeps the layout ----------
describe('Specs: Secondary content, rule 4 (P7.4; FR12, AC10)', () => {
  const opener = {
    note: async (card: Locator) => {
      await btn(card, /^(Edit note|Note)$/).click();
      return card.getByRole('textbox', { name: 'Note for Squat' });
    },
    swap: async (card: Locator) => {
      await btn(card, 'Swap').click();
      return btn(card, /^Goblet Squat/);
    },
    guide: async (card: Locator) => {
      await btn(card, 'How to do it').click();
      return card.getByRole('region', { name: 'How to do Squat' });
    },
  };
  it.each(['note', 'swap', 'guide'] as const)('opening %s does not move the set rows or Log set, and the card scrolls to reveal it', async (what) => {
    const e = squat();
    const host = { ...swapHost(plan([e, bench()]), e.uid) };
    const guide = guideHost();
    const tools: NonNullable<HostOptions['tools']> = (name, args) => host.tools(name, args) ?? guide.tools(name, args);
    const { card } = await onStep(plan([e, bench()]), 0, { tools, width: 375 });
    const before = await layoutOf(card);
    expect(before.row).toBeGreaterThan(-1);
    expect(before.log).toBeGreaterThan(-1);
    const target = await opener[what](card);
    await pwExpect(target).toBeVisible();
    expect(await layoutOf(card)).toEqual(before);
    await expectRevealed(card, target);
  });
});

// ---------- P7.5 Cardio card ----------
describe('Specs: Cardio card (P7.5; FR13, AC15, NG3)', () => {
  const warm = (o: Partial<ReturnType<typeof cardio>> = {}) => cardio('c1', 'before', { plannedMin: 20, plannedKm: 3, ...o });
  const cardioPlan = (c = warm()) => plan([squat(), bench()], [c]);
  const logBtn = (card: Locator) => btn(card, 'Log cardio');
  const incBtn = (card: Locator, what: 'minutes' | 'distance') => btn(card, new RegExp(`^Increase ${what}`, 'i'));
  const decBtn = (card: Locator, what: 'minutes' | 'distance') => btn(card, new RegExp(`^Decrease ${what}`, 'i'));
  const cardioCalls = (v: Opened) => callsOf(v, 'log_cardio_block');

  it('shows "Planned m min · d km", the Minutes and Distance steppers, Log cardio and Skip this', async () => {
    const { card } = await onStep(cardioPlan(), 0);
    await pwExpect(card.getByText('Planned 20 min · 3 km')).toBeVisible();
    expect(await valueOf(card, 'Minutes')).toBe(20);
    expect(await valueOf(card, 'Distance km')).toBe(3);
    await pwExpect(logBtn(card)).toBeVisible();
    await pwExpect(btn(card, 'Skip this')).toBeVisible();
  });

  it('shows "Warm-up" or "Finisher" under the title, not in a counter slot beside it', async () => {
    const before = await onStep(cardioPlan(), 0);
    const heading = before.card.getByRole('heading');
    const sub = before.card.getByText('Warm-up', { exact: true });
    await pwExpect(sub).toBeVisible();
    const [h, sb] = [(await heading.boundingBox())!, (await sub.boundingBox())!];
    expect(sb.y).toBeGreaterThanOrEqual(h.y + h.height - 1); // under the title
    await before.v.page.close();
    const after = await onStep(plan([squat(), bench()], [cardio('c2', 'after', { plannedMin: 10 })]), 2);
    await pwExpect(after.card.getByText('Finisher', { exact: true })).toBeVisible();
  });

  it('a block without a planned distance shows "Planned m min" only and starts with no distance', async () => {
    const { card } = await onStep(cardioPlan(cardio('c1', 'before', { plannedMin: 15 })), 0);
    await pwExpect(card.getByText('Planned 15 min', { exact: true })).toBeVisible();
    expect(await valueOf(card, 'Distance km')).toBe(0);
  });

  it('minutes are limited to 1..240 (typed values are clamped)', async () => {
    const { card } = await onStep(cardioPlan(), 0);
    const field = card.locator('input');
    await card.getByRole('button', { name: /^Minutes: / }).click();
    await field.fill('999');
    await field.press('Tab');
    await expect.poll(() => valueOf(card, 'Minutes')).toBe(240);
    await card.getByRole('button', { name: /^Minutes: / }).click();
    await field.fill('0');
    await field.press('Tab');
    await expect.poll(() => valueOf(card, 'Minutes')).toBe(1);
    await decBtn(card, 'minutes').click({ force: true });
    expect(await valueOf(card, 'Minutes')).toBe(1);
  });

  it('Log cardio calls log_cardio_block with minutes and, when greater than 0, distanceKm', async () => {
    const { v, card } = await onStep(cardioPlan(), 0);
    await incBtn(card, 'minutes').click();
    const minutes = await valueOf(card, 'Minutes');
    expect(minutes).toBeGreaterThan(20);
    await logBtn(card).click();
    await expect.poll(() => cardioCalls(v)).toEqual([{ workoutId: 'w1', blockId: 'c1', minutes, distanceKm: 3 }]);
  });

  it('without a distance the call carries no distanceKm', async () => {
    const { v, card } = await onStep(cardioPlan(cardio('c1', 'before', { plannedMin: 15 })), 0);
    await logBtn(card).click();
    await expect.poll(() => cardioCalls(v).length).toBe(1);
    expect(cardioCalls(v)[0]).toEqual({ workoutId: 'w1', blockId: 'c1', minutes: 15 });
  });

  it('Skip this asks "Skip cardio?" first and Keep leaves the block open without any call', async () => {
    const { v, card } = await onStep(cardioPlan(), 0);
    await btn(card, 'Skip this').click();
    await pwExpect(card.getByText('Skip cardio?')).toBeVisible();
    await pwExpect(btn(card, 'Skip')).toBeVisible();
    await btn(card, 'Keep').click();
    await pwExpect(card.getByText('Skip cardio?')).toHaveCount(0);
    await pwExpect(logBtn(card)).toBeVisible();
    await pwExpect(btn(card, 'Skip this')).toBeVisible();
    expect(cardioCalls(v)).toEqual([]);
  });

  it('confirming Skip calls log_cardio_block with skip: true', async () => {
    const { v, card } = await onStep(cardioPlan(), 0);
    await btn(card, 'Skip this').click();
    await wait(v, LOCK);
    await btn(card, 'Skip').click();
    await expect.poll(() => cardioCalls(v)).toEqual([expect.objectContaining({ workoutId: 'w1', blockId: 'c1', skip: true })]);
  });

  it('a skipped block keeps offering Log cardio, and logging it later calls log_cardio_block with minutes', async () => {
    const p = cardioPlan(warm({ skipped: true }));
    const { v, card } = await onStep(p, 0);
    await pwExpect(logBtn(card)).toBeVisible();
    await logBtn(card).click();
    await expect.poll(() => cardioCalls(v)).toEqual([{ workoutId: 'w1', blockId: 'c1', minutes: 20, distanceKm: 3 }]);
  });

  it('a logged block shows "m min · d km" with Edit and no steppers', async () => {
    const { card } = await onStep(cardioPlan(warm({ done: true, minutes: 18, distanceKm: 2 })), 0);
    await pwExpect(card.getByText('18 min · 2 km')).toBeVisible();
    await pwExpect(btn(card, 'Edit')).toBeVisible();
    await pwExpect(logBtn(card)).toHaveCount(0);
    await pwExpect(incBtn(card, 'minutes')).toHaveCount(0);
  });

  it('a logged block without distance shows "m min"', async () => {
    const { card } = await onStep(cardioPlan(cardio('c1', 'before', { done: true, minutes: 12 })), 0);
    await pwExpect(card.getByText('✓ Logged 12 min', { exact: true })).toBeVisible();
  });

  it('a logged block reads "✓ Logged 10 min · 1.5 km · ~130 kcal" with Edit as a 44 px text link', async () => {
    const { card } = await onStep(cardioPlan(cardio('c1', 'before', { done: true, minutes: 10, distanceKm: 1.5, kcal: 130 })), 0);
    await pwExpect(card.getByText('✓ Logged 10 min · 1.5 km · ~130 kcal', { exact: true })).toBeVisible();
    const edit = btn(card, 'Edit');
    await pwExpect(edit).toHaveClass(/link/);
    expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  it('an open block shows last time and the kcal estimate for the planned minutes', async () => {
    const { card } = await onStep(cardioPlan(cardio('c1', 'before', { plannedMin: 10, plannedKm: 1.5, last: '10 min · 1.5 km', estKcal: 46 })), 0);
    await pwExpect(card.getByText('Last time: 10 min · 1.5 km', { exact: true })).toBeVisible();
    await pwExpect(card.getByText('~46 kcal', { exact: true })).toBeVisible();
  });

  it('an open block without last time or estimate shows neither', async () => {
    const { card } = await onStep(cardioPlan(cardio('c1', 'before', { plannedMin: 10 })), 0);
    await pwExpect(card.getByText(/Last time|kcal/)).toHaveCount(0);
  });

  it('logging a block with an estimate shows its kcal for the logged minutes straight away', async () => {
    const { v, card } = await onStep(cardioPlan(cardio('c1', 'before', { plannedMin: 10, estKcal: 50 })), 0);
    await incBtn(card, 'minutes').click();
    const minutes = await valueOf(card, 'Minutes');
    await logBtn(card).click();
    await expect.poll(() => cardioCalls(v).length).toBe(1);
    await pwExpect(card.getByText(`✓ Logged ${minutes} min · ~${Math.round(5 * minutes)} kcal`, { exact: true })).toBeVisible();
  });

  it('Edit reopens the steppers and Save enqueues log_cardio_block again with the new minutes', async () => {
    const { v, card } = await onStep(cardioPlan(warm({ done: true, minutes: 18, distanceKm: 2 })), 0);
    await btn(card, 'Edit').click();
    await wait(v, LOCK);
    expect(await valueOf(card, 'Minutes')).toBe(18);
    await incBtn(card, 'minutes').click();
    const minutes = await valueOf(card, 'Minutes');
    expect(minutes).toBeGreaterThan(18);
    await btn(card, /^Save/).click();
    await expect.poll(() => cardioCalls(v)).toEqual([{ workoutId: 'w1', blockId: 'c1', minutes, distanceKm: 2 }]);
    await pwExpect(card.getByText(`${minutes} min · 2 km`)).toBeVisible();
  });

  it('Edit can raise the distance but never clear or lower it, and offers no way to mark the block not done', async () => {
    const { v, card } = await onStep(cardioPlan(warm({ done: true, minutes: 18, distanceKm: 2 })), 0);
    await btn(card, 'Edit').click();
    for (let i = 0; i < 6; i++) await decBtn(card, 'distance').click({ force: true });
    expect(await valueOf(card, 'Distance km')).toBeGreaterThanOrEqual(2);
    await incBtn(card, 'distance').click();
    const km = await valueOf(card, 'Distance km');
    expect(km).toBeGreaterThan(2);
    await pwExpect(card.getByRole('button', { name: /not done|clear|reopen|undo/i })).toHaveCount(0);
    await btn(card, /^Save/).click();
    await expect.poll(() => cardioCalls(v).at(-1)).toEqual({ workoutId: 'w1', blockId: 'c1', minutes: 18, distanceKm: km });
  });

  it('a cardio card has no note, swap or guide', async () => {
    const { card } = await onStep(cardioPlan(), 0);
    await pwExpect(btn(card, /^(Note|Edit note)$/)).toHaveCount(0);
    await pwExpect(btn(card, 'Swap')).toHaveCount(0);
    await pwExpect(btn(card, 'How to do it')).toHaveCount(0);
    await pwExpect(card.locator('textarea')).toHaveCount(0);
  });

  it('a logged cardio block shows its values on its card after the pager moved on and back (state is kept)', async () => {
    const p = cardioPlan();
    const { v, card } = await onStep(p, 0);
    await logBtn(card).click();
    await expect.poll(() => cardioCalls(v).length).toBe(1);
    await wait(v, LOCK);
    await backTo(v, p, 0);
    await pwExpect(card.getByText('20 min · 3 km')).toBeVisible();
    await pwExpect(btn(card, 'Edit')).toBeVisible();
  });
});
