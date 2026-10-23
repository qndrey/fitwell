// The Training notes and Nutrition notes cards in the built review view (contracts/review-notes, FR6, FR7, AC4).
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WeekReview } from '../src/analytics/reviewTypes';
import viewHtml from '../src/ui/generated/review';
import { addDays, mondayOf } from '../ui/review/copy';
import { showCard } from './support/cards';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView } from './support/viewHost';

let client: Client;
beforeAll(launch, 60_000);
afterAll(closeAll);
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const WEEK = addDays(mondayOf(new Date().toISOString().slice(0, 10)), -14);
const review = async (args: Record<string, unknown>) => ((await call(client, 'show_weekly_review', args)).data as unknown as { review: WeekReview }).review;
const open = (r: WeekReview, width = 398) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { review: r } }, { width });

describe('notes cards', () => {
  it('are cards 2 and 3, with the neutral labels, and show Claude\'s text with its provenance', async () => {
    const r = await review({ week_start: WEEK, training_note: 'You trained 3 times, on your goal of 3.', training_next: 'Repeat this rhythm.', nutrition_note: 'Calories averaged about 2,350 a day.', nutrition_next: 'One option is a walk after lunch.' });
    const v = await open(r);
    await v.frame.locator('section.pcard').first().waitFor();
    await pwExpect(v.frame.locator('.strip .sg')).toHaveCount(8);
    const t = await showCard(v, 'training-notes', 'Training notes');
    await pwExpect(v.frame.locator('.labelrow strong')).toHaveText('Training notes');
    await pwExpect(v.frame.locator('.counter')).toHaveText('2 of 8');
    await pwExpect(t.locator('.note')).toHaveText('You trained 3 times, on your goal of 3.');
    await pwExpect(t.locator('.nline', { hasText: 'Next week' })).toContainText('Repeat this rhythm.');
    await pwExpect(t.getByText('Written by Claude from your week')).toBeVisible();
    await pwExpect(t.getByText(/Ask Claude for a written review/)).toHaveCount(0);
    const n = await showCard(v, 'nutrition-notes', 'Nutrition notes');
    await pwExpect(v.frame.locator('.counter')).toHaveText('3 of 8');
    await pwExpect(n.locator('.note')).toHaveText('Calories averaged about 2,350 a day.');
    await pwExpect(n.locator('.nline', { hasText: 'Next week' })).toContainText('One option is a walk after lunch.');
    for (const word of ['Coach', 'Nutritionist']) await pwExpect(v.frame.getByText(word)).toHaveCount(0);
  }, 60_000);

  it('show an automatic summary with its provenance and the ask line when nobody wrote a note; a month says "month" and "Next 4 weeks"', async () => {
    const v = await open(await review({ week_start: WEEK }));
    const t = await showCard(v, 'training-notes', 'Training notes');
    await pwExpect(t.getByText('Auto summary from your logs')).toBeVisible();
    await pwExpect(t.getByText('Ask Claude for a written review of this week.')).toBeVisible();
    await pwExpect(t.locator('.note')).not.toBeEmpty();
    const m = await open(await review({ week_start: WEEK, period: 'month', nutrition_note: 'Month text.' }));
    const n = await showCard(m, 'nutrition-notes', 'Nutrition notes');
    await pwExpect(n.getByText('Written by Claude from your month')).toBeVisible();
    await pwExpect(n.getByText('Next 4 weeks')).toHaveCount(0); // no next line was given
    const t2 = await showCard(m, 'training-notes', 'Training notes');
    await pwExpect(t2.getByText('Ask Claude for a written review of this month.')).toBeVisible();
    await pwExpect(t2.locator('.nline', { hasText: 'Next 4 weeks' })).toBeVisible();
  }, 60_000);

  it('set the text with textContent only, and a very long note scrolls inside the card above the dock', async () => {
    const base = await review({ week_start: WEEK });
    const long = 'A sentence of some length, kept plain. '.repeat(120);
    const r: WeekReview = { ...base, notes: { ...base.notes, training: { text: `<b>bold</b> <img src=x onerror=alert(1)> ${long}`, next: '<i>next</i>', source: 'claude', lowData: false } } };
    const v = await open(r);
    const card = await showCard(v, 'training-notes', 'Training notes');
    await pwExpect(card.locator('b, img, i')).toHaveCount(0);
    await pwExpect(card.locator('.note')).toContainText('<b>bold</b> <img src=x onerror=alert(1)>');
    await pwExpect(card.locator('.nline', { hasText: 'Next week' })).toContainText('<i>next</i>');
    const [client, scroll] = await card.evaluate((el) => [el.clientHeight, el.scrollHeight]);
    expect(scroll).toBeGreaterThan(client!);
    await pwExpect(card).toHaveAttribute('data-more', '');
  }, 60_000);

  it('a 480-character note fits the card without scrolling', async () => {
    const text = `${'You trained three times this week, on your goal. '.repeat(10)}`.slice(0, 480);
    const base = await review({ week_start: WEEK });
    const v = await open({ ...base, notes: { ...base.notes, training: { text, next: 'Repeat this rhythm; add weight on a lift once every set reaches its reps.', source: 'claude', lowData: false } } });
    const card = await showCard(v, 'training-notes', 'Training notes');
    const [client, scroll] = await card.evaluate((el) => [el.clientHeight, el.scrollHeight]);
    expect(scroll).toBeLessThanOrEqual(client!);
  }, 60_000);
});
