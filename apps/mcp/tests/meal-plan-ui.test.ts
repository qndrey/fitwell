// The meal plan view in Chromium: what it shows, and that each tap sends the plan's version and the meal's place and shows the fresh week the server answers with.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MealPlanView, PlanDay } from '../src/analytics/mealPlanTypes';
import mealplanHtml from '../src/ui/generated/mealplan';
import { closeAll, launch, openView } from './support/viewHost';

const empty = (day: string, weekday: string): PlanDay => ({ day, weekday, past: false, meals: [], totals: null, status: { kcal: null, protein: null }, vsGoal: { kcal: null, protein: null } });
const plan: MealPlanView = {
  weekStart: '2026-11-02', today: '2026-11-03', version: 7,
  goals: { kcal: 2300, proteinG: 150 },
  days: [
    { day: '2026-11-02', weekday: 'Mon', past: true, meals: [{ index: 0, slot: 'dinner', name: 'Salmon with potatoes', kind: 'food', servings: null, kcal: 860, protein: 48, logged: true }], totals: { kcal: 860, protein: 48 }, status: { kcal: 'low', protein: 'short' }, vsGoal: { kcal: -1440, protein: -102 } },
    { day: '2026-11-03', weekday: 'Tue', past: false, meals: [{ index: 1, slot: 'lunch', name: 'Chicken and rice', kind: 'recipe', servings: 2, kcal: 1480, protein: 104, logged: false }, { index: 2, slot: 'dinner', name: 'Lentil stew', kind: 'food', servings: null, kcal: 810, protein: 41, logged: false }], totals: { kcal: 2290, protein: 145 }, status: { kcal: 'ok', protein: 'ok' }, vsGoal: { kcal: -10, protein: -5 } },
    { day: '2026-11-04', weekday: 'Wed', past: false, meals: [{ index: 3, slot: 'lunch', name: 'Rye toast', kind: 'food', servings: null, kcal: 300, protein: 9, logged: false }], totals: { kcal: 300, protein: 9 }, status: { kcal: 'low', protein: 'short' }, vsGoal: { kcal: -2000, protein: -141 } },
    ...[['2026-11-05', 'Thu'], ['2026-11-06', 'Fri'], ['2026-11-07', 'Sat'], ['2026-11-08', 'Sun']].map(([d, w]) => empty(d!, w!)),
  ],
  warnings: ['ALLERGY: Rye toast (Wed lunch) contains rye.'], problems: [],
  recipes: [{ id: 'r1', name: 'Porridge', kcalPerServing: 380 }],
};
const result = (p: MealPlanView) => ({ content: [{ type: 'text', text: 'open' }], structuredContent: { mealPlan: p } });
const refused = { isError: true, content: [{ type: 'text', text: 'The plan changed since this view was opened. Open it again.' }] };

describe('the meal plan view', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);

  it('shows the week with goals, meals, totals against the goal, eaten marks and the allergy warning', async () => {
    const v = await openView(mealplanHtml, result(plan));
    await pwExpect(v.frame.getByRole('heading', { name: 'Meal plan', exact: true })).toBeVisible();
    await pwExpect(v.frame.getByText(/goal 2,300 kcal · 150 g protein a day/)).toBeVisible();
    await pwExpect(v.frame.getByText('Dinner: Salmon with potatoes')).toBeVisible();
    await pwExpect(v.frame.getByText('✓ Eaten')).toBeVisible(); // Monday's only
    await pwExpect(v.frame.getByText('Lunch: Chicken and rice (2 servings)')).toBeVisible();
    await pwExpect(v.frame.getByText('2,290 kcal · 145 g protein')).toBeVisible();
    await pwExpect(v.frame.getByText('on the calorie goal · protein on goal')).toBeVisible();
    await pwExpect(v.frame.getByRole('alert').getByText(/ALLERGY: Rye toast/)).toBeVisible();
    await pwExpect(v.frame.getByText('Nothing planned')).toHaveCount(4);
    await pwExpect(v.frame.getByRole('button', { name: 'Log Rye toast as eaten' })).toHaveCount(0); // Wednesday is ahead
  }, 30_000);

  it('eaten, swap and repeat each call their tool with the version and the place that was tapped, and show the fresh week', async () => {
    const after: MealPlanView = { ...plan, version: 8, warnings: [], days: plan.days.map((d) => (d.day === '2026-11-03' ? { ...d, meals: d.meals.map((m) => (m.index === 2 ? { ...m, name: 'Porridge', logged: false } : m)) } : d)) };
    const v = await openView(mealplanHtml, result(plan), { tools: () => ({ content: [{ type: 'text', text: 'Done.' }], structuredContent: { mealPlan: after } }) });
    await v.frame.getByRole('button', { name: 'Change Lentil stew' }).click();
    await v.frame.getByRole('button', { name: 'Swap Lentil stew for Porridge' }).click();
    await pwExpect(v.frame.getByText('Dinner: Porridge')).toBeVisible();
    await pwExpect(v.frame.getByText(/ALLERGY/)).toHaveCount(0);
    expect(v.calls).toEqual([{ name: 'plan_swap_recipe', args: { week_start: '2026-11-02', version: 7, index: 2, recipe_id: 'r1' } }]);
    await v.frame.getByRole('button', { name: 'Log Chicken and rice as eaten' }).click();
    expect(v.calls[1]).toEqual({ name: 'plan_eat_meal', args: { week_start: '2026-11-02', version: 8, index: 1 } }); // the version of the fresh week
    await v.frame.getByRole('button', { name: 'Repeat Tue on another day' }).click();
    await v.frame.getByRole('button', { name: 'Make Thu the same as Tue' }).click();
    expect(v.calls[2]).toMatchObject({ name: 'plan_repeat_day', args: { from_day: '2026-11-03', to_day: '2026-11-05' } });
  }, 30_000);

  it('only copies a meal of the same kind, and a day with an eaten meal cannot be replaced', async () => {
    const v = await openView(mealplanHtml, result(plan));
    await v.frame.getByRole('button', { name: 'Change Chicken and rice' }).click();
    await pwExpect(v.frame.getByRole('button', { name: /^Copy .*\(Rye toast\)/ })).toHaveCount(1); // lunch of Wednesday
    await pwExpect(v.frame.getByRole('button', { name: /Copy .*Lentil stew/ })).toHaveCount(0);
    await v.frame.getByRole('button', { name: 'Repeat Tue on another day' }).click();
    await pwExpect(v.frame.getByRole('button', { name: 'Make Mon the same as Tue' })).toBeDisabled();
  }, 30_000);

  it('shows a refusal and reads the plan again, so a stale window catches up', async () => {
    const fresher: MealPlanView = { ...plan, version: 9, warnings: [] };
    const v = await openView(mealplanHtml, result(plan), { tools: (name) => (name === 'get_meal_plan_data' ? { content: [{ type: 'text', text: 'Done.' }], structuredContent: { mealPlan: fresher } } : refused) });
    await v.frame.getByRole('button', { name: 'Log Chicken and rice as eaten' }).click();
    await pwExpect(v.frame.getByRole('alert').getByText(/changed since this view was opened/)).toBeVisible();
    await pwExpect(v.frame.getByText(/ALLERGY/)).toHaveCount(0); // the fresh week is shown
    expect(v.calls.map((c) => c.name)).toEqual(['plan_eat_meal', 'get_meal_plan_data']);
  }, 30_000);
});
