// The shared card pager (ui/shared/cardPager.ts), seen through the workout player, which is on the shell in its fixed-height mode
// like the dashboard and the review (tests/cards-shell-fixed.test.ts).
// Contract: contracts/cards-shell. The built view runs in a real Chromium inside an iframe; see tests/support/workoutHost.ts.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser, closeOpened, counterText, ex, launchBrowser, openView, plan, press, set, trackOf, type Dom } from './support/workoutHost';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const three = () => plan([ex('Squat', [set('1')]), ex('Bench Press', [set('1')]), ex('Pullups', [set('1')])]);

describe('Cards shell: the player on the shell (AC3, AC4)', () => {
  it('draws the strip with .sg segments and no .seg, and the track is in fixed mode', async () => {
    const v = await openView(three());
    const info = await v.inView(() => {
      const d = globalThis as unknown as Dom;
      return { sg: [...d.document.querySelectorAll('.sg')].length, seg: [...d.document.querySelectorAll('.seg')].length, fixed: d.document.querySelector('.track')!.getAttribute('data-fixed') };
    });
    expect(info).toEqual({ sg: 5, seg: 0, fixed: '' });
  });

  it('after the host resends the plan one arrow key moves one card (the key handler is not duplicated)', async () => {
    const v = await openView(three());
    await pwExpect.poll(() => counterText(v)).toBe('1 of 5');
    await v.sendResult({ content: [{ type: 'text', text: 'Workout started.' }], structuredContent: { workout: three() } });
    await v.sendResult({ content: [{ type: 'text', text: 'Workout started.' }], structuredContent: { workout: three() } });
    await trackOf(v).waitFor();
    await press(v, 'ArrowRight');
    await pwExpect.poll(() => counterText(v), { timeout: 5000 }).toBe('2 of 5');
    await v.page.waitForTimeout(600);
    expect(await counterText(v)).toBe('2 of 5');
  });
});
