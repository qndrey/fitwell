// The finished report (the last card): only what is worth reading, the muscles as a ranked list with an upright figure beside it,
// one line on what is next and a link to ask for the next workout. The built view runs in a real Chromium inside an
// iframe and the test page plays the MCP Apps host (tests/support/workoutHost.ts).
import { expect as pwExpect } from 'playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cardsOf, closed, closeBrowser, closeOpened, ex, launchBrowser, openView, plan } from './support/workoutHost';

beforeAll(launchBrowser);
afterAll(closeBrowser);
afterEach(closeOpened);

const NEXT = { recover: ['chest', 'triceps'], due: ['hamstrings'], weekSessions: 3 };
const summary = (extra: Record<string, unknown> = {}) => (tool: string): Record<string, unknown> | undefined =>
  tool === 'finish_workout'
    ? { content: [{ type: 'text', text: 'Finished.' }], structuredContent: { minutes: 52, volumeKg: 9420, exercises: [{ name: 'Bench Press', done: '3×8 @ 80 kg', notes: 'Felt heavy' }], ...extra } }
    : undefined;
const PUSH = [
  { muscle: 'chest', sets: 7.5 },
  { muscle: 'triceps', sets: 5 },
  { muscle: 'shoulders', sets: 4.5 },
  { muscle: 'biceps', sets: 1 },
  { muscle: 'forearms', sets: 0.5 },
  { muscle: 'abdominals', sets: 0.5 },
];
const finished = () => plan([ex('Bench Press', [closed('1'), closed('2')], { notes: 'Felt heavy' })], [], { finished: true });
const report = async (extra: Record<string, unknown> = {}, o: Parameters<typeof openView>[1] = {}) => {
  const v = await openView(finished(), { tools: summary(extra), ...o });
  const card = cardsOf(v).last();
  await pwExpect(card.getByRole('heading', { name: 'Workout finished' })).toBeVisible();
  await pwExpect(card).not.toContainText('Loading the summary…');
  return { v, card };
};
const rows = (card: ReturnType<typeof cardsOf>) => card.locator('.report-list li');

describe('the muscles of the report', () => {
  it('lists the top four muscles with their sets, and the rest behind "+2 more"', async () => {
    const { card } = await report({ muscles: PUSH, next: NEXT });
    await pwExpect(rows(card)).toHaveCount(4);
    await pwExpect(rows(card).nth(0)).toContainText('Chest');
    await pwExpect(rows(card).nth(0)).toContainText('7.5');
    await pwExpect(rows(card).nth(3)).toContainText('Biceps');
    await pwExpect(card.getByRole('button', { name: '+2 more' })).toBeVisible();
    await card.getByRole('button', { name: '+2 more' }).click();
    await pwExpect(rows(card)).toHaveCount(6);
    await pwExpect(card.getByRole('button', { name: 'Show less' })).toBeVisible();
    await card.getByRole('button', { name: 'Show less' }).click();
    await pwExpect(rows(card)).toHaveCount(4);
  });

  it('has no chips, no zero muscles and no permanent rule text: one small line says how sets are counted', async () => {
    const { card } = await report({ muscles: PUSH, next: NEXT });
    await pwExpect(card.locator('.heat, .heatmap, .region')).toHaveCount(0);
    await pwExpect(card).not.toContainText('Muscles trained');
    await pwExpect(card).not.toContainText('Quads');
    await pwExpect(card).toContainText('A main muscle counts 1 a set, a helping one 0.5.');
  });

  it('shows an upright figure beside the list for three or more muscles, with a hint and no buttons', async () => {
    const { v, card } = await report({ muscles: PUSH, next: NEXT });
    const canvas = card.locator('.figure canvas');
    await pwExpect(canvas).toBeVisible();
    await expect.poll(() => v.inView(() => (globalThis as unknown as { fitwellMotion: { bodyReady(): boolean } }).fitwellMotion.bodyReady())).toBe(true);
    const box = (await canvas.boundingBox())!;
    expect(box.width / box.height).toBeGreaterThan(0.65);
    expect(box.width / box.height).toBeLessThan(0.8);
    expect(box.width).toBeLessThan(200);
    await pwExpect(card.locator('.figure')).toContainText('Drag to turn.');
    // Nothing to press on the figure: not the guide's controls, no Front / Back.
    await pwExpect(card.locator('.motion-controls')).toBeHidden();
    await pwExpect(card.locator('.figure button:visible')).toHaveCount(0);
    await pwExpect(card.getByRole('button', { name: /^(Front|Back)$/ })).toHaveCount(0);
  });

  it('opens on the side that shows more of the work, and turns when it is dragged', async () => {
    const side = (v: Awaited<ReturnType<typeof report>>['v']) => v.inView(() => (globalThis as unknown as { fitwellMotion: { side(): string } }).fitwellMotion.side());
    const push = await report({ muscles: PUSH });
    await pwExpect(push.card.locator('.figure canvas')).toBeVisible();
    expect(await side(push.v)).toBe('front');
    const box = (await push.card.locator('.figure canvas').boundingBox())!;
    const y = box.y + box.height / 2;
    await push.v.page.mouse.move(box.x + 8, y);
    await push.v.page.mouse.down();
    await push.v.page.mouse.move(box.x + 8 + 300, y, { steps: 10 }); // the canvas keeps the pointer while it is held
    await push.v.page.mouse.up();
    // About 3.5 radians of turn for 300 px: the back is in view.
    await expect.poll(() => side(push.v)).toBe('back');
    await closeOpened();
    const pull = await report({ muscles: [{ muscle: 'lats', sets: 6 }, { muscle: 'middle back', sets: 4 }, { muscle: 'biceps', sets: 3 }, { muscle: 'traps', sets: 1 }] });
    await pwExpect(pull.card.locator('.figure canvas')).toBeVisible();
    expect(await side(pull.v)).toBe('back');
  });

  it('leaves the figure out for fewer than three muscles, and shows the list alone', async () => {
    const { card } = await report({ muscles: [{ muscle: 'chest', sets: 4 }, { muscle: 'triceps', sets: 2 }] });
    await pwExpect(rows(card)).toHaveCount(2);
    await pwExpect(card.locator('.figure')).toHaveCount(0);
    await pwExpect(card.getByRole('button', { name: /more$/ })).toHaveCount(0);
  });

  it('has no muscle section at all for a workout without muscles (cardio only)', async () => {
    const { card } = await report({ muscles: [] });
    await pwExpect(card).not.toContainText('Muscles worked');
    await pwExpect(card.locator('.report')).toHaveCount(0);
  });

  it('keeps the list, with the figure left out, when the browser has no WebGL', async () => {
    const v = await openView(finished(), {
      tools: summary({ muscles: PUSH }),
      noWebGL: true,
    });
    const card = cardsOf(v).last();
    await pwExpect(rows(card)).toHaveCount(4);
    await pwExpect(card.locator('.figure')).toHaveCount(0);
  });
});

describe('the rest of the report', () => {
  it('drops what is not needed: no "No new bests", no echoed notes, no weekly count, no "about 48 hours", no "Sent to Claude"', async () => {
    const { v, card } = await report({ muscles: PUSH, next: NEXT });
    await pwExpect(card).not.toContainText('No new bests');
    await pwExpect(card).not.toContainText('Felt heavy');
    await pwExpect(card).not.toContainText('strength session');
    await pwExpect(card).not.toContainText('48 hours');
    await pwExpect(card).not.toContainText("What's next");
    await pwExpect(card).not.toContainText('Sent to Claude');
    expect(v.messages).toHaveLength(0); // an opened old report tells Claude nothing
  });

  it('says what is next in one line, with a link to ask for the next workout and no dock', async () => {
    const { v, card } = await report({ muscles: PUSH, next: NEXT });
    await pwExpect(card.locator('.next-line')).toHaveText('Next Chest and triceps worked hardest. Hamstrings is due.');
    await pwExpect(card.locator('.dock')).toHaveCount(0); // a finished workout has no dock
    const link = card.getByRole('button', { name: 'Plan my next workout' });
    await pwExpect(link).toBeVisible();
    await link.click();
    await expect.poll(() => v.messages.length).toBe(1);
    expect(v.messages[0]).toBe('Plan my next workout. I just worked chest and triceps hard. Hamstrings is due.');
  });

  it('says nothing about next when there is nothing to say, and the link stays', async () => {
    const { card } = await report({ muscles: PUSH, next: { recover: [], due: [], weekSessions: 1 } });
    await pwExpect(card.locator('.next-line')).toHaveCount(0);
    await pwExpect(card.getByRole('button', { name: 'Plan my next workout' })).toBeVisible();
  });
});
