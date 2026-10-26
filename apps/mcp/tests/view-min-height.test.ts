// No view is a thin strip: even a view that only has a message to show (here: the tool failed) fills at least the cards' minimum (--track-h, 440 px at phone width), with the message in the middle. The cards of the dashboard, the review and the player have their own tests.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import celebration from '../src/ui/generated/celebration';
import exercise from '../src/ui/generated/exercise';
import food from '../src/ui/generated/food';
import lift from '../src/ui/generated/lift';
import shopping from '../src/ui/generated/shopping';
import { closeAll, launch, openView } from './support/viewHost';

beforeAll(launch, 60_000);
afterAll(closeAll);

const failed = { isError: true, content: [{ type: 'text', text: 'failed' }] };
const VIEWS: [string, string, RegExp][] = [
  ['lift', lift, /Loading|could not/],
  ['milestone', celebration, /could not be opened/],
  ['exercise guide', exercise, /could not be opened/],
  ['shopping list', shopping, /could not be opened/],
  ['food summary', food, /Nothing was logged/],
];

describe('minimum height of the views that are not card pagers', () => {
  for (const [name, html, message] of VIEWS) {
    it(`${name} is at least 440 px tall with only a message, and the message is in the middle`, async () => {
      const v = await openView(html, failed);
      const text = v.frame.getByText(message).first();
      await pwExpect(text).toBeVisible();
      const height = await v.frame.locator('html').evaluate((e) => e.scrollHeight);
      expect(height).toBeGreaterThanOrEqual(440);
      const box = (await text.boundingBox())!;
      expect(box.y + box.height / 2).toBeGreaterThan(120); // the middle of the message is well below the top (a message at the top edge is at about 30)
    }, 30_000);
  }
});
