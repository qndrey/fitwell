// "Show me my last workout report": Claude calls finish_workout on a finished workout, so the player's first tool result is the
// summary (it names the workout but is not a plan). The player must open that workout on its report, not wait forever.
// The built view runs in a real Chromium inside an iframe and the test page plays the MCP Apps host (tests/support/workoutHost.ts).
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cardsOf, closed, closeBrowser, closeOpened, ex, launchBrowser, openView, plan } from './support/workoutHost';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const summary = (workoutId?: string) => ({
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { ...(workoutId ? { workoutId } : {}), name: 'Surf - Push & Power', day: '2026-10-25', minutes: 67, volumeKg: 5127, exercises: [{ name: 'Squat', done: '2 sets: 5 × 80 kg' }] },
});
const stored = () => plan([ex('Squat', [closed('1', { weightKg: 80 }), closed('2', { weightKg: 80 })])], [], { workoutId: 'w-done', name: 'Surf - Push & Power', finished: true });

describe('the report of a finished workout, shown from finish_workout', () => {
  it('opens the stored workout on its report instead of waiting for a plan', async () => {
    const v = await openView(stored(), { initial: summary('w-done') });
    const card = cardsOf(v).last();
    await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
    await pwExpect(card).toContainText('2 working sets');
    await pwExpect(v.frame.getByText('Waiting for the workout…')).toHaveCount(0);
    expect(v.calls.find((c) => c.name === 'get_workout')?.args).toEqual({ workoutId: 'w-done' });
    // Looking at an old report tells Claude nothing new.
    expect(v.messages).toHaveLength(0);
  });

  it('says so when the workout cannot be loaded, rather than waiting forever', async () => {
    const v = await openView(stored(), { initial: summary('w-done'), tools: (name) => (name === 'get_workout' ? { content: [{ type: 'text', text: 'No such workout.' }], isError: true } : undefined) });
    await pwExpect(v.frame.getByText('The workout report could not be loaded.')).toBeVisible();
    await pwExpect(v.frame.getByText('Waiting for the workout…')).toHaveCount(0);
  });

  it('says so for a result that is neither a plan nor a report', async () => {
    const v = await openView(stored(), { initial: summary() });
    await pwExpect(v.frame.getByText('This workout could not be shown.')).toBeVisible();
    await pwExpect(v.frame.getByText('Waiting for the workout…')).toHaveCount(0);
  });
});
