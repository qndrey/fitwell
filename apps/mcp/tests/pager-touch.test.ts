// The dashboard's card shell on a touch screen (ui/shared/cardPager.ts, ui/shared/swipe.ts): the track is not a native scroller and
// a fixed card pans only up and down, so a vertical swipe on a card scrolls the card or the chat around the view, and a sideways one
// still moves to the next card.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Progress } from '../src/analytics/types';
import viewHtml from '../src/ui/generated/dashboard';
import { createTestEnv } from './support/env';
import { call, connectAs, signedInUser } from './support/mcp';
import { closeAll, launch, openView, type OpenedView } from './support/viewHost';

interface Dom {
  window: { scrollY: number };
  getComputedStyle(node: unknown): Record<string, string>;
}

let client: Client;
beforeAll(launch, 60_000);
afterAll(closeAll);
beforeEach(async () => {
  const env = createTestEnv().env;
  client = await connectAs(env, await signedInUser(env, 'ana@example.com'));
});

const openDashboard = async () => {
  const progress = ((await call(client, 'get_dashboard_data', { days: 90 })).data as unknown as { progress: Progress }).progress;
  const v = await openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { progress } }, { touch: true });
  await track(v).waitFor();
  return v;
};
const track = (v: OpenedView) => v.frame.locator('[aria-roledescription="carousel"]');
const counter = async (v: OpenedView) => (await v.frame.locator('.counter').textContent())?.trim();

/** One finger from `from` to `to` in page coordinates, in small steps, through Chromium's touch input pipeline. */
async function drag(v: OpenedView, from: [number, number], to: [number, number]) {
  const cdp = await v.context.newCDPSession(v.page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + ((to[0] - from[0]) * i) / 12, y: from[1] + ((to[1] - from[1]) * i) / 12 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
async function trackBox(v: OpenedView) {
  const box = await track(v).boundingBox();
  if (!box) throw new Error('track not laid out');
  return box;
}

describe('dashboard cards on a touch screen', () => {
  it('the track is not a horizontal scroller of its own, and the track and a fixed card allow only vertical panning', async () => {
    const v = await openDashboard();
    const css = await track(v).evaluate((el) => {
      const g = (globalThis as unknown as Dom).getComputedStyle;
      const s = g(el);
      return { ox: s.overflowX, touch: s.touchAction, snap: s.scrollSnapType, card: g(el.querySelector('.pcard')).touchAction };
    });
    expect(css).toEqual({ ox: 'hidden', touch: 'pan-y', snap: 'none', card: 'pan-y' });
  });

  it('a vertical swipe that starts on a card scrolls the card or the page around the view, and stays on the card', async () => {
    const v = await openDashboard();
    const box = await trackBox(v);
    const x = box.x + box.width / 2;
    const y = Math.min(box.y + box.height * 0.6, 900);
    await drag(v, [x, y], [x, y - 300]);
    const scrolled = async () => (await v.page.evaluate(() => (globalThis as unknown as Dom).window.scrollY)) + (await v.frame.locator('.pcard').first().evaluate((el) => el.scrollTop));
    await pwExpect.poll(scrolled).toBeGreaterThan(50);
    expect(await counter(v)).toMatch(/^1 of /);
  });

  it('a sideways swipe that starts on a fixed card moves to the next card', async () => {
    const v = await openDashboard();
    const box = await trackBox(v);
    const y = box.y + 60;
    await drag(v, [box.x + box.width * 0.8, y], [box.x + box.width * 0.2, y]);
    await pwExpect.poll(() => counter(v)).toMatch(/^2 of /);
    await pwExpect.poll(() => track(v).evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(2);
    await drag(v, [box.x + box.width * 0.2, y], [box.x + box.width * 0.8, y]);
    await pwExpect.poll(() => counter(v)).toMatch(/^1 of /);
  });
});
