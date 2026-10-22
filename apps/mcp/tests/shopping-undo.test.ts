// Clear ticks can be undone for a few seconds: the built shopping view in a real Chromium, with a host that records the saves.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShoppingData } from '../src/planning/shoppingTypes';
import viewHtml from '../src/ui/generated/shopping';
import { closeAll, launch, openView } from './support/viewHost';

beforeAll(launch, 60_000);
afterAll(closeAll);

const data = (): ShoppingData => ({
  weekStart: '2026-10-19',
  people: 1,
  meals: 3,
  itemCount: 3,
  leftToBuy: 1,
  leftOut: [],
  notes: [],
  sections: [{ aisle: 'Bakery', items: [
    { key: 'frida:413', name: 'Rye bread', grams: 400, buy: '1 loaf', usedIn: [], checked: true },
    { key: 'frida:754', name: 'Oats', grams: 300, buy: '500 g', usedIn: [], checked: true },
    { key: 'frida:1', name: 'Butter', grams: 100, buy: '250 g', usedIn: [], checked: false },
  ] }],
});
const ok = { content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true } };
const open = (tools: (n: string, a: Record<string, unknown>) => unknown = () => ok) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { shopping: data() } }, { tools });

describe('undo after Clear ticks', () => {
  it('shows "Ticks cleared. Undo" with a 44 px button, announces once, and restores and re-saves the ticks', async () => {
    const v = await open();
    const f = v.frame;
    await f.getByRole('button', { name: 'Clear ticks' }).click();
    await pwExpect(f.getByText('Ticks cleared.', { exact: true })).toBeVisible();
    await pwExpect(f.getByRole('checkbox', { checked: true })).toHaveCount(0);
    const undo = f.getByRole('button', { name: 'Undo' });
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pwExpect(f.locator('#notice')).toHaveText('Ticks cleared. Undo is available for a few seconds.');
    await pwExpect(f.locator('#notice')).toHaveAttribute('role', 'status');
    await pwExpect(f.locator('#app #undo')).toHaveCount(0); // the bar is outside the list's live region
    expect(v.calls).toEqual([{ name: 'set_grocery_checked', args: { week_start: '2026-10-19', clear: true } }]);

    await undo.click();
    await pwExpect(f.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await pwExpect(f.getByText('Ticks cleared.', { exact: true })).toBeHidden();
    await pwExpect(f.getByText('2 left')).toBeHidden();
    await pwExpect(f.getByText('1 left')).toBeVisible();
    const saves = v.calls.slice(1);
    expect(saves.map((c) => [c.name, c.args.key, c.args.checked]).sort()).toEqual([['set_grocery_checked', 'frida:413', true], ['set_grocery_checked', 'frida:754', true]]);
    expect(saves.every((c) => c.args.week_start === '2026-10-19')).toBe(true);
  }, 30_000);

  it('goes away by itself after about 8 seconds', async () => {
    const v = await open();
    await v.frame.getByRole('button', { name: 'Clear ticks' }).click();
    await pwExpect(v.frame.getByText('Ticks cleared.', { exact: true })).toBeVisible();
    await pwExpect(v.frame.getByRole('button', { name: 'Undo' })).toBeHidden({ timeout: 12_000 });
    await pwExpect(v.frame.locator('#notice')).toHaveText('');
    expect(v.calls).toHaveLength(1); // nothing re-saved
  }, 30_000);

  it('offers no undo when clearing fails, and puts the ticks back when restoring fails', async () => {
    const failing = await open(() => ({ isError: true, content: [{ type: 'text', text: 'no' }] }));
    await failing.frame.getByRole('button', { name: 'Clear ticks' }).click();
    await pwExpect(failing.frame.getByText('Could not clear the ticks. Try again.')).toBeVisible();
    await pwExpect(failing.frame.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await pwExpect(failing.frame.getByRole('checkbox', { checked: true })).toHaveCount(2);

    let first = true;
    const v = await open(() => { if (first) { first = false; return ok; } return { isError: true, content: [{ type: 'text', text: 'no' }] }; });
    await v.frame.getByRole('button', { name: 'Clear ticks' }).click();
    await v.frame.getByRole('button', { name: 'Undo' }).click();
    await pwExpect(v.frame.getByText('Could not restore the ticks. Try again.')).toBeVisible();
    await pwExpect(v.frame.getByRole('checkbox', { checked: true })).toHaveCount(0);
  }, 30_000);
});
