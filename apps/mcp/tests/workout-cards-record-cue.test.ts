// The live record cue after a logged working set (Specs: Record cue). It must agree with the finish summary's "New best":
// it speaks only for a set whose estimated 1RM beats every earlier session and every set already logged in this workout.
import type { Locator } from 'playwright';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { recordCue } from '../ui/workout/cards';
import { cardsOf, closed, closeBrowser, closeOpened, counterText, ex, jumpTo, launchBrowser, openView, plan, set, settled, type Opened } from './support/workoutHost';
import type { ExerciseBests, PlannedExercise } from '../src/workout/plan';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

// Earlier sessions: 5 × 100 kg and 3 × 105 kg. Best estimate 100 × (1 + 5/30) = 116.67 kg.
const BESTS: ExerciseBests = { e1rm: 100 * (1 + 5 / 30), byReps: [[3, 105], [5, 100]], atWeight: [[105, 3], [100, 5]] };
const squat = (o: Partial<PlannedExercise> = {}) => ex('Squat', [set('1', { weightKg: 100 }), set('2', { weightKg: 100 }), set('3', { weightKg: 100 })], { bests: BESTS, ...o });
const btn = (card: Locator, name: string | RegExp) => card.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });
const cueOf = (card: Locator) => card.locator('[data-cue]');

async function onCard(e: PlannedExercise) {
  const v = await openView(plan([e]));
  await jumpTo(v, 1);
  await expect.poll(() => counterText(v)).toBe('2 of 3');
  await settled(v);
  return { v, card: cardsOf(v).nth(1) };
}
/** Sets the reps and weight with the steppers' own buttons, logs, and waits out the lock. */
async function logAs(v: Opened, card: Locator, reps: number, weight = 100) {
  const label = async (what: 'Reps' | 'Weight kg') => Number.parseFloat(((await card.getByRole('button', { name: new RegExp(`^${what}: `) }).first().getAttribute('aria-label')) ?? '').slice(what.length + 2));
  while ((await label('Reps')) < reps) await btn(card, /^Increase reps/i).click();
  while ((await label('Reps')) > reps) await btn(card, /^Decrease reps/i).click();
  while ((await label('Weight kg')) < weight) await btn(card, /^Increase weight/i).click();
  await btn(card, 'Log set').click();
  await v.page.waitForTimeout(700);
}

describe('recordCue (the comparison)', () => {
  const e = (sets = [set('1', { weightKg: 100 })], o: Partial<PlannedExercise> = {}) => ex('Squat', sets, { bests: BESTS, ...o });
  const cue = (reps: number, weightKg: number, others: ReturnType<typeof closed>[] = []) => {
    const mine = closed('x', { reps, weightKg });
    return recordCue(e([...others, mine]), mine);
  };

  it('names the kind of best: heaviest for the rep count, most reps at the weight, else the estimate', () => {
    expect(cue(5, 105)).toBe('Heaviest 5-rep set');
    expect(cue(6, 100)).toBe('Most reps at 100 kg');
    expect(cue(8, 95)).toBe('Estimated 1RM 120.3 kg'); // 95 × (1 + 8/30)
  });

  it('is silent for a tie, a lower set and a set the estimate does not cover (over 12 reps)', () => {
    expect(cue(5, 100)).toBeNull();
    expect(cue(4, 100)).toBeNull();
    expect(cue(3, 105)).toBeNull(); // 115.5 < 116.67
    expect(cue(15, 100)).toBeNull();
  });

  it('counts the sets already logged in this workout, so a repeat of the new best is not a second record', () => {
    expect(cue(6, 100, [closed('a', { reps: 6, weightKg: 100 })])).toBeNull();
    expect(cue(7, 100, [closed('a', { reps: 6, weightKg: 100 })])).toBe('Most reps at 100 kg');
  });

  it('is silent for warm-ups, bodyweight, timed, no earlier sessions and unlogged sets', () => {
    const warm = closed('w', { reps: 10, weightKg: 100, warmup: true });
    expect(recordCue(e([warm]), warm)).toBeNull();
    const mine = closed('x', { reps: 10, weightKg: 100 });
    expect(recordCue(e([mine], { bodyweight: true }), mine)).toBeNull();
    expect(recordCue(e([mine], { timed: true }), mine)).toBeNull();
    expect(recordCue(e([mine], { bests: undefined }), mine)).toBeNull();
    const open = set('o', { weightKg: 100 });
    expect(recordCue(e([open]), open)).toBeNull();
  });
});

describe('Specs: Record cue in the player', () => {
  it('shows a short text cue under the set list and announces it once with the log, for a beaten best', async () => {
    const { v, card } = await onCard(squat());
    await logAs(v, card, 6);
    await pwExpect(cueOf(card)).toHaveText('New best: Most reps at 100 kg');
    await pwExpect(v.frame.getByRole('status')).toHaveText(/^Logged 6 × 100 kg\. New best: Most reps at 100 kg\./);
  });

  it('shows nothing for a tie or a lower set', async () => {
    const { v, card } = await onCard(squat());
    await logAs(v, card, 5);
    await btn(card, 'Skip rest').click();
    await v.page.waitForTimeout(700);
    await pwExpect(cueOf(card)).toHaveCount(0);
    await logAs(v, card, 4);
    await pwExpect(cueOf(card)).toHaveCount(0);
    await pwExpect(v.frame.getByRole('status')).not.toContainText('New best');
  });

  it('shows nothing for a warm-up, even a heavy one', async () => {
    const e = ex('Squat', [set('w1', { warmup: true, weightKg: 100, targetReps: 5 }), set('1', { weightKg: 100 })], { bests: BESTS });
    const { v, card } = await onCard(e);
    await logAs(v, card, 9);
    await pwExpect(cueOf(card)).toHaveCount(0);
  });

  it('shows nothing without bests to compare with (bodyweight, first time)', async () => {
    const { v, card } = await onCard(squat({ bests: undefined }));
    await logAs(v, card, 12);
    await pwExpect(cueOf(card)).toHaveCount(0);
  });

  it('the cue goes when the next set is logged without a new best', async () => {
    const { v, card } = await onCard(squat());
    await logAs(v, card, 6);
    await pwExpect(cueOf(card)).toHaveCount(1);
    await btn(card, 'Skip rest').click();
    await v.page.waitForTimeout(700);
    await logAs(v, card, 6); // equal to the one just logged
    await pwExpect(cueOf(card)).toHaveCount(0);
  });
});
