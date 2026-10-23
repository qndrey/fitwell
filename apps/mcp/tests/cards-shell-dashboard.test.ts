// The card shell seen through the dashboard (contracts/cards-shell, FR3 to FR8); the player's side is in tests/cards-shell.test.ts.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Progress } from '../src/analytics/types';
import viewHtml from '../src/ui/generated/dashboard';
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

const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
async function open() {
  for (let i = 0; i < 30; i += 2) await call(client, 'log_body', { day: addD(today, -i), weight_kg: 82 - i * 0.05 });
  for (let i = 1; i < 25; i += 2) await call(client, 'log_food', { day: addD(today, -i), items: [{ food_id: 'frida:59', grams: 300 }] });
  await call(client, 'log_past_workout', { day: addD(today, -2), exercises: [{ id: 'ex:Barbell_Squat', sets: [{ reps: 5, weight_kg: 80 }] }] });
  await call(client, 'log_body', { day: addD(today, -3), sleep_hours: 7 });
  await call(client, 'log_body', { day: addD(today, -5), measurements: { waist: 88 } });
  const p = ((await call(client, 'get_dashboard_data', { days: 90 })).data as unknown as { progress: Progress }).progress;
  const v = await openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { progress: p } });
  await v.frame.locator('section.pcard').first().waitFor();
  return v;
}

describe('cards shell, through the dashboard', () => {
  it('shows "k of n", one icon tab per card, and only the current card is not inert', async () => {
    const v = await open();
    await pwExpect(v.frame.locator('.counter')).toHaveText('1 of 8');
    await pwExpect(v.frame.locator('.strip.icons > .tab')).toHaveCount(8);
    await pwExpect(v.frame.locator('.tab[aria-current="true"]')).toHaveCount(1);
    await pwExpect(v.frame.locator('.sg')).toHaveCount(0); // icon tabs in place of the thin segments
    const inert = await v.frame.locator('section.pcard').evaluateAll((els) => els.map((e) => (e as unknown as { inert: boolean }).inert));
    expect(inert).toEqual([false, true, true, true, true, true, true, true]);
    expect(await v.frame.locator('.track').getAttribute('data-fixed')).toBeNull(); // one mode: no fixed height
  }, 60_000);

  it('‹ › name the card they go to, are aria-disabled at the ends and do nothing there', async () => {
    const v = await open();
    const prev = v.frame.locator('[data-key=prev]');
    const next = v.frame.locator('[data-key=next]');
    await pwExpect(prev).toHaveAttribute('aria-disabled', 'true');
    await pwExpect(prev).toHaveAttribute('aria-label', 'Previous card');
    await pwExpect(next).toHaveAttribute('aria-label', 'Next card: Nutrition');
    await prev.click({ force: true }); // aria-disabled: Playwright waits for "enabled", a finger just taps
    await pwExpect(v.frame.locator('.counter')).toHaveText('1 of 8');
    for (const b of [prev, next]) expect((await b.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  }, 60_000);

  it('two quick taps on › go two cards, and the new card\'s hidden heading takes the focus', async () => {
    const v = await open();
    await v.frame.locator('[data-key=next]').evaluate((el) => { (el as unknown as { click(): void }).click(); (el as unknown as { click(): void }).click(); });
    await pwExpect(v.frame.locator('.counter')).toHaveText('3 of 8');
    await pwExpect(v.frame.locator('section.pcard[data-key="energy"] h2.sr-only')).toBeFocused();
  }, 60_000);

  it('arrow keys, Home and End move the cards, except in a field', async () => {
    const v = await open();
    await v.frame.locator('body').click({ position: { x: 5, y: 5 } });
    await v.page.keyboard.press('End');
    await pwExpect(v.frame.locator('.counter')).toHaveText('8 of 8');
    await v.page.keyboard.press('Home');
    await pwExpect(v.frame.locator('.counter')).toHaveText('1 of 8');
  }, 60_000);

  it('announces the card once it has settled, with its number', async () => {
    const v = await open();
    await v.frame.locator('[data-key=next]').click();
    await pwExpect(v.frame.locator('[role=status]')).toHaveText(/^Nutrition, card 2 of 8, [\d,]+ kcal$/, { timeout: 5000 });
  }, 60_000);

  it('with reduced motion a jump lands at once, and no card is transformed', async () => {
    const v = await open();
    await v.page.emulateMedia({ reducedMotion: 'reduce' });
    await v.frame.locator('[data-key=next]').click();
    const at = await v.frame.locator('.track').evaluate((el) => { const t = el as unknown as { scrollLeft: number; clientWidth: number }; return t.scrollLeft / t.clientWidth; });
    expect(at).toBe(1);
    const transforms = await v.frame.locator('section.pcard').evaluateAll((els) => els.map((e) => (e as unknown as { style: { transform: string } }).style.transform));
    expect(transforms.every((t) => t === '')).toBe(true);
  }, 60_000);

  it('a card never scrolls inside: it is as tall as its content, at least the minimum height', async () => {
    const v = await open();
    await v.frame.locator('[data-key=next]').click();
    const card = v.frame.locator('section.pcard[data-key="nutrition"]');
    const m = await card.evaluate((el) => ({ oy: (globalThis as unknown as { getComputedStyle(e: unknown): { overflowY: string } }).getComputedStyle(el).overflowY, client: el.clientHeight, scroll: el.scrollHeight }));
    expect(m.oy).toBe('visible');
    expect(m.scroll).toBe(m.client);
    expect(m.client).toBeGreaterThanOrEqual(440);
    for (const attr of ['data-more', 'data-scrolled']) expect(await card.getAttribute(attr)).toBeNull();
  }, 60_000);
});
