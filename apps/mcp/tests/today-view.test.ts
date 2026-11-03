// The Today view in Chromium: what it shows, and that each tap asks the server and shows the fresh day it answers with.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TodayView } from '../src/analytics/todayTypes';
import todayHtml from '../src/ui/generated/today';
import { closeAll, launch, openView } from './support/viewHost';

const today: TodayView = {
  day: '2026-11-03', slot: 'dinner',
  goals: { kcal: 2300, proteinG: 150 },
  eaten: { kcal: 1480, protein: 92.5, carbs: 160, fat: 48 },
  remaining: { kcal: 820, protein: 57.5 },
  planned: [
    { slot: 'breakfast', items: [{ name: 'Oats with milk', kcal: 420, logged: true }], kcal: 420, allLogged: true },
    { slot: 'dinner', items: [{ name: 'Chicken and rice', kcal: 640, logged: false }, { name: 'Broccoli', kcal: 60, logged: false }], kcal: 700, allLogged: false },
  ],
  quickAdd: [
    { entryId: 'e1', name: 'Skyr, plain', grams: 200, kcal: 130, protein: 22, estimated: false },
    { entryId: 'e2', name: 'Banana', grams: 118, kcal: 105, protein: 1.3, estimated: true },
  ],
  waterMl: 750, steps: 8200,
  training: { doneToday: [{ name: 'Push day', type: 'strength', minutes: 52 }], suggested: { name: 'Leg day', daysSince: 9 } },
};
const result = (t: TodayView) => ({ content: [{ type: 'text', text: 'open' }], structuredContent: { today: t } });
const answer = (t: TodayView) => () => ({ content: [{ type: 'text', text: 'Done.' }], structuredContent: { today: t } });

describe('the Today view', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);

  it('shows what is left, planned meals, foods to log again, water and steps, and training', async () => {
    const v = await openView(todayHtml, result(today));
    await pwExpect(v.frame.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await pwExpect(v.frame.getByText('820 kcal')).toBeVisible();
    await pwExpect(v.frame.getByText('left of 2,300')).toBeVisible();
    await pwExpect(v.frame.getByText('57.5 g protein to go')).toBeVisible();
    await pwExpect(v.frame.getByText('Oats with milk · 420 kcal')).toBeVisible();
    await pwExpect(v.frame.getByText('✓ Logged')).toBeVisible();
    await pwExpect(v.frame.getByText('Chicken and rice, Broccoli · 700 kcal')).toBeVisible();
    await pwExpect(v.frame.getByText('200 g · 130 kcal · 22 g protein')).toBeVisible();
    await pwExpect(v.frame.getByText('~118 g · 105 kcal')).toBeVisible(); // an estimate is marked
    await pwExpect(v.frame.getByText(/750 ml/)).toBeVisible();
    await pwExpect(v.frame.getByText(/8,200/)).toBeVisible();
    await pwExpect(v.frame.getByText('Push day')).toBeVisible();
    await pwExpect(v.frame.getByText(/Suggested: Leg day, 9 days since you did it/)).toBeVisible();
    await pwExpect(v.frame.getByText(/adds go to dinner/)).toBeVisible();
  }, 30_000);

  it('one tap logs a planned meal and shows the fresh day', async () => {
    const after: TodayView = { ...today, eaten: { ...today.eaten, kcal: 2180 }, remaining: { kcal: 120, protein: 20 }, planned: [today.planned[0]!, { ...today.planned[1]!, allLogged: true, items: today.planned[1]!.items.map((i) => ({ ...i, logged: true })) }] };
    const v = await openView(todayHtml, result(today), { tools: (name) => (name === 'today_eat_planned' ? answer(after)() : undefined) });
    await v.frame.getByRole('button', { name: 'Log dinner as eaten' }).click();
    await pwExpect(v.frame.getByText('120 kcal')).toBeVisible();
    expect(v.calls).toEqual([{ name: 'today_eat_planned', args: { slot: 'dinner' } }]);
    await pwExpect(v.frame.getByRole('button', { name: 'Log dinner as eaten' })).toHaveCount(0);
  }, 30_000);

  it('a food to log again and a glass of water each call their tool with what was tapped', async () => {
    const v = await openView(todayHtml, result(today), { tools: (name) => answer({ ...today, waterMl: name === 'today_add_water' ? 1000 : 750 })() });
    await v.frame.getByRole('button', { name: 'Log Skyr, plain again' }).click();
    await v.frame.getByRole('button', { name: 'Add 250 millilitres of water' }).click();
    await pwExpect(v.frame.getByText(/1,000 ml/)).toBeVisible();
    expect(v.calls).toEqual([{ name: 'today_quick_add', args: { entry_id: 'e1' } }, { name: 'today_add_water', args: { ml: 250 } }]);
  }, 30_000);

  it('shows the reason when a tap is refused, and keeps the day as it was', async () => {
    const v = await openView(todayHtml, result(today), { tools: () => ({ isError: true, content: [{ type: 'text', text: 'Banana matches an allergy on the profile, so it is not logged in one tap.' }] }) });
    await v.frame.getByRole('button', { name: 'Log Banana again' }).click();
    await pwExpect(v.frame.getByText(/matches an allergy/)).toBeVisible();
    await pwExpect(v.frame.getByText('820 kcal')).toBeVisible();
  }, 30_000);

  it('shows over the goal plainly, and how to get goals when there are none, with nothing planned or to log again', async () => {
    const over = await openView(todayHtml, result({ ...today, eaten: { ...today.eaten, kcal: 2500 }, remaining: { kcal: -200, protein: -5 } }));
    await pwExpect(over.frame.getByText('200 kcal over')).toBeVisible();
    await pwExpect(over.frame.getByText('5 g protein over the goal')).toBeVisible();
    const empty = await openView(todayHtml, result({ ...today, goals: { kcal: null, proteinG: null }, remaining: { kcal: null, protein: null }, planned: [], quickAdd: [], training: { doneToday: [], suggested: null }, steps: null }));
    await pwExpect(empty.frame.getByText(/Ask Claude to set calorie goals/)).toBeVisible();
    await pwExpect(empty.frame.getByText('Nothing logged today yet.')).toBeVisible();
    await pwExpect(empty.frame.getByRole('heading', { name: 'Planned' })).toHaveCount(0);
    await pwExpect(empty.frame.getByRole('heading', { name: 'Log again' })).toHaveCount(0);
  }, 30_000);

  it('asks Claude to start the suggested workout through the chat, not by itself', async () => {
    const v = await openView(todayHtml, result(today));
    await pwExpect(v.frame.getByRole('button', { name: 'Ask Claude to start Leg day' })).toBeVisible();
    expect(v.calls).toEqual([]);
  }, 30_000);
});
