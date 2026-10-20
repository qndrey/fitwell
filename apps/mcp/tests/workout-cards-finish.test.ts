// P8: the Finish card, finishing, send failures, reopening a finished workout, read-only after finish, honest saving
// and progress sharing (Specs: Finish card, Opening and resume rule 4, Honest saving, Progress sharing and finish message).
// The built view runs in a real Chromium inside an iframe and the test page plays the MCP Apps host (tests/support/workoutHost.ts).
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cardsOf, closed, closeBrowser, closeOpened, counterText, ex, jumpTo, launchBrowser, openView, plan, set, skipped, cardio, type HostOptions, type Opened } from './support/workoutHost';
import type { WorkoutPlan } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const LOCK = 700; // out of the 600 ms lock window
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const total = (p: WorkoutPlan) => p.exercises.length + p.cardio.length + 2;
const finishCard = (v: Opened) => cardsOf(v).last();
const finishCalls = (v: Opened) => v.calls.filter((c) => c.name === 'finish_workout');

const RECORD = 'new best estimated 1RM: 102.1 kg (was 96.3)';
/** A `finish_workout` result as the server returns it, with or without a record. */
const finishWith =
  (records: boolean) =>
  (name: string): Record<string, unknown> | undefined =>
    name === 'finish_workout'
      ? {
          content: [{ type: 'text', text: 'Finished.' }],
          structuredContent: {
            minutes: 34,
            volumeKg: 5120,
            exercises: [{ name: 'Squat', done: '2 sets: 5 × 80 kg', ...(records ? { personalRecord: RECORD } : {}) }],
          },
        }
      : undefined;

/** Opens the view on a plan; the Finish card is the last card, and a plan with no open step opens on it. */
async function onFinish(p: WorkoutPlan, o: HostOptions = {}) {
  const v = await openView(p, o);
  await jumpTo(v, total(p) - 1);
  await expect.poll(() => counterText(v)).toBe(`${total(p)} / ${total(p)}`);
  await wait(LOCK);
  return { v, card: finishCard(v) };
}

const allClosed = () => plan([ex('Squat', [closed('1'), closed('2')])]);
const oneOpen = () => plan([ex('Squat', [closed('1'), set('2')]), ex('Bench Press', [skipped('1'), set('2')])]);

describe('Specs: Finish card rule 1, before finishing (P8.1; FR14, FR15, AC7)', () => {
  it('shows the elapsed time, the working sets closed of total and the primary button when everything is closed', async () => {
    const { card } = await onFinish(allClosed());
    await pwExpect(card.getByRole('heading', { name: 'End of workout' })).toBeVisible();
    await pwExpect(card).toContainText('2 of 2 working sets');
    await pwExpect(card).toContainText('elapsed');
    await pwExpect(btn(card, 'Finish and send to Claude')).toBeVisible();
    await pwExpect(btn(card, 'Finish early')).toHaveCount(0);
  });

  it('lists what is not done and skipped, and asks before ending early', async () => {
    const { v, card } = await onFinish(oneOpen());
    await pwExpect(card).toContainText('Not done');
    await pwExpect(card).toContainText('Squat set 2');
    await pwExpect(card).toContainText('Skipped');
    await pwExpect(card).toContainText('Bench Press set 1');
    await pwExpect(btn(card, 'Finish and send to Claude')).toHaveCount(0);
    await btn(card, 'Finish early').click();
    await pwExpect(card).toContainText('End the workout now? 2 sets are not done.');
    await pwExpect(btn(card, 'Keep training')).toBeVisible();
    await pwExpect(btn(card, 'End and send to Claude')).toBeVisible();
    expect(finishCalls(v)).toHaveLength(0);
    expect(v.messages).toHaveLength(0);
  });

  it('Keep training closes the confirm and takes the person to the first open step', async () => {
    const p = oneOpen();
    const { v, card } = await onFinish(p);
    await btn(card, 'Finish early').click();
    await wait(LOCK);
    await btn(card, 'Keep training').click();
    await expect.poll(() => counterText(v)).toBe(`2 / ${total(p)}`);
    await pwExpect(btn(card, 'Finish early')).toBeVisible();
    expect(finishCalls(v)).toHaveLength(0);
  });

  it('a double tap on Finish early does not end the workout', async () => {
    const { v, card } = await onFinish(oneOpen());
    await btn(card, 'Finish early').dblclick();
    await pwExpect(card).toContainText('End the workout now?');
    await wait(LOCK);
    expect(finishCalls(v)).toHaveLength(0);
    expect(v.messages).toHaveLength(0);
  });

  it('shows no new-best text before finishing', async () => {
    const { card } = await onFinish(allClosed(), { tools: finishWith(true) });
    await pwExpect(card).not.toContainText('New best');
    await pwExpect(card).not.toContainText('No new bests');
  });

  it('lists an open cardio block with the open sets', async () => {
    const { card } = await onFinish(plan([ex('Squat', [closed('1')])], [cardio('c1', 'after', { name: 'Row' })]));
    await pwExpect(card).toContainText('Not done');
    await pwExpect(card).toContainText('Row');
    await pwExpect(btn(card, 'Finish early')).toBeVisible();
  });
});

describe('Specs: Finish card rules 2 and 3, finishing and the finished card (P8.2, P8.3; FR14, FR15, AC7, AC8)', () => {
  it('calls finish_workout once, sends one message, and shows the summary with its new best', async () => {
    const { v, card } = await onFinish(allClosed(), { tools: finishWith(true) });
    await btn(card, 'Finish and send to Claude').click();
    await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
    await pwExpect(card).toContainText('34 min');
    await pwExpect(card.getByRole('heading', { name: 'New best' })).toBeVisible();
    await pwExpect(card).toContainText('Squat');
    await pwExpect(card).toContainText('estimated 1RM: 102.1 kg (was 96.3)');
    await pwExpect(card).toContainText('Sent to Claude. It will reply below.');
    await expect.poll(() => v.messages.length).toBe(1);
    expect(finishCalls(v)).toHaveLength(1);
    expect(v.messages[0]).toContain('Full body A');
  });

  it('says "No new bests this time." when the summary has no record', async () => {
    const { card } = await onFinish(allClosed(), { tools: finishWith(false) });
    await btn(card, 'Finish and send to Claude').click();
    await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
    await pwExpect(card).toContainText('No new bests this time.');
    await pwExpect(card.getByRole('heading', { name: 'New best' })).toHaveCount(0);
  });

  it('ending early confirms first, then finishes once', async () => {
    const { v, card } = await onFinish(oneOpen(), { tools: finishWith(false) });
    await btn(card, 'Finish early').click();
    await wait(LOCK);
    await btn(card, 'End and send to Claude').click();
    await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
    await pwExpect(card).toContainText('Skipped');
    await pwExpect(card).toContainText('Not done');
    await expect.poll(() => v.messages.length).toBe(1);
    expect(finishCalls(v)).toHaveLength(1);
  });

  it('when finish_workout fails the card still shows a summary from the plan, says so, and still sends', async () => {
    const { v, card } = await onFinish(allClosed(), { finish: 'error' });
    await btn(card, 'Finish and send to Claude').click();
    await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
    await pwExpect(card).toContainText('Could not load the full summary.');
    await pwExpect(card).toContainText('Squat');
    await expect.poll(() => v.messages.length).toBe(1);
  });

  it('retries unsaved changes before finishing, and says so in the message when they still fail', async () => {
    const p = plan([ex('Squat', [set('1')])]);
    const { v } = await onFinish(p, { tools: (name) => (name === 'log_set' ? { content: [{ type: 'text', text: 'no' }], isError: true } : name === 'finish_workout' ? finishWith(false)(name) : undefined) });
    await jumpTo(v, 1);
    await wait(LOCK);
    await btn(cardsOf(v).nth(1), 'Log set').click();
    await expect.poll(() => v.calls.filter((c) => c.name === 'log_set').length).toBeGreaterThan(0);
    await jumpTo(v, total(p) - 1);
    await wait(LOCK);
    await btn(finishCard(v), 'Finish and send to Claude').click();
    await expect.poll(() => v.messages.length).toBe(1);
    expect(v.messages[0]).toMatch(/1 change was not saved to Fitwell\./);
    expect(v.calls.filter((c) => c.name === 'log_set').length).toBeGreaterThan(1);
  });
});

describe('Specs: Finish card rule 4, send failure (P8.4; FR14, AC21)', () => {
  it('keeps the summary, says the workout is saved, and Send again only resends the message', async () => {
    let fail = true;
    const { v, card } = await onFinish(allClosed(), { tools: finishWith(false), messageFails: () => fail });
    await btn(card, 'Finish and send to Claude').click();
    await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
    await pwExpect(card).toContainText('Could not send to Claude.');
    await pwExpect(card).toContainText('Your workout is saved.');
    await pwExpect(btn(card, 'Send again')).toBeVisible();
    expect(v.messages).toHaveLength(1);
    fail = false;
    await btn(card, 'Send again').click();
    await expect.poll(() => v.messages.length).toBe(2);
    await pwExpect(card).toContainText('Sent to Claude. It will reply below.');
    expect(finishCalls(v)).toHaveLength(1);
  });
});

describe('Specs: Opening and resume rule 4, a finished workout (P8.5; FR2, AC12)', () => {
  it('opens on Finish, refetches the summary once and sends nothing to Claude', async () => {
    const p = plan([ex('Squat', [closed('1'), closed('2')])], [], { finished: true });
    const v = await openView(p, { tools: finishWith(true) });
    await expect.poll(() => counterText(v)).toBe(`${total(p)} / ${total(p)}`);
    const card = finishCard(v);
    await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
    await pwExpect(card.getByRole('heading', { name: 'New best' })).toBeVisible();
    await wait(LOCK);
    expect(finishCalls(v)).toHaveLength(1);
    expect(v.messages).toHaveLength(0);
  });

  it('a failed refetch shows the stored sets with "Could not load the full summary. Try again" and no records; Try again asks again', async () => {
    const p = plan([ex('Squat', [closed('1', { weightKg: 80 }), closed('2', { weightKg: 80 })])], [], { finished: true });
    let fails = true;
    const v = await openView(p, { tools: (name) => (name === 'finish_workout' && fails ? { content: [{ type: 'text', text: 'no' }], isError: true } : finishWith(true)(name)) });
    const card = finishCard(v);
    await expect.poll(() => counterText(v)).toBe(`${total(p)} / ${total(p)}`);
    await pwExpect(card).toContainText('Could not load the full summary. Try again');
    await pwExpect(card).toContainText('Squat');
    await pwExpect(card.getByRole('heading', { name: 'New best' })).toHaveCount(0);
    await wait(LOCK);
    fails = false;
    await btn(card, 'Try again').click();
    await pwExpect(card.getByRole('heading', { name: 'New best' })).toBeVisible();
    expect(v.messages).toHaveLength(0);
    expect(finishCalls(v)).toHaveLength(2);
  });

  it('a workout whose steps are all closed but not finished is not finished by opening it', async () => {
    const v = await openView(allClosed(), { tools: finishWith(false) });
    await expect.poll(() => counterText(v)).toBe('3 / 3');
    await wait(LOCK);
    expect(finishCalls(v)).toHaveLength(0);
    expect(v.messages).toHaveLength(0);
    await pwExpect(btn(finishCard(v), 'Finish and send to Claude')).toBeVisible();
  });
});

describe('Specs: Finish card rule 5, read-only after finish (P8.6; FR17, AC16)', () => {
  it('shows no stepper, Log, Skip, Swap, Edit, note editor or rest control on any card, and every card stays swipeable', async () => {
    const p = plan([ex('Squat', [closed('1'), closed('2')]), ex('Bench Press', [closed('1'), skipped('2')])], [cardio('c1', 'after', { done: true, minutes: 10 })], { finished: true });
    const v = await openView(p, { tools: finishWith(false) });
    for (let k = 1; k < total(p) - 1; k++) {
      await jumpTo(v, k);
      await expect.poll(() => counterText(v)).toBe(`${k + 1} / ${total(p)}`);
      const card = cardsOf(v).nth(k);
      for (const name of [/^Log set/, /^Skip set/, /^Swap$/, /^Edit/, /^Note$/, /^Edit note$/, /^Log cardio/, /^Skip this/, /^Increase /, /^Skip rest/, /^Save changes/]) {
        await pwExpect(card.getByRole('button', { name })).toHaveCount(0);
      }
    }
    await jumpTo(v, 0);
    await expect.poll(() => counterText(v)).toBe(`1 / ${total(p)}`);
  });
});

describe('Specs: Honest saving (P8.7; FR16, AC9)', () => {
  it('shows "1 change not saved. Try again." only while a save is failing, and Try again clears it once it works', async () => {
    let fail = true;
    const p = plan([ex('Squat', [set('1'), set('2')])]);
    const v = await openView(p, { tools: (name) => (name === 'log_set' && fail ? { content: [{ type: 'text', text: 'no' }], isError: true } : undefined) });
    await jumpTo(v, 1);
    await expect.poll(() => counterText(v)).toBe(`2 / ${total(p)}`);
    await wait(LOCK);
    await pwExpect(v.frame.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await btn(cardsOf(v).nth(1), 'Log set').click();
    await pwExpect(v.frame.getByText(/1 change not saved\./).first()).toBeVisible();
    fail = false;
    await v.frame.getByRole('button', { name: 'Try again' }).click();
    await pwExpect(v.frame.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  it('a set logged while another save is in flight is saved without another tap', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const p = plan([ex('Squat', [set('1'), set('2'), set('3')], { restSec: 0 })]);
    const seen: string[] = [];
    const v = await openView(p, {
      tools: (name, args) => {
        if (name === 'log_set') seen.push(String(args.setId));
        return undefined;
      },
    });
    release();
    await gate;
    await jumpTo(v, 1);
    await wait(LOCK);
    const card = cardsOf(v).nth(1);
    await btn(card, 'Log set').click();
    await wait(LOCK);
    await btn(card, 'Log set').click();
    await expect.poll(() => seen).toEqual(['1', '2']);
  });
});

describe('Specs: Progress sharing and finish message (P8.8; FR21, AC22)', () => {
  it('shares the progress after every log, skip and edit, and re-open', async () => {
    const p = plan([ex('Squat', [set('1'), set('2'), set('3')], { restSec: 0 })]);
    const v = await openView(p);
    await jumpTo(v, 1);
    await expect.poll(() => counterText(v)).toBe(`2 / ${total(p)}`);
    await wait(LOCK);
    const card = cardsOf(v).nth(1);
    await btn(card, 'Log set').click();
    await expect.poll(() => v.contexts.length).toBe(1);
    expect(v.contexts[0]).toMatch(/^Workout in progress\. Full body A/);
    await wait(LOCK);
    await btn(card, 'Skip set').click();
    await expect.poll(() => v.contexts.length).toBe(2);
    await wait(LOCK);
    await card.locator('[data-set-id="1"]').click();
    await btn(card, 'Save changes').click();
    await expect.poll(() => v.contexts.length).toBe(3);
  });

  it('the message to Claude carries the summary and the record', async () => {
    const { v, card } = await onFinish(allClosed(), { tools: finishWith(true) });
    await btn(card, 'Finish and send to Claude').click();
    await expect.poll(() => v.messages.length).toBe(1);
    expect(v.messages[0]).toContain('I finished my workout "Full body A" in 34 min (volume 5120 kg)');
    expect(v.messages[0]).toContain('Personal records: Squat: ');
  });
});
