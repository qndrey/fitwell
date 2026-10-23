// On a touch screen the card track is not a native scroller (ui/shared/swipe.ts): a vertical swipe that starts on a card
// scrolls the chat around the view, and a sideways one still moves to the next card. The built view runs in a real Chromium
// inside an iframe and the test page plays the MCP Apps host; see tests/support/workoutHost.ts.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser, closeOpened, counterText, ex, launchBrowser, openView, plan, set, settled, trackOf, type Dom, type Opened } from './support/workoutHost';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const threeLifts = () => plan([ex('Squat', [set('a1'), set('a2')]), ex('Bench Press', [set('b1')]), ex('Row', [set('c1')])]);

/** One finger from `from` to `to` in page coordinates, in small steps, as Chromium's touch input pipeline sees it. */
async function drag(v: Opened, from: [number, number], to: [number, number], steps = 12) {
  const cdp = await v.context.newCDPSession(v.page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function trackBox(v: Opened) {
  const box = await trackOf(v).boundingBox();
  if (!box) throw new Error('track not laid out');
  return box;
}

describe('touch: the track leaves vertical pans to the host', () => {
  it('is not a horizontal scroller of its own and allows only vertical panning', async () => {
    const v = await openView(threeLifts(), { touch: true });
    const css = await trackOf(v).evaluate((el) => {
      const s = (globalThis as unknown as Dom).getComputedStyle(el);
      return { ox: s.overflowX, touch: s.touchAction, snap: s.scrollSnapType };
    });
    expect(css).toEqual({ ox: 'hidden', touch: 'pan-y', snap: 'none' });
  });

  it('a vertical swipe that starts on a card scrolls the page around the view', async () => {
    const v = await openView(threeLifts(), { touch: true });
    const box = await trackBox(v);
    const x = box.x + box.width / 2;
    const y = Math.min(box.y + box.height / 2, 900);
    await drag(v, [x, y], [x, y - 300]);
    await pwExpect.poll(() => v.page.evaluate(() => (globalThis as unknown as Dom).window.scrollY)).toBeGreaterThan(100);
    expect(await counterText(v)).toBe('1 of 5');
  });

  it('a sideways swipe goes one card on, and a swipe back returns', async () => {
    const v = await openView(threeLifts(), { touch: true });
    const box = await trackBox(v);
    const y = box.y + 120;
    await drag(v, [box.x + box.width * 0.8, y], [box.x + box.width * 0.2, y]);
    await settled(v);
    await pwExpect.poll(() => counterText(v)).toBe('2 of 5');
    await drag(v, [box.x + box.width * 0.2, y], [box.x + box.width * 0.8, y]);
    await settled(v);
    await pwExpect.poll(() => counterText(v)).toBe('1 of 5');
  });

  it('a short slow drag springs back to the card it started on', async () => {
    const v = await openView(threeLifts(), { touch: true });
    const box = await trackBox(v);
    const y = box.y + 120;
    const cdp = await v.context.newCDPSession(v.page);
    const x0 = box.x + box.width * 0.6;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 8, y }] });
    await new Promise((r) => setTimeout(r, 200));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await settled(v);
    expect(await trackOf(v).evaluate((el) => el.scrollLeft)).toBeLessThan(2);
    expect(await counterText(v)).toBe('1 of 5');
  });
});
