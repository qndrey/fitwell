// The muscle map's comparison with the period before, the "days since trained" mode and the explained Colours button.
import type { Client } from '@modelcontextprotocol/client';
import { expect as pwExpect } from 'playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MuscleMap } from '../src/analytics/muscleTypes';
import viewHtml from '../src/ui/generated/exercise';
import { deltaText, heatColours, RECOVERY_HEAT, recoveryOf } from '../ui/shared/muscleHeat';
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

const BENCH = 'ex:Barbell_Bench_Press_-_Medium_Grip';
const SQUAT = 'ex:Barbell_Squat';
const sets = (n: number) => Array.from({ length: n }, () => ({ reps: 8, weight_kg: 40 }));
const map = async (weeks: number, to = '2026-10-11') => ((await call(client, 'show_muscle_map', { weeks, to })).data as unknown as { muscleMap: MuscleMap }).muscleMap;
const by = (m: MuscleMap) => Object.fromEntries(m.muscles.map((x) => [x.muscle, x]));

/** Week of 5 Oct: bench 8 sets. Week of 28 Sep: bench 4 sets and squat 4. */
async function seed() {
  await call(client, 'log_past_workout', { day: '2026-10-08', exercises: [{ id: BENCH, sets: sets(8) }] });
  await call(client, 'log_past_workout', { day: '2026-09-29', exercises: [{ id: BENCH, sets: sets(4) }, { id: SQUAT, sets: sets(4) }] });
}

describe('previous period on the server', () => {
  it('gives each muscle the average of the period of equal length before, and null when nothing was logged then', async () => {
    await seed();
    const m = by(await map(1));
    expect(m.chest).toMatchObject({ setsPerWeek: 8, previousSetsPerWeek: 4 });
    expect(m.quadriceps).toMatchObject({ setsPerWeek: 0, previousSetsPerWeek: 4 });
    const none = by(await map(1, '2026-09-27'));
    expect(none.chest!.previousSetsPerWeek).toBeNull();
    const four = await map(4);
    expect(by(four).chest!.previousSetsPerWeek).toBeNull(); // nothing in the 4 weeks before 14 Sep
    expect(four.previousSessions).toBe(0);
  });

  it('writes the difference neutrally, in words that fit the period', () => {
    const m = { setsPerWeek: 9, previousSetsPerWeek: 7.5 } as Parameters<typeof deltaText>[0];
    expect(deltaText(m, 4)).toBe('+1.5 vs the 4 weeks before');
    expect(deltaText({ ...m, previousSetsPerWeek: 11 }, 1)).toBe('−2 vs the week before');
    expect(deltaText({ ...m, previousSetsPerWeek: 9 }, 12)).toBe('same as the 12 weeks before');
    expect(deltaText({ ...m, previousSetsPerWeek: null }, 4)).toBeNull();
  });
});

describe('days since trained', () => {
  it('bins the days since the last main-muscle set', () => {
    expect([0, 2, 3, 6, 7, 30].map((d) => recoveryOf('2026-10-11', new Date(Date.parse('2026-10-11T00:00:00Z') - d * 86_400_000).toISOString().slice(0, 10)))).toEqual(['recent', 'recent', 'days', 'days', 'week', 'week']);
    expect(recoveryOf('2026-10-11', null)).toBe('none');
  });

  it('colours the body by those bins in a neutral ramp, with four told-apart levels in each theme', async () => {
    await seed();
    const m = await map(1);
    for (const dark of [false, true]) {
      const c = heatColours(m, dark, 'recovery');
      expect(c.get('chest')).toBe(RECOVERY_HEAT[dark ? 'dark' : 'light'].days); // 8 Oct is 3 days before 11 Oct
      expect(c.get('quadriceps')).toBe(RECOVERY_HEAT[dark ? 'dark' : 'light'].none); // squats were the week before: not in this period
      expect(new Set(Object.values(RECOVERY_HEAT[dark ? 'dark' : 'light'])).size).toBe(4);
    }
  });
});

describe('muscle map view', () => {
  const open = async (m: MuscleMap) => openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { muscleMap: m } });

  it('shows the comparison in each row, explains Colours, and has a real toggle for days since trained', async () => {
    await seed();
    const v = await open(await map(1));
    const f = v.frame;
    const chest = f.locator('details', { hasText: 'Chest' }).first();
    await pwExpect(chest.locator('.delta')).toHaveText('+4 vs the week before');
    await pwExpect(f.getByText('Colours shows or hides the colour of each muscle group.')).toBeVisible();
    const toggle = f.getByRole('button', { name: 'Days since trained' });
    await pwExpect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await pwExpect(toggle).toHaveAttribute('aria-pressed', 'true');
    await pwExpect(f.getByText('Within 2 days', { exact: false }).first()).toBeVisible();
    await pwExpect(f.getByText('7 or more days ago').first()).toBeVisible();
    await pwExpect(f.locator('.musclemap .delta')).toHaveCount(0); // no comparison in this mode
    await pwExpect(f.locator('details', { hasText: 'Chest' }).first().locator('.sets')).toHaveText('3 days ago');
    await toggle.click();
    await pwExpect(f.locator('details', { hasText: 'Chest' }).first().locator('.sets')).toHaveText('8 sets a week');
  }, 60_000);

  it('puts the period in the heading row as 1w 4w 12w, and the days-since toggle is an icon', async () => {
    await seed();
    const v = await open(await map(4));
    const f = v.frame;
    const period = f.getByRole('group', { name: 'Period' });
    await pwExpect(period.getByRole('button')).toHaveText(['1w', '4w', '12w']);
    await pwExpect(period.getByRole('button', { name: '4 weeks' })).toHaveAttribute('aria-pressed', 'true');
    await pwExpect(period.getByRole('button', { name: '1 week' })).toHaveAttribute('aria-pressed', 'false');
    for (const b of await period.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pwExpect(f.locator('.musclemap > .head h2')).toHaveText('Muscles trained');
    const toggle = f.getByRole('button', { name: 'Days since trained' });
    await pwExpect(toggle.locator('svg.icon')).toHaveCount(1);
    expect(await toggle.textContent()).toBe('');
    await pwExpect(f.locator('.seg')).toHaveCount(0);
  }, 60_000);

  it('has icon-only figure controls with names, and the guide has a quiet demo link', async () => {
    const guide = ((await client.callTool({ name: 'show_exercise', arguments: { query: 'barbell squat' } })).structuredContent as { guide: unknown }).guide;
    const v = await openView(viewHtml, { content: [{ type: 'text', text: 'ok' }], structuredContent: { guide } });
    const f = v.frame;
    const demo = f.getByRole('button', { name: 'Demo video' });
    await pwExpect(demo).toBeVisible();
    await pwExpect(demo.locator('svg.icon')).toHaveCount(1);
    expect((await demo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Without WebGL there is no figure and no controls; where there is, each control is an icon with a name.
    const controls = f.locator('.motion-controls button');
    for (const b of await controls.all()) {
      await pwExpect(b).toHaveAttribute('aria-label', /\S/);
      await pwExpect(b.locator('svg.icon')).toHaveCount(1);
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await pwExpect(f.locator('.guide button.demo')).toHaveCount(1);
  }, 60_000);
});
