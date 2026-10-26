// The share card (F4): what is on it (and what is off by default), the formats and themes, and saving it. The card is drawn in the view,
// so these run the built view in Chromium; the preview is the picture that is saved, and its text alternative lists exactly what is drawn.
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Celebration } from '../src/analytics/celebrationTypes';
import celebrationHtml from '../src/ui/generated/celebration';
import { cardText, defaultOptions, describeCard } from '../ui/shared/shareCardText';
import { closeAll, launch, openView, type OpenedView } from './support/viewHost';

const training: Celebration = { kind: 'training_weeks', threshold: 7, achievedAt: '2026-10-20', title: '7 weeks of training', detail: '3 workouts or more each week', atLeast: false, goalKg: null, took: [{ label: 'Workouts', value: 21 }, { label: 'Sets', value: 310 }], next: { threshold: 14, remaining: 7, unit: 'week' } };
const goal: Celebration = { kind: 'goal_weight', threshold: 1, achievedAt: '2026-10-20', title: 'Goal weight reached', detail: 'Seven days in a row at your goal, by the trend', atLeast: false, goalKg: 75, took: [], next: null };

describe('cardText', () => {
  it('carries no name and no weight by default', () => {
    const t = cardText(training, defaultOptions(training));
    expect(t).toEqual({ big: '7', title: '7 weeks of training', detail: '3 workouts or more each week', lines: ['21 workouts', '310 sets', '20 October 2026'], name: null, brand: 'Fitwell' });
    const g = cardText(goal, defaultOptions(goal));
    expect(g.big).toBeNull();
    expect(JSON.stringify(g)).not.toMatch(/kg|75/);
  });

  it('adds the goal weight only when turned on for that card, and never to another kind', () => {
    expect(cardText(goal, { ...defaultOptions(goal), showGoalWeight: true }).lines).toContain('Goal 75 kg');
    expect(cardText({ ...training, goalKg: 75 }, { ...defaultOptions(training), showGoalWeight: true }).lines.join()).not.toContain('kg');
    expect(cardText({ ...goal, goalKg: 72.5 }, { ...defaultOptions(goal), showGoalWeight: true }).lines).toContain('Goal 72.5 kg');
  });

  it('takes a name only when it is on and not blank, trimmed; the choices of numbers, date and brand apply', () => {
    const base = defaultOptions(training);
    expect(cardText(training, { ...base, name: 'Ana' }).name).toBeNull();
    expect(cardText(training, { ...base, showName: true, name: '   ' }).name).toBeNull();
    expect(cardText(training, { ...base, showName: true, name: '  Ana  ' }).name).toBe('Ana');
    const bare = cardText(training, { ...base, numbers: [false, true], showDate: false, showBrand: false });
    expect(bare.lines).toEqual(['310 sets']);
    expect(bare.brand).toBeNull();
  });

  it('says "at least" for a run that reaches the first day looked at, and describes the card in words', () => {
    const t = cardText({ ...training, atLeast: true }, defaultOptions(training));
    expect(t.title).toBe('At least 7 weeks of training');
    expect(t.big).toBe('≥7');
    expect(describeCard(t)).toBe('At least 7 weeks of training. 3 workouts or more each week. 21 workouts. 310 sets. 20 October 2026. Fitwell');
  });
});

describe('the card maker in the view', () => {
  beforeAll(launch, 60_000);
  afterAll(closeAll);

  const open = async (c: Celebration, extra: Parameters<typeof openView>[2] = {}) => {
    const v = await openView(celebrationHtml, { content: [{ type: 'text', text: 'open' }], structuredContent: { celebrations: [c] } }, extra);
    await v.frame.getByRole('button', { name: 'Make a card' }).click();
    await pwExpect(v.frame.locator('canvas.card-canvas')).toBeVisible();
    return v;
  };
  const label = (v: OpenedView) => v.frame.locator('canvas.card-canvas').getAttribute('aria-label');
  const size = (v: OpenedView) => v.frame.locator('canvas.card-canvas').evaluate((c) => [(c as unknown as { width: number }).width, (c as unknown as { height: number }).height]);
  const corner = (v: OpenedView) => v.frame.locator('canvas.card-canvas').evaluate((c) => Array.from((c as unknown as { getContext(t: string): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } }).getContext('2d').getImageData(2, 2, 1, 1).data));

  it('draws the formats at the sizes the apps use, in light and dark', async () => {
    const v = await open(training);
    expect(await size(v)).toEqual([1080, 1350]);
    expect(await corner(v)).toEqual([250, 248, 245, 255]);
    await v.frame.getByRole('button', { name: 'Story 9:16' }).click();
    expect(await size(v)).toEqual([1080, 1920]);
    await v.frame.getByRole('button', { name: 'Square 1:1' }).click();
    expect(await size(v)).toEqual([1080, 1080]);
    await v.frame.getByRole('button', { name: 'Dark' }).click();
    expect(await corner(v)).toEqual([27, 26, 24, 255]);
    await pwExpect(v.frame.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    await pwExpect(v.frame.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
  }, 40_000);

  it('previews exactly the words on the card: name and goal weight are off until turned on', async () => {
    const v = await open(goal);
    expect(await label(v)).toBe('Card preview: Goal weight reached. Seven days in a row at your goal, by the trend. 20 October 2026. Fitwell');
    await v.frame.getByRole('checkbox', { name: 'Goal weight' }).check();
    expect(await label(v)).toContain('Goal 75 kg');
    await v.frame.getByRole('checkbox', { name: 'Goal weight' }).uncheck();
    expect(await label(v)).not.toContain('75');
    await v.frame.getByRole('checkbox', { name: 'My name' }).check();
    await v.frame.getByLabel('Name on the card').fill('Ana');
    expect(await label(v)).toContain('Ana');
    await v.frame.getByRole('checkbox', { name: 'My name' }).uncheck();
    expect(await label(v)).not.toContain('Ana');
    await v.frame.getByRole('checkbox', { name: 'Fitwell' }).uncheck();
    await v.frame.getByRole('checkbox', { name: 'Date' }).uncheck();
    expect(await label(v)).toBe('Card preview: Goal weight reached. Seven days in a row at your goal, by the trend');
  }, 40_000);

  it('offers the goal weight choice only on the goal weight card', async () => {
    const v = await open(training);
    await pwExpect(v.frame.getByRole('checkbox', { name: 'Workouts' })).toBeVisible();
    await pwExpect(v.frame.getByRole('checkbox', { name: 'Goal weight' })).toHaveCount(0);
  }, 30_000);

  it('saves through the host when it can: the file is the picture in the preview', async () => {
    const v = await open(training, { hostCapabilities: { downloadFile: {} } });
    await v.frame.getByRole('button', { name: 'Save picture' }).click();
    await pwExpect(v.frame.getByText('Saved.')).toBeVisible();
    const sent = v.calls.find((c) => c.name === 'ui/download-file')!;
    const resource = (sent.args as { contents: { resource: { uri: string; mimeType: string; blob: string } }[] }).contents[0]!.resource;
    expect(resource).toMatchObject({ uri: 'file:///fitwell-training_weeks-7.png', mimeType: 'image/png' });
    const shown = await v.frame.locator('canvas.card-canvas').evaluate((c) => (c as unknown as { toDataURL(t: string): string }).toDataURL('image/png'));
    expect(`data:image/png;base64,${resource.blob}`).toBe(shown);
    expect(Buffer.from(resource.blob, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // a PNG
  }, 40_000);

  it('shows the picture to press and hold where the host cannot save files', async () => {
    const v = await open(training);
    await v.frame.getByRole('button', { name: 'Save picture' }).click();
    await pwExpect(v.frame.getByText(/Press and hold the picture to save it/)).toBeVisible();
    await pwExpect(v.frame.locator('img.card-image')).toBeVisible();
    expect(v.calls.filter((c) => c.name === 'ui/download-file')).toEqual([]);
    // Changing the card clears the stale picture, so what is shown is never out of date.
    await v.frame.getByRole('button', { name: 'Dark' }).click();
    await pwExpect(v.frame.locator('img.card-image')).toHaveCount(0);
  }, 40_000);
});
